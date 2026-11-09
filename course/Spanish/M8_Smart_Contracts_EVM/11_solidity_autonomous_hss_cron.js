/**
 * ============================================================================
 * Lab 11: Precompilación HSS Cron Autónomo en Solidity (0x16b)
 * [CONCEPTO] Contratos Inteligentes que se Autoprograman en Capa 1 de Hedera
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En los ecosistemas EVM tradicionales (Ethereum, Polygon, Arbitrum), los contratos
 * inteligentes son pasivos. No pueden "despertarse a sí mismos" en el futuro sin
 * depender de bots off-chain centralizados o costosas redes de keepers (Chainlink
 * Automation, Gelato). Si un keeper se queda sin gas o se desconecta, el protocolo falla.
 *
 * Hedera ofrece automatización de contratos inteligentes mediante el contrato de sistema HSS 0x16b:
 * 1. Autoprogramación: Un contrato inteligente en Solidity puede invocar `0x16b`
 *    (`IHederaScheduleService.scheduleCall`, HIP-1215) directamente desde el bytecode EVM.
 * 2. Programación Nativa en Capa 1: La transacción futura se envía a la capa de
 *    consenso de Hedera como una transacción programada con su ventana de ejecución.
 * 3. Ejecución Libre de Keepers: Al alcanzarse el momento o condición programada, los
 *    nodos de consenso gossip-about-gossip de Hedera ejecutan la transacción de forma
 *    autónoma sin requerir bots, servidores ni relayers externos.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Cada scheduleCall es una sola llamada futura, pagada por el propio contrato. Las tareas
 * recurrentes (reinversión de rendimientos, suscripciones, nóminas) salen de que la llamada
 * programada programe la siguiente, así que el contrato debe conservar HBAR suficiente.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/evm/hedera-services/system-contracts/schedule-service
 * - https://hips.hedera.com/hip/hip-755
 * - https://hips.hedera.com/hip/hip-1215
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M8 Lab 10: Inmersión en Contratos del Sistema: Tasa de Cambio 0x168 y Precompilación HAS 0x16a
 * - Siguiente: M9 Lab 01: Almacenamiento Estático HCS-1
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~16 ℏ la primera vez (crea un contrato, cerca de 1 USD, y le carga 1 ℏ para sus llamadas programadas); <1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
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
  ContractCallQuery,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState, updateState, executeWithGas, sleep, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'
import solc from 'solc'

const compileCronVaultContract = () => {
  console.log('[PROCESO] Compilando 11_solidity_autonomous_hss_cron.sol con solc 0.8.20...')
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
      throw new Error(`Error de compilación de Solidity: ${fatal[0].formattedMessage}`)
    }
  }

  const contract = compiled.contracts['AutonomousCronVault.sol'].AutonomousCronVault
  return {
    bytecode: contract.evm.bytecode.object,
    abi: contract.abi
  }
}

const DELAY_SECONDS = 20

const readCounter = async (client, contractId) => {
  const result = await new ContractCallQuery()
    .setContractId(contractId)
    .setGas(50000)
    .setFunction('heartbeatCounter')
    .execute(client)
  return Number(result.getUint256(0))
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Precompilación HSS Cron Autónomo (0x16b) ---\n')
  const { client } = getClient()

  try {
    let contractIdStr = getState('AUTONOMOUS_CRON_VAULT_V3_ID')
    let contractId

    if (contractIdStr) {
      contractId = ContractId.fromString(contractIdStr)
      console.log(`[ÉXITO] Reutilizando contrato AutonomousCronVault ID: ${contractIdStr}`)
    } else {
      const { bytecode } = compileCronVaultContract()
      console.log(`[ÉXITO] ¡Contrato Compilado! Longitud del Bytecode: ${bytecode.length} caracteres hex`)

      console.log('\n[PROCESO] Paso 1: Desplegando AutonomousCronVault con 1 ℏ para pagar sus llamadas programadas...')
      // Desplegar el contrato: el bytecode va on-chain y la red devuelve su contract ID y dirección EVM.
      const deployTx = await executeWithGas((gas) => new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(gas)
        .setInitialBalance(new Hbar(1)), client, { gas: 1500000 })
      // Sin admin key a propósito: así la llave del contrato es su propio ID y puede autorizar
      // (y pagar) las llamadas que programa. Con admin key, HSS necesitaría la firma de esa llave.

      // Esperar el consenso: el recibo dice si la red aceptó la transacción.
      const deployReceipt = await deployTx.getReceipt(client)
      contractId = deployReceipt.contractId
      contractIdStr = contractId.toString()
      updateState('AUTONOMOUS_CRON_VAULT_V3_ID', contractIdStr)

      console.log(`[ÉXITO] AutonomousCronVault Desplegado con Contract ID: ${contractIdStr}`)
      console.log(`[REGISTRO] Dirección EVM: 0x${contractId.toEvmAddress()}`)
      console.log(`[EXPLORADOR] Ver en HashScan: ${getHashscanUrl(deployTx)}`)
    }

    // 2. Ejecutar la tarea una vez a mano
    console.log('\n[PROCESO] Paso 2: Ejecutando performAutonomousHeartbeat() a mano...')
    // Llamar al contrato: una llamada que cambia estado es una transacción y paga gas.
    const heartbeatTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('performAutonomousHeartbeat'), client, { gas: 200000 })
    const heartbeatRecord = await heartbeatTx.getRecord(client)
    console.log(`[ÉXITO] ¡Latido Ejecutado! Estado: ${heartbeatRecord.receipt.status.toString()}`)
    const counterBefore = await readCounter(client, contractId)
    console.log(`[REGISTRO] heartbeatCounter = ${counterBefore}`)

    // 3. Pedir a HSS (0x16b) que ejecute el siguiente latido por su cuenta
    console.log(`\n[PROCESO] Paso 3: El contrato pide a HSS (0x16b scheduleCall) ejecutar el siguiente latido en ${DELAY_SECONDS} s...`)
    const scheduleCallTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('scheduleNextHeartbeat', new ContractFunctionParameters().addUint256(DELAY_SECONDS)), client, { gas: 400000 })

    const scheduleRecord = await scheduleCallTx.getRecord(client)
    const responseCode = Number(scheduleRecord.contractFunctionResult.getInt64(0))
    const scheduleAddress = scheduleRecord.contractFunctionResult.getAddress(1)
    console.log(`[REGISTRO] Estado de la llamada: ${scheduleRecord.receipt.status.toString()} | Código de respuesta HSS: ${responseCode}`)
    console.log(`[EXPLORADOR] Ver en HashScan: ${getHashscanUrl(scheduleCallTx)}`)
    updateState('AUTONOMOUS_CRON_LAST_TX_ID', scheduleCallTx.transactionId.toString())

    if (responseCode !== 22) {
      console.log(`[INFO] HSS no creó la programación (código ${responseCode}; -1 significa que falló la llamada a 0x16b).`)
      console.log('[INFO] Puede que scheduleCall (HIP-1215) aún no esté activo en esta red. No se programó nada.')
    } else {
      const scheduleId = `0.0.${parseInt(scheduleAddress, 16)}`
      console.log(`[ÉXITO] Programación ${scheduleId} creada por el propio contrato (0x${scheduleAddress})`)

      // 4. Esperar a que la red la ejecute y leer el resultado en el Mirror Node
      console.log(`\n[PROCESO] Paso 4: Esperando a que la red ejecute la programación ${scheduleId}...`)
      let executedAt = null
      for (let i = 0; i < 12 && !executedAt; i++) {
        await sleep(5000)
        const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/schedules/${scheduleId}`)
        if (res.ok) executedAt = (await res.json()).executed_timestamp
      }
      if (!executedAt) {
        console.log(`[INFO] La programación ${scheduleId} aún no se ejecuta (o el Mirror Node no se ha puesto al día). Revísala en HashScan.`)
      } else {
        const txRes = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions?timestamp=${executedAt}`)
        const result = txRes.ok ? (await txRes.json()).transactions?.[0]?.result : 'unknown'
        const counterAfter = await readCounter(client, contractId)
        console.log(`[REGISTRO] La llamada programada se ejecutó en el consenso ${executedAt}: ${result}`)
        if (result === 'SUCCESS' && counterAfter > counterBefore) {
          console.log(`[VERIFY] heartbeatCounter pasó de ${counterBefore} a ${counterAfter}: la red ejecutó la llamada sin ningún keeper.`)
        } else {
          console.log(`[INFO] La llamada programada se ejecutó pero no tuvo éxito (${result}); heartbeatCounter es ${counterAfter}.`)
        }
      }
    }

    console.log('\n CONCEPTO CLAVE:')
    console.log('Autoprogramación 0x16b: un contrato puede pedirle a Hedera que lo llame más tarde, y la')
    console.log('red ejecuta esa llamada sola cuando llega el momento, sin bots keeper. El contrato la')
    console.log('paga con su propio saldo de HBAR.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Cada scheduleCall es una sola llamada futura. Para una tarea recurrente, la llamada')
    console.log('programada programa la siguiente, y el contrato debe conservar HBAR para todas.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la ejecución del cron autónomo:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de Ejecución:', error.message)
      process.exit(1)
    })
}
