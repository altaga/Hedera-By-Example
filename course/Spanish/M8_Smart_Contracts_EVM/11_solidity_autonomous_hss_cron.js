/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 11: Precompilación HSS Cron Autónomo en Solidity (0x16b)
 * [ CONCEPTO ] Contratos Inteligentes que se Autoprograman en Capa 1 de Hedera
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En los ecosistemas EVM tradicionales (Ethereum, Polygon, Arbitrum), los contratos
 * inteligentes son pasivos. No pueden "despertarse a sí mismos" en el futuro sin
 * depender de bots off-chain centralizados o costosas redes de keepers (Chainlink
 * Automation, Gelato). Si un keeper se queda sin gas o se desconecta, el protocolo falla.
 *
 * Hedera revoluciona la automatización de contratos inteligentes mediante la Precompilación HSS 0x16b:
 * 1. Cron Autónomo Nativo: Un contrato inteligente en Solidity puede invocar `0x16b`
 *    (`IHederaScheduleService.scheduleNative`) directamente desde el bytecode EVM.
 * 2. Programación Nativa en Capa 1: La transacción futura se envía a la capa de
 *    consenso de Hedera como una transacción programada con su ventana de ejecución.
 * 3. Ejecución Libre de Keepers: Al alcanzarse el momento o condición programada, los
 *    nodos de consenso gossip-about-gossip de Hedera ejecutan la transacción de forma
 *    autónoma sin requerir bots, servidores ni relayers externos.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los smart contracts autónomos hacen posible la verdadera DeFi perpetua: reinversión
 * automática de rendimientos, renovaciones periódicas de suscripciones, nóminas recurrentes
 * y subastas de liquidación que se ejecutan con certeza matemática en Capa 1.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M8 Lab 10: Inmersión en Contratos del Sistema (0x168 y 0x16a)
 * - Siguiente: M9 Lab 01: Persistencia IA (HCS-1)
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M8_Smart_Contracts_EVM/11_solidity_autonomous_hss_cron.js
 * ============================================================================
 */

import fs from 'node:fs'
import {
  ContractId,
  ContractCreateTransaction,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  PrivateKey,
  AccountId
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState, updateState } from '../M99_Utilities/index.js'
import solc from 'solc'

const compileCronVaultContract = () => {
  console.log('[⚙️ PROCESO] Compilando 11_solidity_autonomous_hss_cron.sol con solc 0.8.20...')
  const contractPath = new URL('./11_solidity_autonomous_hss_cron.sol', import.meta.url)
  const sourceCode = fs.readFileSync(contractPath, 'utf8')

  const input = {
    language: 'Solidity',
    sources: {
      'AutonomousCronVault.sol': {
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
      throw new Error(`Error de compilación Solidity: ${fatal[0].formattedMessage}`)
    }
  }

  const contract = compiled.contracts['AutonomousCronVault.sol'].AutonomousCronVault
  return {
    bytecode: contract.evm.bytecode.object,
    abi: contract.abi
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Precompilación HSS Cron Autónomo (0x16b) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromStringDer(operatorKey)

  try {
    let contractIdStr = getState('AUTONOMOUS_CRON_VAULT_ID')
    let contractId

    if (contractIdStr) {
      contractId = ContractId.fromString(contractIdStr)
      console.log(`[✅ ÉXITO] Reutilizando contrato AutonomousCronVault ID: ${contractIdStr}`)
    } else {
      const { bytecode } = compileCronVaultContract()
      console.log(`[✅ ÉXITO] ¡Contrato Compilado! Longitud del Bytecode: ${bytecode.length} caracteres hex`)

      console.log('\n[⚙️ PROCESO] Paso 1: Desplegando AutonomousCronVault en Hedera EVM...')
      const deployTx = await new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(1500000)
        .setAdminKey(adminKey)
        .execute(client)

      const deployReceipt = await deployTx.getReceipt(client)
      contractId = deployReceipt.contractId
      contractIdStr = contractId.toString()
      updateState('AUTONOMOUS_CRON_VAULT_ID', contractIdStr)

      console.log(`[✅ ÉXITO] AutonomousCronVault Desplegado con Contract ID: ${contractIdStr}`)
      console.log(`[📊 LOG] Dirección EVM: 0x${contractId.toEvmAddress()}`)
      console.log(`[🔗 EXPLORADOR] Ver en HashScan: ${getHashscanUrl(deployTx)}`)
    }

    // 2. Disparar Latido Autónomo On-Chain
    console.log('\n[⚙️ PROCESO] Paso 2: Ejecutando performAutonomousHeartbeat()...')
    const heartbeatTx = await new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(200000)
      .setFunction('performAutonomousHeartbeat')
      .execute(client)

    const heartbeatRecord = await heartbeatTx.getRecord(client)
    console.log(`[✅ ÉXITO] ¡Latido Ejecutado! Estado: ${heartbeatRecord.receipt.status.toString()}`)
    console.log(`[📊 LOG] ID de Transacción de Consenso: ${heartbeatTx.transactionId.toString()}`)

    // 3. Programar Ejecución Futura mediante Precompilación HSS 0x16b
    console.log('\n[⚙️ PROCESO] Paso 3: Disparando scheduleNextHeartbeat() mediante Precompilación 0x16b...')
    const payerEvmAddress = `0x${AccountId.fromString(operatorId).toEvmAddress()}`

    const scheduleCallTx = await new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(300000)
      .setFunction('scheduleNextHeartbeat', new ContractFunctionParameters().addAddress(payerEvmAddress))
      .execute(client)

    const scheduleRecord = await scheduleCallTx.getRecord(client)
    console.log(`[✅ ÉXITO] ¡Tarea Cron Autónoma Programada! Estado: ${scheduleRecord.receipt.status.toString()}`)
    console.log(`[📊 LOG] ID de Transacción de Programación: ${scheduleCallTx.transactionId.toString()}`)
    console.log(`[🔗 EXPLORADOR] Ver en HashScan:             ${getHashscanUrl(scheduleCallTx)}`)

    updateState('AUTONOMOUS_CRON_LAST_TX_ID', scheduleCallTx.transactionId.toString())

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Arquitectura Autoprogramada 0x16b: Los contratos inteligentes en Hedera pueden')
    console.log('programar sus propias operaciones recurrentes de manera autónoma sin servidores ni bots.')
    console.log('La transacción vive en la capa de consenso hasta madurar su momento de ejecución.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Eliminación de Dependencias de Keepers: Al reemplazar redes externas con precompilaciones')
    console.log('HSS nativas, los protocolos reducen la complejidad operativa a cero y garantizan su')
    console.log('ejecución incluso ante congestiones de red o caídas de nubes externas.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en la Ejecución de Cron Autónomo:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ ERROR] Fallo de Ejecución:', error.message)
    process.exit(1)
  })
}
