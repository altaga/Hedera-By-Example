/**
 * ============================================================================
 * Lab 10: Auditoría de Seguridad con Defensa Activa
 * [CONCEPTO] Resiliencia Ante Ataques y Mitigación en Tiempo Real
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Resiliencia Probada: Este laboratorio representa el "Examen Final" de la
 * arquitectura de seguridad HCS-10. Aquí, combinamos la orquestación segura
 * de agentes con la presencia de un adversario activo. A diferencia del
 * Lab 08, el Agente B está ahora equipado con un IDS (Sistema de Detección
 * de Intrusos) que verifica rigurosamente las firmas y la frescura de cada
 * comando. Podrás observar en tiempo real cómo la red bloquea los intentos de
 * falsificación y los ataques de replay, manteniendo la integridad del
 * juicio de la IA incluso bajo fuego enemigo.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * La defensa activa en HCS-10 intercepta ataques de repetición y mensajes falsificados en tiempo real, mostrando que firmas más números de ronda detienen la falsificación y la repetición en un tópico público.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M9 Lab 09: Comunicación A2A Paralela Segura
 * - Siguiente: M9 Lab 11: Comunicación A2A Cifrada (Full-Duplex Hybrid)
 *
 * [ SECUENCIA ]
 * Agente A -> Buzón del agente B: Mensaje firmado (rondas 1 a 3)
 * Atacante -> Buzón del agente B: Mensaje falsificado (firma inválida)
 * Atacante -> Buzón del agente B: Copia del mensaje de la ronda 1 del agente A (repetición)
 * Nota Agente B: La firma descarta la falsificación y la ronda descarta la repetición
 * Agente B -> Buzón del agente A: Solo responde a mensajes confiables y nuevos
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 04 de M9 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M9_AI_Orchestration/10_hcs10_a2a_secure_with_attack.js
 * ============================================================================
 */

