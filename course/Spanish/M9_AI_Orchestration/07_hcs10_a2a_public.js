/**
 * ============================================================================
 * Lab 07: Orquestación Agente-a-Agente (A2A) HCS-10
 * [CONCEPTO] Comunicación Entre Agentes y Sincronización de Estado
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
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M9 Lab 06: Comunicación Humano-a-Agente HCS-10 (Pública)
 * - Siguiente: M9 Lab 08: Ataque de Suplantación HCS-10 (Hijacking)
 *
 * [ SECUENCIA ]
 * Agente A -> Buzón del agente B: Mensaje de la ronda 1
 * Agente B -> Buzón del agente A: Respuesta
 * Agente A -> Buzón del agente B: Mensaje de la ronda 2
 * Agente B -> Buzón del agente A: Respuesta
 * Nota Agente B: Los mensajes son públicos y sin firma
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 04 de M9 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M9_AI_Orchestration/07_hcs10_a2a_public.js
 * ============================================================================
 */

import { TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getState, sleep, createClient, exitIfStuck, loadEnv } from '../M99_Utilities/index.js'

loadEnv() // lee course/.env (y el .env de la raíz del repositorio)

const main = async () => {
  // Nunca quedarse colgado: falla con un mensaje claro si la red no responde.
  exitIfStuck(180_000, 'los mensajes de la suscripción')
  const sessionStart = new Date(Date.now() - 10000) // 10 s hacia atrás por la propagación del Mirror Node
  console.log('--- INICIO DE SESIÓN: Simulación de Orquestación Autónoma ---\n')

  // --- CONFIGURACIÓN ---
  const agentAId = getState('HCS11_AGENT_A_ID')
  const agentAKey = getState('HCS11_AGENT_A_KEY')
  const agentBId = getState('HCS11_AGENT_B_ID')
  const agentBKey = getState('HCS11_AGENT_B_KEY')

  const inbox = getState('HCS11_AGENT_B_INBOUND')
  const outbox = getState('HCS11_AGENT_B_OUTBOUND')

  if (!agentAId || !agentBId || !inbox || !outbox) {
    console.error('[FALLO] Faltan los agentes y sus tópicos. Ejecuta primero el Lab 04 de M9.')
    process.exitCode = 1
    return
  }

  // --- AGENTE B: EL SERVICIO REACTIVO ---
  const startAgentB = async () => {
    const client = createClient().setOperator(agentBId, agentBKey)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentBId, operatorPrivateKey: agentBKey })
    const processedMessages = new Set()

    console.log(`[INFO] El Agente B vigila su Buzón [${inbox}]...`)

    // Suscripción a través del Mirror Node: los mensajes llegan en orden de consenso.
    new TopicMessageQuery()
      .setTopicId(inbox)
      .setStartTime(sessionStart)
      .subscribe(client, null, async (msg) => {
        const tsString = msg.consensusTimestamp.toString()
        if (processedMessages.has(tsString)) return
        processedMessages.add(tsString)

        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          const envelope = JSON.parse(content)
          const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

          if (data?.text?.includes('Hello')) {
            console.log('\n---  [REGISTRO] AGENTE B: EVENTO RECIBIDO ---')
            console.log(`[INFO] Mensaje observado en el tópico: ${inbox}`)
            console.log(`[REGISTRO] Contenido: "${data.text}"`)

            const roundMatch = data.text.match(/\d+/)
            const round = roundMatch ? roundMatch[0] : 'unknown'

            console.log(`[PROCESO] El Agente B procesa la ronda ${round}...`)
            await sleep(5000)

            console.log('[ÉXITO] Enviando la respuesta al Outbox...')
            await hcs10.sendMessage(outbox, {
              text: `World ${round}!`,
              target: agentAId
            })
          }
        } catch (e) { console.error('[FALLO] El agente no pudo responder:', e.message) }
      })
  }

  // --- AGENTE A: EL QUE INICIA LA SECUENCIA ---
  const startAgentA = async () => {
    const client = createClient().setOperator(agentAId, agentAKey)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentAId, operatorPrivateKey: agentAKey })
    const processedMessages = new Set()

    let currentRound = 1
    const maxRounds = 3

    console.log(`[INFO] El Agente A vigila el Outbox [${outbox}]...`)

    const sendPing = async (round) => {
      console.log('\n---  [PROCESO] AGENTE A: ACTUALIZACIÓN DE ESTADO ---')
      console.log(`[PROCESO] Iniciando la ronda ${round}...`)

      await hcs10.sendMessage(inbox, {
        operator_id: agentAId,
        text: `Hello ${round}`
      })
      console.log(`[ÉXITO] Publicado "Hello ${round}" en el Buzón.`)
    }

    new TopicMessageQuery()
      .setTopicId(outbox)
      .setStartTime(sessionStart)
      .subscribe(client, null, async (msg) => {
        const tsString = msg.consensusTimestamp.toString()
        if (processedMessages.has(tsString)) return
        processedMessages.add(tsString)

        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          if (content.includes(`World ${currentRound}`)) {
            console.log('\n---  [REGISTRO] AGENTE A: RESPUESTA CONFIRMADA ---')
            console.log(`[ÉXITO] Respuesta válida recibida para la ronda ${currentRound}.`)

            if (currentRound < maxRounds) {
              currentRound++
              await sleep(5000)
              await sendPing(currentRound)
            } else {
              console.log('\n [ÉXITO] Secuencia de comunicación completa.')
              console.log('\n CONCEPTO CLAVE:')
              console.log('Autonomía Cooperativa: este lab muestra la orquestación básica en la que')
              console.log('dos agentes actúan como un "enjambre". Al desacoplarlos y usar el ledger')
              console.log('como capa de coordinación, el sistema es tolerante a fallos y fácil de')
              console.log('auditar.')
              console.log('\n--- SESIÓN COMPLETADA ---\n')
              process.exit()
            }
          }
        } catch (e) {
          console.error('\n[FALLO] Falla del reactor:', e.message)
          process.exitCode = 1
        }
      })

    await sendPing(currentRound)
  }

  startAgentB()
  setTimeout(startAgentA, 3000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
