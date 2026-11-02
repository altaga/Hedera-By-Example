/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 07: Orquestación Agente-a-Agente (A2A) HCS-10
 * [ CONCEPTO ] Comunicación Entre Agentes y Sincronización de Estado
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Colaboración Autónoma: La arquitectura HCS-10 escala más allá de la
 * interacción humana, permitiendo que múltiples agentes coordinen tareas
 * de forma paralela. En este flujo, el Agente A actúa como el iniciador y
 * el Agente B como el servicio reactivo. Mediante streaming gRPC, los
 * agentes establecen un bucle de retroalimentación (feedback loop)
 * inmutable, donde cada "Ronda" de comunicación queda registrada en el
 * ledger, permitiendo auditorías forenses sobre cómo y cuándo se tomaron
 * decisiones colectivas entre inteligencias artificiales.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * La orquestación de Agente a Agente (A2A) sobre topics abiertos de consenso permite colaboración descentralizada entre máquinas, donde modelos autónomos negocian tareas sin colas de mensajes centrales.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hashgraphonline.com/standards/hcs-10/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M9 Lab 06: Interacción Humano-a-Agente (U2A)
 * - Actual:   M9 Lab 07: Comunicación Agente-a-Agente (A2A)
 * - Siguiente: M9 Lab 08: Simulación de Ataque de Suplantación
 *
 * [ CÓMO EJECUTAR ]
 * node 07_hcs10_a2a_public.js
 * ============================================================================
 */

import { Client, TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getState, sleep, createClient, exitIfStuck } from '../M99_Utilities/index.js'

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  const sessionStart = new Date(Date.now() - 10000)
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Orquestación A2A Autónoma (HCS-10) ---\n')

  // --- CONFIGURACIÓN DE IDENTIDADES ---
  const agentA_Id = getState('HCS11_AGENT_A_ID')
  const agentA_Key = getState('HCS11_AGENT_A_KEY')
  const agentB_Id = getState('HCS11_AGENT_B_ID')
  const agentB_Key = getState('HCS11_AGENT_B_KEY')

  const inbox = getState('HCS11_AGENT_B_INBOUND')
  const outbox = getState('HCS11_AGENT_B_OUTBOUND')

  if (!agentA_Id || !agentB_Id || !inbox || !outbox) {
    console.error('[❌ FALLO] Faltan identidades de agentes o canales de comunicación.')
    process.exitCode = 1
    return
  }

  // --- COMPONENTE: AGENTE B (Servicio Reactivo) ---
  const startAgentB = async () => {
    const client = createClient().setOperator(agentB_Id, agentB_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentB_Id, operatorPrivateKey: agentB_Key })
    const processedMessages = new Set()

    console.log(`🤖 [ℹ️ INFO] Agente B: Operativo en Inbox [${inbox}]...`)

    new TopicMessageQuery()
      .setTopicId(inbox)
      .setStartTime(0)
      .subscribe(
        client,
        (err) => { console.error(` [❌ FALLO] Mirror Node Agente B: ${err.message}`); process.exit(1) },
        async (msg) => {
          const tsString = msg.consensusTimestamp.toString()
          if (processedMessages.has(tsString)) return
          processedMessages.add(tsString)

          if (msg.consensusTimestamp.toDate() < sessionStart) return

          const content = Buffer.from(msg.contents, 'utf8').toString()

          try {
            const envelope = JSON.parse(content)
            const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

            if (data?.text?.includes('Hola') || data?.text?.includes('Hello')) {
              console.log('\n--- 📥 AGENTE B: EVENTO DE ORQUESTACIÓN RECIBIDO ---')
              console.log(`[📊 REGISTRO] Mensaje: "${data.text}"`)

              const roundMatch = data.text.match(/\d+/)
              const round = roundMatch ? roundMatch[0] : 'desconocida'

              console.log(`[⚙️ PROCESO] Ejecutando análisis para la Ronda ${round}...`)
              await sleep(3000)

              console.log('[✅ ÉXITO] Enviando respuesta de conformidad al canal de salida.')
              await hcs10.sendMessage(outbox, {
                text: `¡Mensaje Ronda ${round} Procesado!`,
                target: agentA_Id
              })
            }
          } catch (e) { }
        }
      )
  }

  // --- COMPONENTE: AGENTE A (Iniciador de Secuencia) ---
  const startAgentA = async () => {
    const client = createClient().setOperator(agentA_Id, agentA_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentA_Id, operatorPrivateKey: agentA_Key })
    const processedMessages = new Set()

    let currentRound = 1
    const maxRounds = 3

    console.log(`🤖 [ℹ️ INFO] Agente A: Operativo en Outbox [${outbox}]...`)

    const sendPing = async (round) => {
      console.log('\n--- 🤖 AGENTE A: ACTUALIZACIÓN DE ESTADO ---')
      console.log(`[⚙️ PROCESO] Iniciando Ronda ${round} de coordinación...`)

      await hcs10.sendMessage(inbox, {
        operator_id: agentA_Id,
        text: `Hola Agente B, sincronizando ronda ${round}`
      })
      console.log(`[ℹ️ INFO] Señal de Ronda ${round} publicada en el ledger.`)
    }

    new TopicMessageQuery()
      .setTopicId(outbox)
      .setStartTime(0)
      .subscribe(
        client,
        (err) => { console.error(` [❌ FALLO] Mirror Node Agente A: ${err.message}`); process.exit(1) },
        async (msg) => {
          const tsString = msg.consensusTimestamp.toString()
          if (processedMessages.has(tsString)) return
          processedMessages.add(tsString)

          if (msg.consensusTimestamp.toDate() < sessionStart) return

          const content = Buffer.from(msg.contents, 'utf8').toString()

          if (content.includes(`Ronda ${currentRound}`)) {
            console.log('\n--- 📥 AGENTE A: RESPUESTA DE COLABORACIÓN CONFIRMADA ---')
            console.log(`[✅ ÉXITO] Recibida confirmación válida para la Ronda ${currentRound}.`)

            if (currentRound < maxRounds) {
              currentRound++
              await sleep(4000)
              await sendPing(currentRound)
            } else {
              console.log('\n🏁 --- [✅ ÉXITO] Secuencia completada. Todos los agentes sincronizados. ---')
              console.log('\n💡 CONCEPTO CLAVE:')
              console.log('Autonomía Cooperativa: Este laboratorio demuestra una orquestación fundamental')
              console.log('donde dos agentes actúan como un "Enjambre". Al desacoplar los agentes y usar')
              console.log('el ledger como capa de coordinación, se crea un sistema tolerante a fallos y auditable.')
              console.log('\n--- SESIÓN COMPLETADA ---\n')
              setTimeout(() => process.exit(), 1000)
            }
          }
        }
      )

    await sendPing(currentRound)
  }

  // --- ORQUESTACIÓN DE INICIO ---
  startAgentB()
  setTimeout(startAgentA, 4000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