import { PrivateKey, TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getState, sleep, createClient, exitIfStuck, updateState, loadEnv, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

loadEnv() // lee course/.env (y el .env de la raíz del repositorio)

const main = async () => {
  // Nunca quedarse colgado: falla con un mensaje claro si la red no responde.
  exitIfStuck(180_000, 'los mensajes de la suscripción')
  const sessionStart = new Date(Date.now() - 10000) // solo mensajes de esta ejecución (10 s hacia atrás por la propagación del Mirror Node)
  let sessionDone = false // se activa cuando el Agente A termina, para que el adversario también se detenga
  console.log('--- INICIO DE SESIÓN: Auditoría de Seguridad Reforzada contra un Adversario ---\n')

  // --- CONFIGURACIÓN ---
  const agentAId = getState('HCS11_AGENT_A_ID')
  const agentAKey = getState('HCS11_AGENT_A_KEY')
  const agentBId = getState('HCS11_AGENT_B_ID')
  const agentBKey = getState('HCS11_AGENT_B_KEY')
  const agentCId = getState('HCS11_AGENT_C_ID')
  const agentCKey = getState('HCS11_AGENT_C_KEY')

  const inbox = getState('HCS11_AGENT_B_INBOUND')
  const outbox = getState('HCS11_AGENT_B_OUTBOUND')

  // Llave de sesión compartida por los agentes: se crea la primera vez y la reutilizan los Labs 09 y 10.
  let sessionPrivStr = getState('HCS10_SESSION_PRIVATE_KEY')
  if (!sessionPrivStr) {
    sessionPrivStr = PrivateKey.generateECDSA().toStringRaw()
    updateState('HCS10_SESSION_PRIVATE_KEY', sessionPrivStr)
    console.log('[INFO] Se generó una nueva llave de sesión ECDSA para el Agente A y el Agente B (guardada como HCS10_SESSION_PRIVATE_KEY).')
  }
  const sessionPriv = PrivateKey.fromStringECDSA(sessionPrivStr)
  const sessionPub = sessionPriv.publicKey

  // --- AGENTE B: EL SERVICIO SEGURO ---
  const startAgentB = async () => {
    const client = createClient().setOperator(agentBId, agentBKey)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentBId, operatorPrivateKey: agentBKey })

    let lastProcessedRound = 0
    console.log(`[INFO] IDS del Agente B activo: escuchando en ${inbox}`)

    new TopicMessageQuery()
      .setTopicId(inbox)
      .setStartTime(sessionStart)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          const envelope = JSON.parse(content)
          const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

          if (data?.verified_payload) {
            console.log('\n---   [INFO] TRAZA DEL SISTEMA DE DETECCIÓN DE INTRUSOS (IDS) ---')
            const payload = JSON.parse(data.verified_payload)

            // ETAPA 1: INTEGRIDAD CRIPTOGRÁFICA
            const isAuthentic = sessionPub.verify(
              Buffer.from(data.verified_payload, 'utf8'),
              Buffer.from(data.session_proof, 'hex')
            )

            if (!isAuthentic) {
              console.log('[BLOQUEADO] Firma: INVÁLIDA')
              console.log('[INFO] FALSIFICACIÓN DETECTADA. Se descarta el paquete del adversario.')
              return
            }
            console.log('[ÉXITO] Firma: VERIFICADA')

            // ETAPA 2: FRESCURA DE LA SECUENCIA (NONCE)
            if (payload.round <= lastProcessedRound) {
              console.log(`[BLOQUEADO] Secuencia: VIEJA (ronda ${payload.round} <= ${lastProcessedRound})`)
              console.log('[INFO] ATAQUE DE REPETICIÓN RECHAZADO. Se descarta el paquete.')
              return
            }
            console.log(`[ÉXITO] Secuencia: NUEVA (ronda ${payload.round})`)

            // EJECUCIÓN
            console.log(`[REGISTRO] Resultado: paquete confiable. Respondiendo a "${payload.text}"...`)
            lastProcessedRound = payload.round

            await sleep(5000)
            await hcs10.sendMessage(outbox, { text: `World ${payload.round}!`, target: agentAId })
          }
        } catch (e) { console.error('[FALLO] El agente no pudo responder:', e.message) }
      })
  }

  // --- AGENTE A: EL INICIADOR SEGURO ---
  const startAgentA = async () => {
    const client = createClient().setOperator(agentAId, agentAKey)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentAId, operatorPrivateKey: agentAKey })

    let currentRound = 1
    console.log(`[INFO] El Agente A vigila el Outbox [${outbox}]`)

    const sendPing = async (round) => {
      console.log('\n---  [PROCESO] AGENTE A: ENVIANDO UNA ORDEN SEGURA ---')
      const payloadObj = { text: `Hello ${round}`, round, ts: Date.now() }
      const payloadString = JSON.stringify(payloadObj)
      const sig = sessionPriv.sign(Buffer.from(payloadString, 'utf8'))

      await hcs10.sendMessage(inbox, {
        operator_id: agentAId,
        verified_payload: payloadString,
        session_proof: Buffer.from(sig).toString('hex')
      })
      console.log(`[ÉXITO] Mensaje seguro publicado para la ronda ${round}.`)
    }

    new TopicMessageQuery()
      .setTopicId(outbox)
      .setStartTime(sessionStart)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()
        if (content.includes(`World ${currentRound}`)) {
          console.log(`\n[REGISTRO] El Agente A recibió la respuesta de la ronda ${currentRound}.`)
          if (currentRound < 3) {
            currentRound++
            await sleep(5000)
            await sendPing(currentRound)
          } else {
            console.log('\n [ÉXITO] Secuencia completa. Se mantuvieron todas las garantías de seguridad.')
            console.log('\n CONCEPTO CLAVE:')
            console.log('La Red Blindada: en este lab derrotamos el ataque. Al sumar la validación')
            console.log('criptográfica de la sesión, protegimos la conversación de actores maliciosos,')
            console.log('incluso en un tópico de consenso público y sin permisos.')
            console.log('\n--- SESIÓN COMPLETADA ---\n')
            sessionDone = true
            process.exit()
          }
        }
      })

    await sendPing(currentRound)
  }

  // --- AGENTE C: EL ADVERSARIO ---
  // Lee el buzón público en el Mirror Node y devuelve el mensaje firmado de la ronda 1 del Agente A.
  const captureRound1 = async () => {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/topics/${inbox}/messages?order=desc&limit=50`)
    const { messages = [] } = res.ok ? await res.json() : {}
    for (const m of messages) {
      try {
        const envelope = JSON.parse(Buffer.from(m.message, 'base64').toString('utf8'))
        const data = Array.isArray(envelope) ? envelope[0].data : envelope.data
        if (data?.verified_payload && JSON.parse(data.verified_payload).round === 1) {
          return { operator_id: data.operator_id, verified_payload: data.verified_payload, session_proof: data.session_proof }
        }
      } catch (_) {}
    }
    return null
  }

  const startAgentC = async () => {
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentCId, operatorPrivateKey: agentCKey })

    for (let i = 0; i < 4; i++) {
      await sleep(Math.floor(Math.random() * 8000) + 7000)
      if (sessionDone) return
      const isForgery = i % 2 === 0 // alterna: falsificación, repetición, falsificación, repetición

      if (isForgery) {
        console.log('\n---  [PROCESO] ADVERSARIO: INTENTO DE FALSIFICACIÓN ---')
        await hcs10.sendMessage(inbox, {
          operator_id: agentAId,
          verified_payload: JSON.stringify({ text: 'Malicious Command', round: 99 }),
          session_proof: 'c0de'.repeat(32)
        })
      } else {
        // Repetición: el adversario no puede firmar, pero el tópico es público, así que copia
        // el mensaje auténtico de la ronda 1 del Agente A (contenido y firma) y lo vuelve a enviar.
        console.log('\n---  [PROCESO] ADVERSARIO: INTENTO DE ATAQUE DE REPETICIÓN ---')
        const captured = await captureRound1()
        if (!captured) { console.log('[INFO] El adversario todavía no encontró un mensaje de la ronda 1 para copiar.'); continue }
        await hcs10.sendMessage(inbox, captured)
        console.log('[INFO] El adversario reenvió el mensaje capturado de la ronda 1, con su firma.')
      }
    }
  }

  startAgentB()
  setTimeout(startAgentA, 2000)
  setTimeout(startAgentC, 8000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
