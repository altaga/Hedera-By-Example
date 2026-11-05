/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Fachada Directa HTS como ERC-20 (Ejecución en Solidity)
 * [CONCEPTO] Compatibilidad Directa Solidity ERC-20 con HIP-719
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Adiós al Precompilado 0x167: Históricamente, interactuar con un token HTS desde
 * Solidity requería invocar el contrato del sistema de Hedera en 0x167 con
 * codificación ABI especializada. Con HIP-719, todo token nativo de HTS expone una
 * dirección EVM directa (derivada de su ID 0.0.X). Los contratos de Solidity pueden
 * tratar tokens nativos de Hedera como instancias estándar de IERC20 sin fricción.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * No necesitas reescribir tus contratos de Ethereum para usar tokens HTS. Las interfaces ERC-20 estándar interactúan directamente con tokens nativos de Hedera a través de precompilados del sistema.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/evm/development/addresses
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M11 Lab 07: Puente de Integración ERP Institucional
 * - Actual:   M12 Lab 01: Fachada Directa HTS ERC-20
 * - Siguiente: M12 Lab 02: JSON-RPC Relay con Ethers.js
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~30 ℏ la primera vez (crea un token y un contrato, cerca de 2 USD); <0.1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M12_Modern_EVM_Tooling/01_hts_direct_erc20_facade.js
 * ============================================================================
 */

import fs from 'fs'
import path from 'path'
import solc from 'solc'
import {
  ContractCreateFlow,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  ContractFunctionParameters
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState, executeWithGas, reuseToken, reuseContract } from '../M99_Utilities/index.js'

const compileSolidityContract = (sourcePath) => {
  console.log('[PROCESO] Compilando contrato inteligente Solidity con solc 0.8.20...')
  const sourceCode = fs.readFileSync(sourcePath, 'utf8')

  const input = {
    language: 'Solidity',
    sources: {
      'HtsTokenVault.sol': { content: sourceCode }
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode']
        }
      }
    }
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  if (output.errors) {
    const criticalErrors = output.errors.filter(e => e.severity === 'error')
    if (criticalErrors.length > 0) {
      throw new Error(`Fallo en la compilación de Solidity: ${criticalErrors[0].formattedMessage}`)
    }
  }

  const contract = output.contracts['HtsTokenVault.sol'].HtsTokenVault
  return {
    abi: contract.abi,
    bytecode: contract.evm.bytecode.object
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Fachada Directa HTS como ERC-20 ---\n')
  const { client, operatorId, network } = getClient()

  try {
    // 1. Crear un token fungible nativo en HTS
    console.log('[PROCESO] Creando token nativo HTS...')
    const htsTokenId = await reuseToken('REUSE_M12_01_TOKEN', async () => {
      // Crea el token: sus llaves (admin, supply, KYC, freeze...) deciden quién puede cambiarlo después.
      const tokenCreateTx = await new TokenCreateTransaction()
        .setTokenName('Vault Collateral Token')
        .setTokenSymbol('VCT')
        .setDecimals(8)
        .setInitialSupply(100000000)
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Infinite)
        .setTreasuryAccountId(operatorId)
        .setAdminKey(client.operatorPublicKey)
        .freezeWith(client)

      const tokenResponse = await tokenCreateTx.execute(client)
      // Espera el consenso: el recibo dice si la red aceptó la transacción.
      const tokenReceipt = await tokenResponse.getReceipt(client)
      return tokenReceipt.tokenId
    })

    // Derivar dirección EVM determinista (HIP-719)
    const tokenEvmAddress = `0x${htsTokenId.toEvmAddress()}`
    console.log(`[ÉXITO] Token Nativo HTS Creado: ${htsTokenId.toString()}`)
    console.log(`[REGISTRO] Dirección EVM Determinista: ${tokenEvmAddress}`)

    // 2. Compilar Contrato Solidity
    const currentDir = path.dirname(import.meta.filename)
    const solPath = path.join(currentDir, '01_hts_direct_erc20_facade.sol')
    const { bytecode, abi } = compileSolidityContract(solPath)
    console.log(`[ÉXITO] Contrato Compilado. Tamaño del Bytecode: ${bytecode.length / 2} bytes`)

    // 3. Desplegar Contrato en Hedera mediante ContractCreateFlow
    console.log('\n[PROCESO] Desplegando contrato HtsTokenVault en el Smart Contract Service de Hedera...')
    const contractParams = new ContractFunctionParameters().addAddress(tokenEvmAddress)

    const contractId = await reuseContract('REUSE_M12_01_CONTRACT', bytecode + tokenEvmAddress, async () => {
      // Despliega el contrato: el bytecode va on-chain y la red devuelve su contract ID y su dirección EVM.
      const contractDeployTx = await executeWithGas((gas) => new ContractCreateFlow()
        .setBytecode(bytecode)
        .setGas(gas)
        .setConstructorParameters(contractParams), client, { gas: 1500000 })

      const contractReceipt = await contractDeployTx.getReceipt(client)
      return contractReceipt.contractId
    })
    const contractEvmAddress = `0x${contractId.toEvmAddress()}`

    console.log(`[ÉXITO] Contrato Desplegado en Hedera: ${contractId.toString()}`)
    console.log(`[REGISTRO] Dirección EVM del Contrato: ${contractEvmAddress}`)
    console.log(`[EXPLORADOR] HashScan: ${`https://hashscan.io/testnet/contract/${contractId}`}`)

    updateState('FACADE_HTS_TOKEN_ID', htsTokenId.toString())
    updateState('FACADE_HTS_EVM_ADDRESS', tokenEvmAddress)
    updateState('FACADE_CONTRACT_ID', contractId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('HIP-719 elimina la fricción para desarrolladores de contratos inteligentes en Ethereum.')
    console.log('Tus contratos en Solidity pueden integrarse directamente con activos de Hedera')
    console.log('Token Service utilizando interfaces estándar IERC20 de OpenZeppelin.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en el despliegue de la fachada HTS:', error.message)
    process.exit(1)
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
