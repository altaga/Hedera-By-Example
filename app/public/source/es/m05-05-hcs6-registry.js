/**
 * ============================================================================
 * Lab 05: Registro Descentralizado de Apps en HCS
 * [CONCEPTO] Descubrimiento de Servicios On-Chain
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Un registro en HCS es un tópico donde cada mensaje registra una entrada, y
 * cualquiera puede reconstruir la lista leyendo el tópico en orden. En lugar de
 * depender de una tienda de apps central, los desarrolladores publican el nombre,
 * sitio web y direcciones de su dApp en un tópico público, y los clientes lo
 * escuchan para descubrir servicios. Los estándares de HOL definen formatos de
 * registro (HCS-2 para registros, HCS-6 para hashinals dinámicos). Este lab usa su
 * propio esquema sencillo para mostrar el patrón; no implementa HCS-6.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Un tópico de registro le da a cada entrada un orden y una marca de tiempo de consenso que nadie puede reescribir. Acordar un esquema de mensaje común (como HCS-2) es lo que permite a otras apps leer tu registro sin pedirte permiso.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-6/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M5 Lab 04: Benchmark de Latencia HCS (Protocolo Ping-Pong)
 * - Siguiente: M5 Lab 06: Tópicos Monetizados Generadores de Ingresos en HBAR y HTS (HIP-991)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M5_Hedera_Consensus_Service/05_hcs6_registry.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicMessageQuery
} from '@hiero-ledger/sdk'
import { getClient, exitIfStuck } from '../M99_Utilities/index.js'

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  console.log('--- INICIO DE SESIÓN: Registro de Apps en HCS ---\n')

  const { client } = getClient()

  try {
    // 1. Crear un Tópico para que actúe como nuestro Registro descentralizado
    console.log('[PROCESO] Creando un Tópico HCS para el Registro...')
    let tx = await new TopicCreateTransaction()
      .setTopicMemo('Registro de Apps HBE (demo)')
      .execute(client)

    let receipt = await tx.getReceipt(client)
    const topicId = receipt.topicId
    console.log(`[ÉXITO] Tópico del Registro creado: ${topicId.toString()}`)

    // 2. Definir la carga útil de registro (un esquema sencillo hecho para este lab)
    const hcs6Payload = {
      p: 'hbe-app-registry', // this lab's own schema (not HCS-6)
      op: 'register',
      name: 'Hedera For Dummies dApp',
      description: 'Labs prácticos de Hedera (entrada de demo del curso).',
      tags: ['educacion', 'web3', 'hiero'],
      url: 'https://hbe.expo.app',
      metadata: {
        version: '1.0.0',
        author: 'VAI'
      }
    }

    console.log('\n[PROCESO] Enviando Carga Útil de Registro...')
    console.log(JSON.stringify(hcs6Payload, null, 2))

    tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(hcs6Payload))
      .execute(client)

    receipt = await tx.getReceipt(client)
    console.log(`[ÉXITO] ¡App registrada on-chain! Número de Secuencia: ${receipt.topicSequenceNumber.toString()}`)

    // 3. Suscribirse al Registro para descubrir aplicaciones
    console.log('\n[PROCESO] Suscribiéndose al Registro para descubrir nuevos servicios...')

    // Usamos una Promesa para esperar a que el mensaje se propague por el mirror node
    await new Promise((resolve) => {
      new TopicMessageQuery()
        .setTopicId(topicId)
        .setStartTime(0)
        .subscribe(
          client,
          (error) => { console.error('[FALLO] Error de Suscripción:', error); process.exit(1) },
          (message) => {
            const content = Buffer.from(message.contents).toString('utf8')
            try {
              const parsed = JSON.parse(content)
              if (parsed.p === 'hbe-app-registry' && parsed.op === 'register') {
                console.log('\n[DESCUBIERTO] ¡Nueva dApp Registrada!')
                console.log(`- Nombre: ${parsed.name}`)
                console.log(`- Desc:   ${parsed.description}`)
                console.log(`- URL:    ${parsed.url}`)
                console.log(`- Fecha:  ${message.consensusTimestamp.toDate()}`)

                // Desconectar y resolver una vez que encontramos nuestra app
                resolve()
              }
            } catch (e) {
              console.log('[INFO] Mensaje no JSON ignorado.')
            }
          }
        )
    })

    console.log('\n CONCEPTO CLAVE:')
    console.log('Un tópico de registro público permite listar o descubrir servicios sin un')
    console.log('único guardián. Como el tópico es abierto, cualquiera puede publicar basura,')
    console.log('así que los lectores deben filtrar entradas (por ejemplo, con submit key o firmas).')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Error de Ejecución:', error.message)
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
