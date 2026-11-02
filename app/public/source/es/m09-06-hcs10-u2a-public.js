/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Comunicación Humano-a-Agente HCS-10 (Pública)
 * [ CONCEPTO ] Orquestación Reactiva y Arquitectura Orientada a Eventos
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Reactividad Instantánea: La comunicación entre humanos y agentes en Hedera
 * no depende de bases de datos centralizadas; se basa en flujos de mensajes
 * en tiempo real. Mediante el uso de `TopicMessageQuery`, el sistema se
 * vuelve orientado a eventos: el agente "se despierta" instantáneamente
 * cuando recibe una señal en su Inbox, minimizando la latencia de respuesta
 * y eliminando la carga innecesaria de consultas constantes (polling). Es
 * la base para una orquestación ágil y eficiente en sistemas de IA
 * distribuida.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * La mensajería de Usuario a Agente (U2A) en consenso crea un registro de auditoría inmutable de instrucciones humanas, asegurando responsabilidad legal cuando los agentes ejecutan acciones financieras.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M9 Lab 05: Identidad Única Agéntica (HCS-14)
 * - Actual:   M9 Lab 06: Interacción Humano-a-Agente (HCS-10)
 * - Siguiente: M9 Lab 07: Comunicación Agente-a-Agente (A2A)
 *
 * [ SECUENCIA ]
 * Usuario -> Buzón del agente: Mensaje de solicitud (HCS-10)
 * Agente -> Buzón del agente: Suscribirse y leer la solicitud
 * Nota Agente: Procesa la solicitud
 * Agente -> Buzón del usuario: Mensaje de respuesta
 * Usuario -> Buzón del usuario: Leer la respuesta
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 04 de M9 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 06_hcs10_u2a_public.js
 * ============================================================================
 */

