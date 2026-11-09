/**
 * ============================================================================
 * Lab 08: Precompilados HTS Avanzados
 * [CONCEPTO] Contratos Inteligentes EVM Controlando Activos Nativos
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Los Contratos Inteligentes en Hedera pueden interactuar con el Hedera Token
 * Service (HTS) nativo usando el precompilado 0x167. Esto significa que un
 * contrato Solidity puede MINTEAR, QUEMAR o TRANSFERIR tokens nativos de Hedera
 * combinando la programabilidad EVM con el
 * servicio de tokens nativo.
 * Para lograr esto, el ID del Contrato Inteligente debe establecerse como
 * la Llave de Suministro (Supply Key) del token.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Invocar precompilados avanzados permite a contratos Solidity confiscar (wipe), congelar o pausar tokens directamente desde EVM, otorgando a contratos de gobernanza control soberano sobre activos HTS.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/evm/hedera-services/system-contracts/hts
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M8 Lab 07: Asociación de Tokens (USDC Bridge)
 * - Siguiente: M8 Lab 09: Pool de Privacidad Zero-Knowledge en Hedera EVM (zk-SNARK Groth16)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~30 ℏ la primera vez (crea un token y un contrato, cerca de 2 USD); <0.1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M8_Smart_Contracts_EVM/08_hts_precompiles_advanced.js
 * ============================================================================
 */

import {
  ContractCreateTransaction,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  TokenCreateTransaction,
  PrivateKey
} from '@hiero-ledger/sdk'
import solc from 'solc'
import fs from 'fs'
import { getClient, executeWithGas, reuseContract, reuseToken } from '../M99_Utilities/index.js'

const compile = (contractName, source) => {
  console.log(`[PROCESO] Compilando ${contractName}.sol...`)
  const input = {
    language: 'Solidity',
    sources: { [`${contractName}.sol`]: { content: source } },
    settings: { outputSelection: { '*': { '*': ['*'] } } }
  }
  const compiled = JSON.parse(solc.compile(JSON.stringify(input)))
  const contract = compiled.contracts[`${contractName}.sol`][contractName]
  return contract.evm.bytecode.object
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Precompilados HTS Avanzados ---\n')

  const { client, operatorKey, operatorId } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    // 1. Compilar y Desplegar el Contrato Inteligente
    const sourceCode = fs.readFileSync(new URL('./08_hts_precompiles_advanced.sol', import.meta.url), 'utf8')
    const bytecode = compile('AdvancedHTS', sourceCode)

    console.log('[PROCESO] Desplegando el Contrato AdvancedHTS en la EVM...')
    const contractId = await reuseContract('REUSE_M8_08_CONTRACT', bytecode, async () => {
      const contractTx = await executeWithGas((gas) => new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(gas)
        .setAdminKey(adminKey), client, { gas: 1500000 })
      const receipt = await contractTx.getReceipt(client)
      return receipt.contractId
    })
    console.log(`[ÉXITO] Contrato desplegado con ID: ${contractId.toString()}`)

    // 2. Crear un Token HTS y establecer el Contrato como Llave de Suministro
    console.log('\n[PROCESO] Creando Token Nativo con el Contrato como Llave de Suministro...')
    // La supply key del token es este contrato: el token se reutiliza solo junto con él.
    const tokenId = await reuseToken(`REUSE_M8_08_TOKEN_${contractId}`, async () => {
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('Precompile Coin')
        .setTokenSymbol('PRC')
        .setDecimals(2)
        .setInitialSupply(0)
        .setTreasuryAccountId(operatorId)
        // ESTO LE DA AL CONTRATO INTELIGENTE EL PODER DE MINTEAR:
        .setSupplyKey(contractId)
        .freezeWith(client)

      const signTx = await tokenTx.sign(adminKey)
      const submitTx = await signTx.execute(client)
      const tokenReceipt = await submitTx.getReceipt(client)
      return tokenReceipt.tokenId
    })
    console.log(`[ÉXITO] Token creado: ${tokenId.toString()}`)

    // 3. Ejecutar la función del Contrato Inteligente para MINTEAR tokens nativamente
    console.log('\n[PROCESO] Llamando al Contrato Inteligente para Mintear 1000 Tokens (Precompilado 0x167)...')
    const mintAmount = 1000

    const execTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('mintFungibleToken', new ContractFunctionParameters()
        .addAddress(tokenId.toEvmAddress()) // La Dirección del Token
        .addUint64(mintAmount) // La Cantidad a Mintear
      ), client, { gas: 2000000 })

    const execRecord = await execTx.getRecord(client)

    // El código de respuesta 22 significa ÉXITO (SUCCESS) en HTS
    const responseCode = Number(execRecord.contractFunctionResult.getInt256(0)) // BigNumber -> number
    console.log(`[REGISTRO] Código de Respuesta del Precompilado: ${responseCode} (22 = ÉXITO)`)

    if (responseCode === 22) {
      console.log('[ÉXITO] ¡El Contrato Inteligente minteó tokens nativos exitosamente!')
    } else {
      console.log('[FALLO] El Contrato Inteligente falló al mintear tokens.')
    }

    console.log('\n CONCEPTO CLAVE:')
    console.log('Al establecer un ContractId como llave en una entidad nativa de Hedera, le')
    console.log('das a ese contrato EVM autorización directa sobre las operaciones de capa base,')
    console.log('fusionando la lógica EVM con velocidades nativas.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Error de Ejecución:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
