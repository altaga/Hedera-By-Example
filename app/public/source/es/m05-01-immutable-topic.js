/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Creación de Topic HCS Inmutable
 * [CONCEPTO] Colas de Mensajes Descentralizadas (Topics)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Auditoría Descentralizada: El Hedera Consensus Service (HCS) es una
 * implementación de grado empresarial del patrón Pub/Sub. A diferencia de
 * servicios tradicionales como Kafka, el HCS no tiene un broker central;
 * los nodos de Hedera actúan como el broker, garantizando que los mensajes
 * sean inmutables y estén ordenados globalmente. Un Topic sin `adminKey`
 * es permanente e indestructible, sirviendo como la base ideal para
 * auditorías de registros, coordinación de agentes de IA y cadenas de
 * suministro verificables.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los topics de HCS creados sin adminKey ni submitKey se convierten en canales de difusión públicos e inmutables. Cualquiera puede auditar el orden de los mensajes con marcas de tiempo de consenso matemáticamente probadas.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/consensus-service
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M4 Lab 05: Transferencias en Paralelo
 * - Actual:   M5 Lab 01: Mensajería Inmutable
 * - Siguiente: M5 Lab 02: Estándares de Datos
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 01_immutable_topic.js
 * ============================================================================
 */

import { TopicCreateTransaction } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Despliegue de Canal de Mensajería HCS ---\n')

  const { client } = getClient()

  try {
    console.log('[PROCESO] Ejecutando creación de Tema (Topic) en el Hedera Consensus Service...')

    // Creamos un Tema abierto (Sin llaves) para facilitar la experimentación pública.
    // En producción, se usaría .setSubmitKey() para restringir quién puede publicar.
    const transaction = await new TopicCreateTransaction()
      .setTopicMemo('Hedera Syllabus HCS Topic')
      .freezeWith(client)

    const response = await transaction.execute(client)

    console.log(`[REGISTRO] ID Transacción: ${response.transactionId.toString()}`)
    console.log(`[REGISTRO] Ver en HashScan: ${getHashscanUrl(response)}`)

    const receipt = await response.getReceipt(client)
    const topicId = receipt.topicId.toString()

    console.log(`\n[ÉXITO] Tema HCS creado exitosamente: ${topicId}`)

    // Sincronizar el Topic ID para laboratorios posteriores
    console.log('[INFO] Guardando Topic ID en el estado local del módulo...')
    updateState('HCS_TOPIC_ID', topicId)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Al no asignar una adminKey, el tema es ahora "Inmutable".')
    console.log('Nadie puede borrar los mensajes ni cerrar el canal, creando')
    console.log('una fuente de verdad inmutable para cualquier aplicación')
    console.log('distribuida.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] La creación del Topic HCS falló:', error.message)
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
