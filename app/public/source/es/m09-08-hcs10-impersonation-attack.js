/**
 * ============================================================================
 * Lab 08: Ataque de Suplantación HCS-10 (Hijacking)
 * [CONCEPTO] Vulnerabilidad por Falta de Verificación Criptográfica
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Los Peligros del Silo: Este laboratorio demuestra los riesgos de ignorar
 * la arquitectura "Zero Trust" (Confianza Cero). En este escenario, el
 * Agente B ha sido configurado para ignorar la verificación de firmas y la
 * frescura de los mensajes. Esto permite que un adversario (Agente C) pueda
 * realizar ataques de "Falsificación" (enviando comandos en nombre de otro)
 * y ataques de "Replay" (reutilizando mensajes antiguos capturados del
 * registro público). Sin una validación criptográfica rigurosa, la
 * integridad del sistema de arbitraje se desmorona, permitiendo la
 * manipulación maliciosa de los resultados.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los topics públicos de consenso permiten que cualquiera publique mensajes. Simular un ataque de suplantación demuestra por qué la comunicación no autenticada entre agentes es vulnerable a comandos no autorizados.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M9 Lab 07: Comunicación Agente-a-Agente (A2A)
 * - Actual:   M9 Lab 08: Simulación de Ataque de Suplantación
 * - Siguiente: M9 Lab 09: Comunicación Segura y Verificada
 *
 * [SECUENCIA]
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
 * node 08_hcs10_impersonation_attack.js
 * ============================================================================
 */

