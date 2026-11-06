/**
 * ============================================================================
 * Lab 08: Controlador de Gobernanza Timelock y Veto del Consejo de Seguridad
 * [CONCEPTO] Ventanas de Ejecución con Bloqueo Temporal y Autoridad de Veto Criptográfico
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En tesorerías institucionales de alto valor y gobernanza descentralizada (DAOs),
 * la aprobación de una votación o firma de umbral NUNCA debe ejecutarse al instante.
 * Si una clave de administrador se ve comprometida o se aprueba una propuesta maliciosa,
 * la ejecución inmediata resulta en el drenaje total de los fondos.
 *
 * La gobernanza empresarial exige una Ventana de Retraso Timelock:
 * 1. Propuesta con Bloqueo Temporal: Se programa mediante `ScheduleCreateTransaction`
 *    con `waitForExpiry: true` y una ventana de expiración (ej. 24 a 48 horas).
 * 2. Múltiples Firmas Asíncronas: Los fideicomisarios envían aprobaciones off-chain
 *    u on-chain mediante `ScheduleSignTransaction`.
 * 3. Consejo de Seguridad de Guardia: Durante el timelock, un Consejo de Seguridad
 *    independiente (o monitor de riesgo algorítmico) audita la transacción pendiente.
 * 4. Veto Criptográfico: Si se detectan parámetros maliciosos o claves vulneradas,
 *    el Consejo de Seguridad ejecuta `ScheduleDeleteTransaction` usando su `adminKey`.
 *    La propuesta es eliminada irreversiblemente en Capa 1.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * A diferencia de los contratos TimelockController de Ethereum que cuestan $30-$100 en desplegar
 * y operar, Hedera ofrece timelocks criptográficos y eliminación por veto directamente
 * en el protocolo de consenso. Las transacciones programadas no pueden ser secuestradas ni adelantadas (front-run).
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-423
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/schedule-transaction
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M7 Lab 07: DAO de Tesorería Autónoma Guiada por Webhooks
 * - Siguiente: M8 Lab 01: Despliegue de Contratos Inteligentes
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M7_Governance_Cron/08_timelock_governance_controller.js
 * ============================================================================
 */

