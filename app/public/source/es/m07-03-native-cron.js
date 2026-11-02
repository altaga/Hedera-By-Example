/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Transacciones Programadas (Cron Nativo)
 * [ CONCEPTO ] Ejecución Diferida y Automatización de Capa 1
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Cron sin Servidor: La capacidad de programar transacciones para ejecución
 * futura directamente en el ledger elimina la dependencia de servidores
 * externos, servicios de Cloud (AWS Lambda) o intermediarios centralizados.
 * Al usar `ScheduleCreateTransaction`, encapsulas una operación que se
 * ejecutará automáticamente tan pronto como se cumpla el tiempo o se reúnan
 * las firmas necesarias. Esto garantiza que pagos de nómina, suscripciones
 * o triggers de contratos se ejecuten incluso si tu infraestructura cae,
 * delegando la confiabilidad a la red global de Hedera.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El Schedule Service (HSS) actúa como un demonio cron nativo en el ledger: permite programar transacciones para ejecución automática en una marca de tiempo futura sin servidores centralizados.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/schedule-transaction
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M7 Lab 02: Ejecución de Transferencia Multisig
 * - Actual:   M7 Lab 03: Automatización Nativa (Cron)
 * - Siguiente: M7 Lab 04: Orquestación Desacoplada
 *
 * [ CÓMO EJECUTAR ]
 * node 03_native_cron.js
 * ============================================================================
 */

import {
  AccountId,
  Hbar,
  ScheduleCreateTransaction, TransferTransaction, Timestamp
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState, getState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Automatización Nativa (Cron) ---\n')

  const { client, operatorId } = getClient()
  const targetId = getState('ACCOUNT_1_ID')

  if (!targetId) {
    console.error('[❌ FALLO] Falta ACCOUNT_1_ID en el estado local. Verifica la configuración inicial.')
    process.exitCode = 1
    return
  }

  try {
    console.log('[⚙️ PROCESO] Definiendo transferencia diferida de 0.1 HBAR...')

    // 1. Transacción Interna (La que se ejecutará en el futuro)
    const innerTx = new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(targetId), new Hbar(-0.1))
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(0.1))

    // 2. Programación (Schedule)
    // Definimos expiración en 5 minutos para esta demostración.
    const expiracion = new Date()
    expiracion.setMinutes(expiracion.getMinutes() + 5)

    console.log('[⚙️ PROCESO] Creando Schedule en el ledger con ventana de 5 minutos...')
    const scheduleTx = await new ScheduleCreateTransaction()
      .setScheduledTransaction(innerTx)
      .setPayerAccountId(AccountId.fromString(operatorId))
      .setScheduleMemo('Automatización de Nómina - M7.3 Spanish')
      .setExpirationTime(Timestamp.fromDate(expiracion))
      .setWaitForExpiry(false) // Ejecutar inmediatamente tras el quorum de firmas
      .freezeWith(client)

    const response = await scheduleTx.execute(client)
    const receipt = await response.getReceipt(client)
    const scheduleId = receipt.scheduleId.toString()

    console.log(`\n[✅ ÉXITO] Transacción Programada con éxito: ${scheduleId}`)
    console.log(`[📊 REGISTRO] Ver en HashScan: ${getHashscanUrl(response)}`)
    console.log('[ℹ️ INFO] La operación reside ahora en la sala de espera del ledger.')

    // Sincronizar ID para auditorías posteriores
    updateState('SCHEDULE_ID', scheduleId)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Al programar la lógica directamente en el ledger, descentralizas')
    console.log('el tiempo de ejecución. El estado pendiente es público y')
    console.log('verificable, permitiendo auditorías de pagos futuros antes de')
    console.log('que ocurran realmente.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] El despliegue de la automatización cron falló:', error.message)
    process.exitCode = 1
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