import { Client, PrivateKey, TopicMessageQuery, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getClient, getState, sleep, createClient, exitIfStuck } from '../M99_Utilities/index.js'

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  const sessionStart = new Date(Date.now() - 10000)
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Orquestación U2A Reactiva (HCS-10) ---\n')

  // Recuperación de Identidades (Agente A y Operador)
  const agentId = getState('HCS11_AGENT_A_ID')
  const agentKeyRaw = getState('HCS11_AGENT_A_KEY')
  const agentInbox = getState('HCS11_AGENT_A_INBOUND')
  const agentOutbox = getState('HCS11_AGENT_A_OUTBOUND')

  const { operatorId, operatorKey: operatorKeyRaw } = getClient()

  if (!agentId || !operatorId) {
    console.error('[❌ FALLO] Faltan identidades para la orquestación. Ejecuta Lab 04 primero.')
    process.exitCode = 1
    return
  }

  // --- COMPONENTE: SERVIDOR DEL AGENTE (Escucha Reactiva) ---
  const startAgent = async () => {
    const hederaClient = createClient().setOperator(agentId, agentKeyRaw)
    const hcs10Agent = new HCS10Client({
      network: 'testnet',
      operatorId: agentId,
      operatorPrivateKey: PrivateKey.fromString(agentKeyRaw).toStringRaw()
    })

    const processedMessages = new Set()
    console.log(`🤖 [ℹ️ INFO] Agente: Servicio Activo en Inbox [${agentInbox}]`)

    new TopicMessageQuery()
      .setTopicId(agentInbox)
      .setStartTime(0)
      .subscribe(
        hederaClient,
        (err) => { console.error(` [❌ FALLO] Mirror Node Agente: ${err.message}`); process.exit(1) },
        async (message) => {
          const tsString = message.consensusTimestamp.toString()
          if (processedMessages.has(tsString)) return
          processedMessages.add(tsString)

          if (message.consensusTimestamp.toDate() < sessionStart) return

          try {
            const content = Buffer.from(message.contents, 'utf8').toString()
            const rawJson = JSON.parse(content)
            const parsed = Array.isArray(rawJson) ? rawJson[0] : rawJson

            if (parsed?.data?.toLowerCase().includes('hola') || parsed?.data?.toLowerCase().includes('hello')) {
              console.log('\n--- 📥 AGENTE A: SOLICITUD DE AUDITORÍA RECIBIDA ---')
              const round = parsed.data.match(/\d+/) ? parsed.data.match(/\d+/)[0] : ''

              console.log('[⚙️ PROCESO] Procesando lógica de respuesta (Latencia simulada)...')
              await sleep(3000)

              await hcs10Agent.sendMessage(agentOutbox, {
                text: `¡Hola Humano! Ronda ${round} verificada.`.trim(),
                target: parsed.operator_id
              })
              console.log('[✅ ÉXITO] Respuesta enviada al canal de salida.')
            }
          } catch (e) { console.error('[❌ FALLO] El agente no pudo responder:', e.message) }
        }
      )
  }

  // --- COMPONENTE: CLIENTE USUARIO (Controlador de Flujo) ---
  const startClient = async () => {
    const { client: hederaClient } = getClient()
    const processedMessages = new Set()

    console.log(`👤 [ℹ️ INFO] Usuario: Controlador Activo en Outbox [${agentOutbox}]`)

    let currentRound = 1
    const maxRounds = 3

    const sendPing = async (round) => {
      console.log(`\n--- 📤 USUARIO: INICIANDO RONDA ${round} ---`)
      const rawPayload = JSON.stringify({ operator_id: operatorId, data: `Hola Agente, ronda ${round}` })
      const tx = await new TopicMessageSubmitTransaction()
        .setTopicId(agentInbox)
        .setMessage(rawPayload)
        .execute(hederaClient)

      await tx.getReceipt(hederaClient)
      console.log('[ℹ️ INFO] Mensaje publicado. Esperando callback del agente...')
    }

    new TopicMessageQuery()
      .setTopicId(agentOutbox)
      .setStartTime(0)
      .subscribe(
        hederaClient,
        (err) => { console.error(` [❌ FALLO] Mirror Node Usuario: ${err.message}`); process.exit(1) },
        async (message) => {
          const tsString = message.consensusTimestamp.toString()
          if (processedMessages.has(tsString)) return
          processedMessages.add(tsString)

          if (message.consensusTimestamp.toDate() < sessionStart) return

          try {
            const content = Buffer.from(message.contents, 'utf8').toString()
            const rawJson = JSON.parse(content)
            const parsed = Array.isArray(rawJson) ? rawJson[0] : rawJson

            const targetId = parsed?.data?.target ? String(parsed.data.target).trim() : 'none'
            const myId = String(operatorId).trim()

            if (targetId.includes(myId)) {
              const replyText = parsed.data.text || ''
              if (replyText.includes(`Ronda ${currentRound}`)) {
                console.log('\n--- 📥 USUARIO: RESPUESTA DE AGENTE DETECTADA ---')
                console.log(`[📊 REGISTRO] Mensaje: "${replyText}"`)

                if (currentRound < maxRounds) {
                  currentRound++
                  console.log('[⚙️ PROCESO] Preparando siguiente interacción...')
                  await sleep(4000)
                  await sendPing(currentRound)
                } else {
                  console.log('\n🏁 --- [✅ ÉXITO] Secuencia U2A completada. ---')
                  console.log('\n💡 CONCEPTO CLAVE:')
                  console.log('Callbacks con Estado: Los flujos de agentes reales se basan en comunicación')
                  console.log('paralela reactiva. En vez de sondear una API, ambas partes escuchan el ledger')
                  console.log('y solo avanzan cuando se cumplen los criterios esperados.')
                  console.log('\n--- SESIÓN COMPLETADA ---')
                  setTimeout(() => process.exit(), 1000)
                }
              }
            }
          } catch (e) { console.error('\n[❌ FALLO] Paquete de respuesta malformado:', e.message) }
        }
      )

    await sleep(2000)
    await sendPing(currentRound)
  }

  startAgent()
  startClient()
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
