/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Orquestación Desacoplada y Quórum
 * [ CONCEPTO ] Recolección de Fragmentos de Firma
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Orquestación sin Confianza: Una de las ventajas más potentes de las
 * transacciones programadas es que el "Orquestador" (el servidor que inicia
 * el proceso) no necesita poseer ninguna de las llaves privadas de los
 * firmantes. Simplemente informa a las partes el `ScheduleId` y éstas
 * envían su aprobación (`ScheduleSignTransaction`) de forma independiente
 * y asíncrona directamente al ledger. Hedera actúa como el juez imparcial
 * que ejecuta la operación interna en el preciso milisegundo en que se
 * alcanza el quórum criptográfico.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * La programación desacoplada permite que una entidad cree y pague la transacción, mientras que los firmantes autorizados aportan sus firmas de forma independiente hasta alcanzar el quórum de ejecución.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/schedule-transaction/sign-a-scheduled-transaction
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M7 Lab 03: Automatización Nativa (Cron)
 * - Actual:   M7 Lab 04: Orquestación Desacoplada
 * - Siguiente: M7 Lab 05: Identidad Descentralizada (DID)
 *
 * [ CÓMO EJECUTAR ]
 * node 04_decoupled_orchestration.js
 * ============================================================================
 */

import { PrivateKey, ScheduleSignTransaction } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Recolección de Firmas (Quórum) ---\n')

  const { client } = getClient()
  const userKey = getState('ACCOUNT_1_PRIVATE_KEY')
  const scheduleId = getState('SCHEDULE_ID')

  if (!userKey || !scheduleId) {
    console.error('[❌ FALLO] Faltan credenciales o el ID de programación. Ejecuta Lab 03 primero.')
    process.exitCode = 1
    return
  }

  try {
    console.log(`[ℹ️ INFO] Localizando Schedule en el ledger: ${scheduleId}`)
    console.log('[⚙️ PROCESO] Proporcionando firma de aprobación de la billetera secundaria...')

    // Usamos ScheduleSignTransaction para añadir firmas a una transacción pendiente
    const transaction = await new ScheduleSignTransaction()
      .setScheduleId(scheduleId)
      .freezeWith(client)

    // Firmar con la llave requerida para cumplir el quórum del Schedule
    const signedTx = await transaction.sign(PrivateKey.fromString(userKey))

    const response = await signedTx.execute(client)
    const receipt = await response.getReceipt(client)

    console.log(`\n[✅ ÉXITO] Firma recolectada y anclada. Estado: ${receipt.status.toString()}`)
    console.log(`[📊 REGISTRO] Ver transacción de firma en HashScan: ${getHashscanUrl(response)}`)

    console.log('[ℹ️ INFO] Si el umbral se alcanzó con esta firma, la operación interna ha sido ejecutada.')

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Este desacoplamiento permite flujos de trabajo institucionales')
    console.log('complejos donde múltiples departamentos pueden firmar una')
    console.log('operación desde diferentes dispositivos y ubicaciones sin')
    console.log('nunca compartir sus llaves privadas entre sí o con el servidor.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La orquestación de firmas falló:', error.message)
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