import { PrivateKey, TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getState, sleep, createClient, exitIfStuck, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  console.log('--- INICIO DEL LABORATORIO: Simulación de Ataque de Suplantación (Vulnerabilidad HCS-10) ---\n')

  // --- CONFIGURACIÓN DE IDENTIDADES ---
  const agentAId = getState('HCS11_AGENT_A_ID')
  const agentAKey = getState('HCS11_AGENT_A_KEY')
  const agentBId = getState('HCS11_AGENT_B_ID')
  const agentBKey = getState('HCS11_AGENT_B_KEY')
  const agentCId = getState('HCS11_AGENT_C_ID')
  const agentCKey = getState('HCS11_AGENT_C_KEY')

  const inbox = getState('HCS11_AGENT_B_INBOUND')
  const outbox = getState('HCS11_AGENT_B_OUTBOUND')

  // Llave de sesión compartida por los agentes: se crea la primera vez y los Labs 08-10 la reutilizan.
  let sessionPrivKeyDer = getState('HCS10_SESSION_PRIVATE_KEY')
  if (!sessionPrivKeyDer) {
    // Genera una llave localmente: la llave privada nunca sale de este proceso.
    sessionPrivKeyDer = PrivateKey.generateECDSA().toStringRaw()
    updateState('HCS10_SESSION_PRIVATE_KEY', sessionPrivKeyDer)
    console.log('[INFO] Se generó una llave de sesión ECDSA nueva para Agente A  Agente B (guardada como HCS10_SESSION_PRIVATE_KEY).')
  }
  const sessionPriv = PrivateKey.fromStringECDSA(sessionPrivKeyDer)

  // --- COMPONENTE: AGENTE B (Servicio Vulnerable - Modo Legado) ---
  const startAgentB = async () => {
    const client = createClient().setOperator(agentBId, agentBKey)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentBId, operatorPrivateKey: agentBKey })

    console.log(`[INFO] Agente B: Operativo en Modo Vulnerable en Inbox [${inbox}]...`)

    // Suscríbete vía Mirror Node: los mensajes llegan en orden de consenso.
    new TopicMessageQuery()
      .setTopicId(inbox)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          const envelope = JSON.parse(content)
          const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

          if (data?.verified_payload) {
            const payload = JSON.parse(data.verified_payload)

            console.log('\n  [ALERTA] ¡Agente B procesando mensaje SIN verificación de firma!')
            console.log(`[REGISTRO] Comando capturado del registro público: ${inbox}`)

            // EJECUCIÓN (En modo vulnerable, el agente confía ciegamente en el emisor declarado)
            console.log(`[INFO] Confiando ciegamente en "${payload.text}". Procesando lógica...`)

            await sleep(3000)
            await hcs10.sendMessage(outbox, { text: `World ${payload.round} confirmado!`, target: agentAId })
          }
        } catch (e) { console.error('[FALLO] El agente no pudo responder:', e.message) }
      })
  }

  // --- COMPONENTE: AGENTE A (Emisor Legítimo) ---
  const startAgentA = async () => {
    const client = createClient().setOperator(agentAId, agentAKey)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentAId, operatorPrivateKey: agentAKey })

    let currentRound = 1
    console.log(`[INFO] Agente A: Emisor Genuino en Outbox [${outbox}]...`)

    const sendPing = async (round) => {
      console.log('\n---  AGENTE A: PREPARANDO ENVÍO SEGURO ---')
      const payloadObj = { text: `Hello ${round}`, round, ts: Date.now() }
      const payloadString = JSON.stringify(payloadObj)

      console.log(`[PROCESO] Generando firma de sesión para la Ronda ${round}...`)
      const sig = sessionPriv.sign(Buffer.from(payloadString, 'utf8'))

      await hcs10.sendMessage(inbox, {
        operator_id: agentAId,
        verified_payload: payloadString,
        session_proof: Buffer.from(sig).toString('hex')
      })
      console.log('[INFO] Mensaje publicado. El Agente B lo procesará sin validar la firma.')
    }

    new TopicMessageQuery()
      .setTopicId(outbox)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()
        if (content.includes(`World ${currentRound}`)) {
          console.log(`\n[ÉXITO] Agente A recibió respuesta legítima para Ronda ${currentRound}.`)
          if (currentRound < 3) {
            currentRound++
            await sleep(4000)
            await sendPing(currentRound)
          } else {
            console.log('\n --- [ÉXITO] El Agente B vulnerado procesó toda la secuencia. ---')
            console.log('\n CONCEPTO CLAVE:')
            console.log('La Brecha de Identidad: En este laboratorio viste con qué facilidad el Agente C')
            console.log('suplantó la conversación. Sin validación criptográfica de sesión, los agentes')
            console.log('quedan indefensos ante actores maliciosos que conocen el formato del protocolo.')
            console.log('\n--- SESIÓN COMPLETADA ---\n')
            process.exit()
          }
        }
      })

    await sendPing(currentRound)
  }

  // --- COMPONENTE: AGENTE C (El Adversario - Hijacker) ---
  const startAgentC = async () => {
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentCId, operatorPrivateKey: agentCKey })

    console.log('[INFO] Agente C: Atacante Activo en suplantación de identidad...')

    for (let i = 0; i < 4; i++) {
      await sleep(Math.floor(Math.random() * 6000) + 5000)
      const isForgery = Math.random() > 0.5

      if (isForgery) {
        console.log('\n---  MOVIMIENTO MALICIOSO: INTENTO DE FALSIFICACIÓN ---')
        await hcs10.sendMessage(inbox, {
          operator_id: agentAId, // Suplantando la identidad del Agente A
          verified_payload: JSON.stringify({ text: 'COMANDO_DE_RESET_MALICIOSO', round: 99 }),
          session_proof: '00'.repeat(32) // Firma inválida que el Agente B ignorará
        })
        console.log('[INFO] Ataque enviado: Falsificación de Identidad.')
      } else {
        console.log('\n---  MOVIMIENTO MALICIOSO: ATAQUE DE REPLAY (REPRODUCCIÓN) ---')
        console.log('[PROCESO] Copiando un mensaje antiguo de la Ronda 1 del registro público...')
        const replay = JSON.stringify({ text: 'Hello 1', round: 1, ts: 1713723000 })
        const sig = sessionPriv.sign(Buffer.from(replay, 'utf8'))
        await hcs10.sendMessage(inbox, {
          operator_id: agentAId,
          verified_payload: replay,
          session_proof: Buffer.from(sig).toString('hex')
        })
        console.log('[INFO] Ataque enviado: Reinyección de Mensaje Histórico.')
      }
    }
  }

  // --- ARRANQUE DE LA SIMULACIÓN ---
  startAgentB()
  setTimeout(startAgentA, 3000)
  setTimeout(startAgentC, 7000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
