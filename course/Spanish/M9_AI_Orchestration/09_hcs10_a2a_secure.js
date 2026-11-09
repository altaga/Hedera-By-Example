/**
 * ============================================================================
 * Lab 09: Comunicación A2A Paralela Segura
 * [CONCEPTO] Arquitectura Zero Trust y Detección de Intrusos (IDS)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Confianza Cero (Zero Trust): En un entorno seguro de IA distribuida, cada
 * mensaje es tratado como hostil hasta que supera un "guantelete" de
 * validación criptográfica. El Agente B implementa dos capas críticas:
 * 1. VERIFICACIÓN ECDSA: Garantiza que el mensaje fue firmado por el
 * titular de la clave de sesión y no ha sido alterado en tránsito.
 * 2. VALIDACIÓN DE SECUENCIA: Asegura que el mensaje es reciente y no una
 * repetición (Replay) de datos históricos. Al combinar estas capas, el
 * sistema rechaza falsificaciones y repeticiones. La llave de sesión la
 * comparten ambos agentes, así que una firma válida prueba "uno de los dos
 * agentes", no cuál; con llaves por agente se podrían distinguir.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Al firmar cada mensaje A2A con una llave de sesión e incluir un número de ronda, los agentes rechazan mensajes falsificados (firma inválida) y repeticiones (ronda vieja).
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M9 Lab 08: Ataque de Suplantación HCS-10 (Hijacking)
 * - Siguiente: M9 Lab 10: Auditoría de Seguridad con Defensa Activa
 *
 * [ SECUENCIA ]
 * Agente A -> Buzón del agente B: Contenido + firma (llave de sesión compartida)
 * Nota Agente B: Verifica la firma y luego que la ronda sea nueva
 * Agente B -> Buzón del agente A: Respuesta (sin firma en este lab)
 * Nota Agente A: Identifica la respuesta por su número de ronda
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 04 de M9 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M9_AI_Orchestration/09_hcs10_a2a_secure.js
 * ============================================================================
 */

import { PrivateKey, TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getState, sleep, createClient, exitIfStuck, updateState, loadEnv } from '../M99_Utilities/index.js'

loadEnv() // lee course/.env (y el .env de la raíz del repositorio)

const main = async () => {
  // Nunca quedarse colgado: falla con un mensaje claro si la red no responde.
  exitIfStuck(180_000, 'los mensajes de la suscripción')
  const sessionStart = new Date(Date.now() - 10000) // solo mensajes de esta ejecución (10 s hacia atrás por la propagación del Mirror Node)
  console.log('--- INICIO DE SESIÓN: Auditoría de Seguridad de la Comunicación Paralela ---\n')

  // --- CONFIGURACIÓN ---
  const agentAId = getState('HCS11_AGENT_A_ID')
  const agentAKey = getState('HCS11_AGENT_A_KEY')
  const agentBId = getState('HCS11_AGENT_B_ID')
  const agentBKey = getState('HCS11_AGENT_B_KEY')

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
    console.log(`[INFO] El Agente B escucha en ${inbox} (protocolo seguro)`)

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
            console.log(`[PROCESO] Validando el paquete recibido en ${inbox}...`)

            const payload = JSON.parse(data.verified_payload)

            // ETAPA 1: INTEGRIDAD CRIPTOGRÁFICA
            const isAuthentic = sessionPub.verify(
              Buffer.from(data.verified_payload, 'utf8'),
              Buffer.from(data.session_proof, 'hex')
            )

            if (!isAuthentic) {
              console.log('[BLOQUEADO] Firma ECDSA: INVÁLIDA')
              console.log('[INFO] FALSIFICACIÓN DETECTADA. Se descarta el paquete malicioso.')
              return
            }
            console.log('[ÉXITO] Firma ECDSA: VERIFICADA')

            // ETAPA 2: FRESCURA DE LA SECUENCIA (NONCE)
            if (payload.round <= lastProcessedRound) {
              console.log(`[BLOQUEADO] Nonce de secuencia: VIEJO (se esperaba > ${lastProcessedRound})`)
              console.log('[INFO] ATAQUE DE REPETICIÓN DETECTADO. Se descarta el paquete.')
              return
            }
            console.log(`[ÉXITO] Nonce de secuencia: NUEVO (ronda ${payload.round})`)

            // EJECUCIÓN
            console.log(`[REGISTRO] Resultado: paquete confiable. Procesando "${payload.text}"...`)
            lastProcessedRound = payload.round

            await sleep(5000)
            await hcs10.sendMessage(outbox, { text: `World ${payload.round}!`, target: agentAId })
            console.log('[ÉXITO] Respuesta enviada.')
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
      console.log('\n---  [PROCESO] AGENTE A: ARMANDO EL MENSAJE DE SALIDA ---')
      const payloadObj = { text: `Hello ${round}`, round, ts: Date.now() }
      const payloadString = JSON.stringify(payloadObj)

      console.log(`[PROCESO] Firmando el contenido de la ronda ${round}...`)
      const sig = sessionPriv.sign(Buffer.from(payloadString, 'utf8'))

      await hcs10.sendMessage(inbox, {
        operator_id: agentAId,
        verified_payload: payloadString,
        session_proof: Buffer.from(sig).toString('hex')
      })
      console.log('[ÉXITO] Mensaje seguro publicado en el ledger.')
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
            console.log('\n [ÉXITO] Todas las verificaciones de seguridad pasaron.')
            console.log('\n CONCEPTO CLAVE:')
            console.log('Detección de Intrusos (IDS): este script muestra una arquitectura de')
            console.log('"Confianza Cero". Al sumar la verificación ECDSA y la revisión del nonce,')
            console.log('un tópico HCS público se convierte en un canal de órdenes seguro y a')
            console.log('prueba de manipulaciones.')
            console.log('\n--- SESIÓN COMPLETADA ---\n')
            process.exit()
          }
        }
      })

    await sendPing(currentRound)
  }

  startAgentB()
  setTimeout(startAgentA, 2000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
