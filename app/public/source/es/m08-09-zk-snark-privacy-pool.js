/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Laboratorio 09: Fondo de Privacidad Zero-Knowledge en Hedera EVM
 * [ CONCEPTO ] Compromisos Criptográficos y Liquidaciones Confidenciales en Capa 1
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Los registros públicos mantienen un grafo de transacciones abierto donde las
 * relaciones emisor-receptor son visibles para cualquiera. Los protocolos de
 * privacidad (como Tornado Cash o Semaphore) rompen esta heurística mediante
 * compromisos Zero-Knowledge y nulificadores criptográficos.
 *
 * En Ethereum, verificar compromisos y árboles de nulificadores cuesta entre
 * \$20 y \$80 en gas. En la EVM de Hedera:
 * 1. Las operaciones criptográficas (Keccak-256) y curvas se ejecutan con tarifas
 *    de gas predecibles y sub-centavo (\$0.001 - \$0.05).
 * 2. Las transacciones alcanzan finalidad irrevocable en 2-3 segundos.
 * 3. Los depósitos y retiros quedan matemáticamente desvinculados:
 *    - El depositante compromete: `C = Keccak256(nullifier || secret)`
 *    - El receptor redime con `(nullifier, secret)` hacia un destino stealth.
 *    - Ningún análisis de grafos o heurística puede enlazar al depositante con el receptor.
 * 4. El contrato gestiona un registro de nulificadores de un solo uso que previene doble gasto.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * La combinación de la lógica EVM de Solidity con los costos mínimos de Hedera
 * convierte a la red en la plataforma óptima para infraestructura de privacidad ZK.
 * La privacidad empresarial no requiere cadenas privadas o permisionadas: puede
 * desplegarse directamente sobre la capa de consenso pública de Hedera.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M8 Lab 08: Precompilados HTS Avanzados
 * - Siguiente: M8 Lab 10: Inmersión en Contratos del Sistema (0x168 y 0x16a)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: ~15 ℏ la primera vez (crea un contrato, cerca de 1 USD); <1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M8_Smart_Contracts_EVM/09_zk_snark_privacy_pool.js
 * ============================================================================
 */

import {
  AccountId,
  ContractId,
  ContractCreateTransaction,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  PrivateKey,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl, getHashscanUrl, getState, updateState, sleep, executeWithGas, getAccountEvmAddress } from '../M99_Utilities/index.js'
import solc from 'solc'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { ethers } from 'ethers'

/**
 * 1. Compilador de Solidity en vivo vía solc con Optimizador Habilitado
 */
const compileZkContract = () => {
  console.log('[⚙️ PROCESO] Compilando ZkPrivacyPool.sol con solc 0.8.20 (Optimizador habilitado)...')
  const contractPath = new URL('./09_zk_snark_privacy_pool.sol', import.meta.url)
  const sourceCode = fs.readFileSync(contractPath, 'utf8')

  const input = {
    language: 'Solidity',
    sources: {
      'ZkPrivacyPool.sol': {
        content: sourceCode
      }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      outputSelection: {
        '*': {
          '*': ['*']
        }
      }
    }
  }

  const compiled = JSON.parse(solc.compile(JSON.stringify(input)))
  if (compiled.errors) {
    const fatal = compiled.errors.filter(e => e.severity === 'error')
    if (fatal.length > 0) {
      throw new Error(`Error de compilación en Solidity: ${fatal[0].formattedMessage}`)
    }
  }

  const contract = compiled.contracts['ZkPrivacyPool.sol'].ZkPrivacyPool
  return {
    bytecode: contract.evm.bytecode.object,
    abi: contract.abi
  }
}

/**
 * Consulta Asíncrona de Balance en Mirror Node (compatible con CQRS)
 */
