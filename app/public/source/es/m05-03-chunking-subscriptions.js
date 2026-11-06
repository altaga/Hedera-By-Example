/**
 * ============================================================================
 * Lab 03: Fragmentación de Mensajes y Suscripciones gRPC
 * [CONCEPTO] Chunking y Streaming de Datos Descentralizado
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Superando Límites: Cada mensaje de HCS tiene un límite de ~4KB. Para enviar
 * payloads más grandes (log de IA, imágenes), se utiliza el "Chunking": un
 * patrón que divide los datos en fragmentos que se anclan de forma
 * secuencial al ledger. Al combinar esto con suscripciones gRPC
 * (`TopicMessageQuery`), puedes construir un canal de "Streaming
 * Descentralizado" donde los clientes reconstruyen la información en
 * tiempo real a medida que el consenso los confirma.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Cuando una carga supera el límite por mensaje (1024 bytes), el SDK divide los datos en fragmentos secuenciados. Los clientes suscritos reconstruyen el mensaje completo usando la marca de tiempo validStart.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message#chunk-a-message
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M5 Lab 02: Estándares de Datos
 * - Actual:   M5 Lab 03: Paginación y Fragmentación
 * - Siguiente: M5 Lab 04: Comunicaciones Seguras (Ping-Pong)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 01 de M5 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 03_chunking_subscriptions.js
 * ============================================================================
 */

import {
  TopicMessageQuery,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getState, exitIfStuck } from '../M99_Utilities/index.js'

/**
 * Publicador: Divide automáticamente los mensajes grandes de forma interna.
 */
const publishLargePayload = async (client, topicId, message) => {
  console.log(`[PROCESO] Fragmentando payload (${message.length} bytes)...`)

  // El SDK maneja la fragmentación (chunking) automáticamente
  const transaction = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .freezeWith(client)

  const response = await transaction.execute(client)
  const receipt = await response.getReceipt(client)

  return receipt.status.toString()
}

/**
 * Suscriptor: Utiliza gRPC para escuchar dinámicamente los mensajes entrantes.
 */
const subscribeToTopic = (client, topicId) => {
  console.log(`\n[INFO] gRPC: Suscribiéndose al canal de datos: ${topicId}`)
  console.log('[INFO] Escuchando mensajes en vivo (Ctrl+C para salir)...\n')

  return new TopicMessageQuery()
    .setTopicId(topicId)
    .setStartTime(0) // Recuperar histórico + Escucha en vivo
    .subscribe(
      client,
      (error) => { console.error('[FALLO] Fallo en la suscripción gRPC:', error); process.exit(1) },
      (message) => {
        const payload = Buffer.from(message.contents).toString()
        const timestamp = message.consensusTimestamp.toDate().toLocaleTimeString()

        console.log(`--- [EVENTO] Mensaje Confirmado [${timestamp}] ---`)
        console.log(`[REGISTRO] Secuencia: ${message.sequenceNumber.toString()}`)
        console.log(`[REGISTRO] Frag.: ${message.chunks ? message.chunks.length : 1} | Contenido: ${payload.substring(0, 100)}${payload.length > 100 ? '...' : ''}`)
        console.log('---------------------------------------------------\n')
      }
    )
}

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Streaming Descentralizado ---\n')

  const { client } = getClient()
  const topicId = getState('HCS_TOPIC_ID')

  if (!topicId) {
    console.error('[FALLO] Falta HCS_TOPIC_ID en el estado local.')
    process.exitCode = 1
    return
  }

  try {
    // 1. Iniciar la suscripción en tiempo real
    subscribeToTopic(client, topicId)

    // 2. Publicar un mensaje que obligue a la fragmentación
    console.log('[PROCESO] Preparando payload masivo para prueba de fragmentación...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    const largeMessage = 'Benchmark de fragmentación HCS. ' + 'Inyectando datos masivos... '.repeat(350)
    const status = await publishLargePayload(client, topicId, largeMessage)

    console.log(`\n[ÉXITO] Transmisión de fragmentos completada. Estado: ${status}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Al combinar Chunking con gRPC, creas sistemas de distribución')
    console.log('de datos que no dependen de servidores web tradicionales,')
    console.log('garantizando que la información se entregue con un orden')
    console.log('global y sellado de tiempo de red.')

    // Tiempo de espera para observar los mensajes en la consola antes de cerrar (demostración)
    setTimeout(() => {
      console.log('\n--- SESIÓN COMPLETADA ---')
      process.exit()
    }, 12000)
  } catch (error) {
    console.error('\n[FALLO] El flujo de mensajería fragmentada falló:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}

export { publishLargePayload, subscribeToTopic }
