/**
 * ============================================================================
 * Lab 08: Ataque de Suplantación HCS-10 (Hijacking)
 * [CONCEPTO] Vulnerabilidad de los Flujos Públicos
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La Brecha de Identidad: En los labs anteriores procesamos los mensajes solo
 * por su contenido. Como los tópicos HCS son públicos, cualquiera que conozca
 * el Topic ID puede publicar "spam" o "falsificaciones". Este lab presenta a
 * un adversario (Agente C) que intenta secuestrar la conversación imitando el
 * formato del protocolo. Verás que, sin validación criptográfica de la sesión,
 * los agentes no tienen defensa contra quien conoce el formato de los mensajes.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los tópicos de consenso públicos permiten que cualquiera publique mensajes. Simular un ataque de suplantación muestra por qué la comunicación entre agentes sin autenticar es vulnerable a la falsificación y a órdenes no autorizadas.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M9 Lab 07: Orquestación Agente-a-Agente (A2A) HCS-10
 * - Siguiente: M9 Lab 09: Comunicación A2A Paralela Segura
 *
 * [ SECUENCIA ]
 * Agente A -> Buzón del agente B: Mensaje legítimo
 * Atacante -> Buzón del agente B: Mensaje que dice ser del agente A
 * Nota Agente B: Sin firmas no puede distinguirlos
 * Agente B -> Buzón del agente A: Responde a ambos
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 04 de M9 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M9_AI_Orchestration/08_hcs10_impersonation_attack.js
 * ============================================================================
 */

import { TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getState, sleep, createClient, exitIfStuck, loadEnv } from '../M99_Utilities/index.js'

loadEnv() // lee course/.env (y el .env de la raíz del repositorio)

const main = async () => {
  // Nunca quedarse colgado: falla con un mensaje claro si la red no responde.
  exitIfStuck(180_000, 'los mensajes de la suscripción')
  const sessionStart = new Date(Date.now() - 10000) // solo mensajes de esta ejecución (10 s hacia atrás por la propagación del Mirror Node)
  let sessionDone = false // se activa cuando el Agente A termina, para que el adversario también se detenga
  console.log('--- INICIO DE SESIÓN: Auditoría de Vulnerabilidad de Flujos Públicos ---\n')

  // --- CONFIGURACIÓN ---
  const agentAId = getState('HCS11_AGENT_A_ID')
  const agentAKey = getState('HCS11_AGENT_A_KEY')
  const agentBId = getState('HCS11_AGENT_B_ID')
  const agentBKey = getState('HCS11_AGENT_B_KEY')
  const agentCId = getState('HCS11_AGENT_C_ID')
  const agentCKey = getState('HCS11_AGENT_C_KEY')

  const inbox = getState('HCS11_AGENT_B_INBOUND')
  const outbox = getState('HCS11_AGENT_B_OUTBOUND')

  if (!agentAId || !agentBId || !agentCId) {
    console.error('[FALLO] Faltan los agentes y sus tópicos. Ejecuta primero el Lab 04 de M9.')
    process.exitCode = 1
    return
  }

  // --- AGENTE B: EL SERVICIO VULNERABLE ---
  const startAgentB = async () => {
    const client = createClient().setOperator(agentBId, agentBKey)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentBId, operatorPrivateKey: agentBKey })

    console.log(`[INFO] El Agente B escucha en ${inbox} (modo vulnerable)`)

    // Suscripción a través del Mirror Node: los mensajes llegan en orden de consenso.
    new TopicMessageQuery()
      .setTopicId(inbox)
      .setStartTime(sessionStart)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          const envelope = JSON.parse(content)
          const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

          if (data?.text?.includes('Hello')) {
            console.log('\n---  [REGISTRO] AGENTE B: SOLICITUD RECIBIDA ---')
            console.log(`[INFO] Contenido: "${data.text}"`)

            const roundMatch = data.text.match(/\d+/)
            const round = roundMatch ? roundMatch[0] : '99'

            console.log(`[PROCESO] El Agente B procesa la ronda ${round}...`)
            await sleep(4000)

            await hcs10.sendMessage(outbox, { text: `World ${round}!`, target: agentAId })
            console.log('[ÉXITO] Respuesta enviada.')
          }
        } catch (e) { console.error('[FALLO] El agente no pudo responder:', e.message) }
      })
  }

  // --- AGENTE A: EL QUE INICIA (Y EL SUPLANTADO) ---
  const startAgentA = async () => {
    const client = createClient().setOperator(agentAId, agentAKey)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentAId, operatorPrivateKey: agentAKey })

    let currentRound = 1
    console.log(`[INFO] El Agente A vigila el Outbox [${outbox}]`)

    const sendPing = async (round) => {
      console.log(`\n---  [PROCESO] AGENTE A: ENVIANDO LA RONDA ${round} ---`)
      await hcs10.sendMessage(inbox, {
        operator_id: agentAId,
        text: `Hello ${round}`
      })
    }

    new TopicMessageQuery()
      .setTopicId(outbox)
      .setStartTime(sessionStart)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()
        if (content.includes(`World ${currentRound}`)) {
          console.log(`\n[ÉXITO] AGENTE A: ronda ${currentRound} completada.`)
          if (currentRound < 3) {
            currentRound++
            await sleep(5000)
            await sendPing(currentRound)
          } else {
            console.log('\n [ÉXITO] Interacción completa.')
            console.log('\n CONCEPTO CLAVE:')
            console.log('La Brecha de Identidad: viste lo fácil que fue para el Agente C suplantar')
            console.log('la conversación. Sin validación criptográfica de la sesión, los agentes')
            console.log('no tienen defensa contra quien conoce el formato del protocolo.')
            console.log('\n--- SESIÓN COMPLETADA ---\n')
            sessionDone = true
            process.exit()
          }
        }
      })

    await sendPing(currentRound)
  }

  // --- AGENTE C: EL ADVERSARIO ---
  const startAgentC = async () => {
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentCId, operatorPrivateKey: agentCKey })

    for (let i = 0; i < 3; i++) {
      await sleep(Math.floor(Math.random() * 8000) + 5000)
      if (sessionDone) return
      console.log('\n---  [PROCESO] ADVERSARIO: INYECTANDO UN PAQUETE FALSIFICADO ---')
      await hcs10.sendMessage(inbox, {
        operator_id: agentAId,
        text: 'Hello 99 (MALICIOUS SPOOF)'
      })
      console.log('[INFO] Paquete falsificado publicado en el tópico de la víctima.')
    }
  }

  startAgentB()
  setTimeout(startAgentA, 2000)
  setTimeout(startAgentC, 6000) // El adversario se une más tarde
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