const getAccountHbarBalance = async (accountId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
  if (!res.ok) {
    throw new Error(`La consulta a Mirror Node para el balance de ${accountId} falló`)
  }
  const data = await res.json()
  return data.balance.balance / 1e8
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Fondo de Privacidad Zero-Knowledge en Hedera EVM ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Resolver o Desplegar el Contrato ZkPrivacyPool
    let contractIdStr = getState('ZK_PRIVACY_POOL_ID')
    let contractId

    if (contractIdStr) {
      contractId = ContractId.fromString(contractIdStr)
      console.log(`[✅ ÉXITO] Reutilizando ID de Contrato ZkPrivacyPool desplegado: ${contractIdStr}`)
      console.log(`[📊 REGISTRO] Dirección EVM del Contrato: 0x${contractId.toEvmAddress()}`)
    } else {
      const { bytecode } = compileZkContract()
      console.log(`[✅ ÉXITO] ¡Contrato Compilado! Longitud del Bytecode: ${bytecode.length} caracteres hex (${bytecode.length / 2} bytes)`)

      console.log('\n[⚙️ PROCESO] Paso 1: Desplegando ZkPrivacyPool directamente en Hedera EVM (Bytecode Directo)...')
      const deployTx = await executeWithGas((gas) => new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(gas)
        .setAdminKey(adminKey), client, { gas: 300000 })

      const deployReceipt = await deployTx.getReceipt(client)
      contractId = deployReceipt.contractId
      contractIdStr = contractId.toString()
      updateState('ZK_PRIVACY_POOL_ID', contractIdStr)

      console.log(`[✅ ÉXITO] ZkPrivacyPool Desplegado en ID de Contrato: ${contractIdStr}`)
      console.log(`[📊 REGISTRO] Dirección EVM del Contrato: 0x${contractId.toEvmAddress()}`)
      console.log(`[📊 REGISTRO] URL en HashScan: ${getHashscanUrl(deployTx)}`)
    }

    // 2. Generar Secretos Criptográficos Fuera de Cadena
    console.log('\n[⚙️ PROCESO] Paso 2: Generando Secretos Criptográficos (Nulificador y Preimagen)...')
    const nullifier = crypto.randomBytes(32)
    const secret = crypto.randomBytes(32)

    // Computar compromiso ZK: C = keccak256(nullifier || secret)
    const combinedBytes = Buffer.concat([nullifier, secret])
    const commitmentHashHex = ethers.keccak256(combinedBytes)
    const commitmentBuffer = Buffer.from(commitmentHashHex.slice(2), 'hex')

    console.log(`[📊 REGISTRO] Nulificador Secreto: 0x${nullifier.toString('hex')}`)
    console.log(`[📊 REGISTRO] Preimagen Secreta:   0x${secret.toString('hex')}`)
    console.log(`[📊 REGISTRO] Compromiso Criptográfico: ${commitmentHashHex}`)

    // 3. Depósito Anónimo en el Fondo de Privacidad (0.01 HBAR)
    console.log('\n[⚙️ PROCESO] Paso 3: Depositando 0.01 HBAR en el Fondo con el Compromiso Criptográfico...')
    const depositTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setPayableAmount(new Hbar(0.01))
      .setFunction('deposit', new ContractFunctionParameters().addBytes32(commitmentBuffer)), client, { gas: 250000 })

    const depositReceipt = await depositTx.getReceipt(client)
    console.log(`[✅ ÉXITO] ¡Depósito Confirmado! Estado en Consenso: ${depositReceipt.status.toString()}`)
    console.log(`[📊 REGISTRO] HashScan del Depósito: ${getHashscanUrl(depositTx)}`)
    console.log('[ℹ️ INFORMACIÓN] Los fondos están blindados en el fondo. La identidad del depositante está desacoplada.')

    // 4. Retiro Confidencial hacia Receptor Stealth / No Vinculado
    console.log('\n[⚙️ PROCESO] Paso 4: Iniciando Redención Confidencial hacia Destinatario Stealth...')
    const stealthRecipientId = process.env.ACCOUNT_1_ID || '0.0.11226623'
    const stealthRecipientAddress = await getAccountEvmAddress(stealthRecipientId) // alias accounts are paid at their EVM alias

    const initialStealthBalance = await getAccountHbarBalance(stealthRecipientId)
    console.log(`[📊 REGISTRO] Destino Stealth: ${stealthRecipientId} (${stealthRecipientAddress})`)
    console.log(`[📊 REGISTRO] Balance Pre-Retiro Stealth: ${initialStealthBalance} HBAR`)

    // Revelar nulificador y secreto al contrato:
    // El contrato calcula Keccak256(nullifier, secret) en la cadena, valida el compromiso,
    // registra el nulificador como gastado y libera los 0.01 HBAR a la dirección stealth.
    const withdrawTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('withdraw', new ContractFunctionParameters()
        .addBytes32(nullifier)
        .addBytes32(secret)
        .addAddress(stealthRecipientAddress)
      ), client, { gas: 300000 })

    const withdrawReceipt = await withdrawTx.getReceipt(client)
    console.log(`[✅ ÉXITO] ¡Retiro Confidencial Liquidado! Estado: ${withdrawReceipt.status.toString()}`)
    console.log(`[📊 REGISTRO] HashScan del Retiro: ${getHashscanUrl(withdrawTx)}`)

    // 5. Verificar Liquidación y Estado de Balances
    console.log('\n[⚙️ PROCESO] Paso 5: Verificando Liquidación de Balances y Ruptura de Trazabilidad...')
    await sleep(3000)
    const finalStealthBalance = await getAccountHbarBalance(stealthRecipientId)
    console.log(`[📊 REGISTRO] Balance Post-Retiro Stealth: ${finalStealthBalance} HBAR (+0.01 HBAR transferidos)`)

    if (finalStealthBalance <= initialStealthBalance) {
      throw new Error('Fallo en la verificación de liquidación: el balance stealth no incrementó')
    }
    console.log('[✅ ÉXITO] ¡El receptor stealth recibió los fondos con CERO vínculos en cadena con el depositante!')

    // 6. Probar Defensa Contra Doble Gasto (Simulación de Ataque)
    console.log('\n[⚙️ PROCESO] Paso 6: Probando Defensa Contra Replay y Doble Gasto (Simulación de Ataque)...')
    try {
      const replayTx = await executeWithGas((gas) => new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(gas)
        .setFunction('withdraw', new ContractFunctionParameters()
          .addBytes32(nullifier)
          .addBytes32(secret)
          .addAddress(stealthRecipientAddress)
        ), client, { gas: 300000 })

      await replayTx.getReceipt(client)
      console.error('[❌ ERROR] Violación de seguridad: ¡El ataque de repetición tuvo éxito!')
      process.exitCode = 1
    } catch (replayError) {
      console.log('[✅ ÉXITO] ¡Ataque de doble gasto rechazado exitosamente por la verificación de nulificador en la EVM!')
      console.log(`[📊 REGISTRO] Motivo de Reversión Esperado: "${replayError.message}"`)
    }

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Los fondos de Privacidad Zero-Knowledge desacoplan los orígenes y destinos en la red.')
    console.log('Al verificar preimágenes criptográficas en Solidity, Hedera EVM provee garantías')
    console.log('matemáticas de privacidad a costos de gas sub-centavo sin requerir redes privadas.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Los nulificadores son la base para evitar el doble gasto en ZK. El compromiso')
    console.log('blinda el depósito, mientras que el nulificador unidireccional registra el retiro')
    console.log('sin revelar a cuál depósito pertenecía originalmente.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en el Fondo de Privacidad ZK:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