import {
  AccountId,
  ScheduleCreateTransaction,
  ScheduleDeleteTransaction,
  TransferTransaction,
  PrivateKey,
  Timestamp,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

/**
 * Simulación del Auditor de Riesgos del Consejo de Seguridad
 */
class GovernanceRiskMonitor {
  constructor (prohibitedAccounts = []) {
    this.prohibitedAccounts = new Set(prohibitedAccounts)
  }

  auditProposal (targetAccountId, transferAmount) {
    console.log(`[ MONITOR DE SEGURIDAD] Auditando propuesta pendiente: Destinatario=${targetAccountId}, Monto=${transferAmount}...`)
    if (this.prohibitedAccounts.has(targetAccountId)) {
      return { approved: false, reason: 'CRÍTICO: ¡Destinatario marcado en lista de sanciones!' }
    }
    return { approved: true, reason: 'Propuesta aprobada por el filtro automatizado de cumplimiento.' }
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Controlador de Gobernanza Timelock y Veto del Consejo de Seguridad ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Generar Clave Guardiana del Consejo de Seguridad y Clave de Fideicomisario
    console.log('[PROCESO] Paso 1: Configurando Identidades del Consejo de Seguridad y Fideicomisarios...')
    const securityCouncilKey = PrivateKey.generateED25519()
    const trusteeKey = PrivateKey.generateED25519()
    const maliciousRecipient = '0.0.9999999' // Cuenta en lista negra para la simulación

    console.log(`[LOG] Operador / Tesorería:        ${operatorId.toString()}`)
    console.log(`[LOG] Clave Guardiana de Consejo:  ${securityCouncilKey.publicKey.toStringDer().substring(0, 32)}...`)
    console.log(`[LOG] Clave Multifirma Fideicomiso: ${trusteeKey.publicKey.toStringDer().substring(0, 32)}...`)

    // 2. Programar una Acción de Tesorería con Bloqueo Temporal (Timelock)
    console.log('\n[PROCESO] Paso 2: Programando Pago de Tesorería con Timelock (Ventana de 48h)...')

    // Transacción interna: Transferir 0 HBAR a modo de ping benigno
    const innerTransferTx = new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(0))
      .setTransactionMemo('GOBERNANZA:TESORERIA:PROPUESTA_#42')

    // Crear la programación con el Consejo de Seguridad como adminKey (otorga poder de veto)
    // En Hedera, la adminKey debe co-firmar ScheduleCreateTransaction para autorizar su rol administrativo,
    // y waitForExpiry = true con expirationTime garantiza que la ejecución se posponga hasta madurar el timelock
    const expiryDate = new Date(Date.now() + 86400000)
    const scheduleCreateTx = await (await new ScheduleCreateTransaction()
      .setScheduledTransaction(innerTransferTx)
      .setAdminKey(securityCouncilKey.publicKey)
      .setScheduleMemo('PROPUESTA_TIMELOCK_#42')
      .setPayerAccountId(AccountId.fromString(operatorId))
      .setExpirationTime(Timestamp.fromDate(expiryDate))
      .setWaitForExpiry(true)
      .freezeWith(client)
      .sign(securityCouncilKey))
      .execute(client)

    const scheduleReceipt = await scheduleCreateTx.getReceipt(client)
    const scheduleId = scheduleReceipt.scheduleId

    console.log(`[ÉXITO] ¡Propuesta Bloqueada en Capa 1! ID de Programación: ${scheduleId.toString()}`)
    console.log(`[LOG] ID de Transacción:  ${scheduleCreateTx.transactionId.toString()}`)
    console.log(`[EXPLORADOR] Ver en HashScan: ${getHashscanUrl(scheduleCreateTx)}`)

    // 3. El Monitor de Seguridad detecta una infracción durante la Ventana Timelock
    console.log('\n[PROCESO] Paso 3: Inspección Automatizada de Riesgos por el Consejo de Seguridad...')
    const monitor = new GovernanceRiskMonitor([maliciousRecipient])
    const auditResult = monitor.auditProposal(maliciousRecipient, '50,000 HBAR')

    console.log(`[ ALERTA DE RIESGO] Resultado de Auditoría: ${auditResult.reason}`)
    console.log('[ACCIÓN] Activando Veto Criptográfico de Emergencia del Consejo de Seguridad...')

    // 4. El Consejo de Seguridad ejecuta el VETO de emergencia mediante ScheduleDeleteTransaction
    console.log('\n[PROCESO] Paso 4: Firmando y Transmitiendo ScheduleDeleteTransaction...')
    const deleteTx = await (await new ScheduleDeleteTransaction()
      .setScheduleId(scheduleId)
      .freezeWith(client)
      .sign(securityCouncilKey))
      .execute(client)

    const deleteReceipt = await deleteTx.getReceipt(client)
    console.log(`\n[ÉXITO] ¡Veto de Emergencia Ejecutado! Estado de Consenso: ${deleteReceipt.status.toString()}`)
    console.log(`[LOG] ID de Transacción de Eliminación: ${deleteTx.transactionId.toString()}`)
    console.log(`[EXPLORADOR] Ver en HashScan:          ${getHashscanUrl(deleteTx)}`)

    updateState('TIMELOCK_SCHEDULE_ID', scheduleId.toString())
    updateState('TIMELOCK_VETO_STATUS', deleteReceipt.status.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Seguridad Timelock Nativa: El Servicio de Programación de Hedera permite a las')
    console.log('organizaciones definir una clave de administración (adminKey) en cualquier transacción programada.')
    console.log('Si los monitores de riesgo detectan parámetros fraudulentos, la adminKey puede borrar')
    console.log('la transacción antes de que madure el timelock, impidiendo cualquier movimiento no autorizado.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Dado que la programación nativa de Hedera es aplicada directamente por los nodos de consenso,')
    console.log('no existe código de smart contract que pueda sufrir ataques de reentrada, congelamiento')
    console.log('o préstamos flash. La gobernanza corporativa está integrada en el protocolo Byzantine Fault Tolerant.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo en el Controlador Timelock:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
