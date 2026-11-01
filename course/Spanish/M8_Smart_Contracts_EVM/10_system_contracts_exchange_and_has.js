/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 10: Inmersión en Contratos del Sistema: Tasa de Cambio 0x168 y Precompilación HAS 0x16a
 * [ CONCEPTO ] Oráculos On-Chain Nativos y Autorización Universal de Cuentas
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La mayoría de las redes EVM requieren oráculos externos (Chainlink, Pyth) para
 * obtener precios de mercado, introduciendo latencias, tarifas de suscripción
 * y vulnerabilidades en puentes multifirma.
 *
 * Hedera proporciona Contratos del Sistema (Precompiles) directamente en el núcleo EVM:
 * 1. 0x168 (Precompilación de Tasa de Cambio): La propia red de consenso publica
 *    la tasa oficial HBAR/USD en la memoria EVM. Cualquier contrato inteligente
 *    puede convertir entre tinycents (USD) y tinybars (HBAR) en un solo opcode
 *    sin costos de oráculos externos ni demoras.
 * 2. 0x16a (Hedera Account Service - HAS): Los contratos inteligentes pueden verificar
 *    criptográficamente firmas de cuentas en TODOS los tipos de claves de Hedera
 *    (ED25519, secp256k1 ECDSA y KeyLists de umbral) nativamente mediante `isAuthorized`.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Al utilizar la precompilación nativa 0x168, los protocolos DeFi (mercados de préstamos,
 * stablecoins algorítmicas, distribuidores de tarifas) eliminan la dependencia de oráculos
 * externos y el riesgo de ataques de préstamos flash sobre oráculos desfasados.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M8 Lab 09: Piscina de Privacidad con Pruebas de Conocimiento Cero
 * - Siguiente: M8 Lab 11: Precompilación HSS Cron Autónomo en Solidity (0x16b)
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M8_Smart_Contracts_EVM/10_system_contracts_exchange_and_has.js
 * ============================================================================
 */

import fs from 'node:fs'
import {
  ContractId,
  ContractCreateTransaction,
  ContractCallQuery,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  PrivateKey,
  AccountId
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState, updateState } from '../M99_Utilities/index.js'
import solc from 'solc'

const compileSystemContractsFacade = () => {
  console.log('[⚙️ PROCESO] Compilando 10_system_contracts_exchange_and_has.sol con solc 0.8.20...')
  const contractPath = new URL('./10_system_contracts_exchange_and_has.sol', import.meta.url)
  const sourceCode = fs.readFileSync(contractPath, 'utf8')

  const input = {
    language: 'Solidity',
    sources: {
      'SystemContractsFacade.sol': {
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

  const contract = compiled.contracts['SystemContractsFacade.sol'].SystemContractsFacade
  return {
    bytecode: contract.evm.bytecode.object,
    abi: contract.abi
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Contratos del Sistema Hedera EVM (0x168 y 0x16a) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromStringDer(operatorKey)

  try {
    let contractIdStr = getState('SYSTEM_CONTRACTS_FACADE_ID')
    let contractId

    if (contractIdStr) {
      contractId = ContractId.fromString(contractIdStr)
      console.log(`[✅ ÉXITO] Reutilizando contrato SystemContractsFacade ID: ${contractIdStr}`)
    } else {
      const { bytecode } = compileSystemContractsFacade()
      console.log(`[✅ ÉXITO] ¡Contrato Compilado! Longitud del Bytecode: ${bytecode.length} caracteres hex`)

      console.log('\n[⚙️ PROCESO] Paso 1: Desplegando SystemContractsFacade en Hedera EVM...')
      const deployTx = await new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(1500000)
        .setAdminKey(adminKey)
        .execute(client)

      const deployReceipt = await deployTx.getReceipt(client)
      contractId = deployReceipt.contractId
      contractIdStr = contractId.toString()
      updateState('SYSTEM_CONTRACTS_FACADE_ID', contractIdStr)

      console.log(`[✅ ÉXITO] SystemContractsFacade Desplegado con Contract ID: ${contractIdStr}`)
      console.log(`[📊 LOG] Dirección EVM: 0x${contractId.toEvmAddress()}`)
      console.log(`[🔗 EXPLORADOR] Ver en HashScan: ${getHashscanUrl(deployTx)}`)
    }

    // 2. Consultar Precompilación de Tasa de Cambio (0x168)
    console.log('\n[⚙️ PROCESO] Paso 2: Consultando Precompilación de Tasa de Cambio 0x168 directamente desde EVM...')
    const oneUsdTinycents = 100000000 // 1 USD = 10^8 tinycents

    const execTx = await new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(200000)
      .setFunction('getTinybarsForTinycents', new ContractFunctionParameters().addUint256(oneUsdTinycents))
      .execute(client)

    const record = await execTx.getRecord(client)
    const functionResult = record.contractFunctionResult
    const tinybarsPerDollar = functionResult.getUint256(0)
    const hbarPriceUsd = (1e8 / Number(tinybarsPerDollar)).toFixed(4)

    console.log('[✅ ÉXITO] ¡Consulta de Tasa de Cambio On-Chain Resuelta!')
    console.log(`[📊 LOG] 1 USD ($1.00) en Tinybars: ${tinybarsPerDollar.toString()} tinybars`)
    console.log(`[📊 LOG] Precio de Consenso Implícito:  $${hbarPriceUsd} USD / HBAR`)
    console.log(`[🔗 EXPLORADOR] Ver en HashScan:          ${getHashscanUrl(execTx)}`)
    console.log('[ℹ️ INFO] Precio obtenido directamente del estado de consenso en 1 llamada sin costo de oráculos.')

    // 3. Inspeccionar Capacidades del Servicio de Cuentas de Hedera (HAS 0x16a)
    console.log('\n[⚙️ PROCESO] Paso 3: Verificando Capacidades de la Precompilación HAS (0x16a)...')
    console.log('   Dirección de Precompilación: 0x000000000000000000000000000000000000016a')
    console.log('   Especificaciones HIP:        HIP-632 & HIP-906')
    console.log('   Funcionalidad:               Permite a contratos EVM verificar firmas de cualquier cuenta')
    console.log('   Formatos Soportados:         ED25519, secp256k1 ECDSA y KeyLists de Umbral')

    updateState('EXCHANGE_RATE_TINYBARS_PER_USD', tinybarsPerDollar.toString())
    updateState('EXCHANGE_RATE_IMPLIED_PRICE_USD', hbarPriceUsd)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Precompilaciones de Consenso Nativas: Los contratos Hedera EVM están enlazados')
    console.log('directamente al estado subyacente de la red. Pueden leer tasas de cambio nativas (0x168),')
    console.log('verificar firmas de cuentas multi-curva (0x16a) y ejecutar operaciones de tokens nativos (0x167).')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Cero Manipulaciones de Oráculos: Los protocolos construidos con 0x168 son inmunes')
    console.log('a la manipulación de precios de pools de liquidez descentralizados, ya que la tasa de cambio')
    console.log('está gobernada por la mediana ponderada de los nodos de consenso del Consejo de Gobierno de Hedera.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en la Ejecución de Contratos del Sistema:', error.message)
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
