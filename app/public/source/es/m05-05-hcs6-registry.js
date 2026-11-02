/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Registro Descentralizado HCS-6
 * [ CONCEPTO ] Descubrimiento de Servicios On-Chain
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * HCS-6 es un estándar de la comunidad para crear registros descentralizados
 * sobre el Hedera Consensus Service. En lugar de depender de una base de datos
 * centralizada (como Apple App Store o Google Play), los desarrolladores pueden
 * publicar los metadatos, sitio web y contratos inteligentes de su dApp en un
 * tópico público de HCS. Cualquier cliente puede escuchar este tópico para
 * descubrir nuevos servicios dinámicamente.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * HCS-6 define un estándar para registros descentralizados sobre consenso. Anclar configuraciones clave-valor a HCS permite que aplicaciones distribuidas consulten registros a prueba de censura sin bases de datos centrales.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hashgraphonline.com/standards/hcs-6/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M5 Lab 04: HCS Ping-Pong
 * - Actual:   M5 Lab 05: Registro Descentralizado HCS-6
 * - Siguiente: M5 Lab 06: Tópicos Pagados HIP-991
 *
 * [ CÓMO EJECUTAR ]
 * node 05_hcs6_registry.js
 * ============================================================================
 */

import {
  Client,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicMessageQuery
} from '@hiero-ledger/sdk'
import { getClient, exitIfStuck } from '../M99_Utilities/index.js'

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  console.log('--- INICIO DE SESIÓN: Registro HCS-6 ---\n')

  const { client } = getClient()

  try {
    // 1. Crear un Tópico para que actúe como nuestro Registro descentralizado
    console.log('[⚙️ PROCESO] Creando un Tópico HCS para el Registro...')
    let tx = await new TopicCreateTransaction()
      .setTopicMemo('Registro Global de Apps HCS-6')
      .execute(client)

    let receipt = await tx.getReceipt(client)
    const topicId = receipt.topicId
    console.log(`[✅ ÉXITO] Tópico del Registro creado: ${topicId.toString()}`)

    // 2. Definir la Carga Útil Compatible con HCS-6
    // El estándar HCS-6 dicta una estructura JSON específica para registrar un servicio.
    const hcs6Payload = {
      p: 'hcs-6',
      op: 'register',
      name: 'Hedera For Dummies dApp',
      description: 'La principal plataforma educativa para desarrolladores de Hedera.',
      tags: ['educacion', 'web3', 'hiero'],
      url: 'https://hedera.com',
      metadata: {
        version: '1.0.0',
        author: 'VAI'
      }
    }

    console.log('\n[⚙️ PROCESO] Enviando Carga Útil de Registro HCS-6...')
    console.log(JSON.stringify(hcs6Payload, null, 2))

    tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(hcs6Payload))
      .execute(client)

    receipt = await tx.getReceipt(client)
    console.log(`[✅ ÉXITO] ¡App registrada on-chain! Número de Secuencia: ${receipt.topicSequenceNumber.toString()}`)

    // 3. Suscribirse al Registro para descubrir aplicaciones
    console.log('\n[⚙️ PROCESO] Suscribiéndose al Registro para descubrir nuevos servicios...')

    // Usamos una Promesa para esperar a que el mensaje se propague por el mirror node
    await new Promise((resolve) => {
      new TopicMessageQuery()
        .setTopicId(topicId)
        .setStartTime(0)
        .subscribe(
          client,
          (error) => { console.error('[❌ FALLO] Error de Suscripción:', error); process.exit(1) },
          (message) => {
            const content = Buffer.from(message.contents).toString('utf8')
            try {
              const parsed = JSON.parse(content)
              if (parsed.p === 'hcs-6' && parsed.op === 'register') {
                console.log('\n[🔍 DESCUBIERTO] ¡Nueva dApp Registrada!')
                console.log(`- Nombre: ${parsed.name}`)
                console.log(`- Desc:   ${parsed.description}`)
                console.log(`- URL:    ${parsed.url}`)
                console.log(`- Fecha:  ${message.consensusTimestamp.toDate()}`)

                // Desconectar y resolver una vez que encontramos nuestra app
                resolve()
              }
            } catch (e) {
              console.log('[ℹ️ INFO] Mensaje no JSON ignorado.')
            }
          }
        )
    })

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('HCS-6 permite al ecosistema construir App Stores descentralizadas donde')
    console.log('ninguna entidad individual puede bloquear a un desarrollador. Actúa como')
    console.log('una sección amarilla global y resistente a la censura para servicios Web3.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Error de Ejecución:', error.message)
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
