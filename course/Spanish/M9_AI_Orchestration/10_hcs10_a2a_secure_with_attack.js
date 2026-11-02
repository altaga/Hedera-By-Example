/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 10: Auditoría de Seguridad con Defensa Activa
 * [ CONCEPTO ] Resiliencia Ante Ataques y Mitigación en Tiempo Real
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
 * La defensa activa en HCS-10 intercepta ataques de repetición y mensajes falsificados en tiempo real, demostrando que la procedencia criptográfica neutraliza ataques de intermediario en ledgers públicos.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M9 Lab 09: Comunicación Segura y Verificada
 * - Actual:   M9 Lab 10: Defensa Activa contra Adversarios
 * - Siguiente: M9 Lab 11: Comunicación Cifrada (Cipher enabled)
 *
 * [ SECUENCIA ]
 * Agente A -> Buzón del agente B: Mensaje firmado
 * Atacante -> Buzón del agente B: Mensaje falsificado (llave incorrecta)
 * Nota Agente B: La verificación de firma rechaza la falsificación
 * Agente B -> Buzón del agente A: Solo responde al mensaje confiable
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 04 de M9, Lab 08 de M9 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 10_hcs10_a2a_secure_with_attack.js
 * ============================================================================
 */

import { Client, PrivateKey, TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getState, sleep, getClient, createClient, exitIfStuck, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Seguridad con Defensa Activa (HCS-10) ---\n')

  // --- CONFIGURACIÓN DE IDENTIDADES ---
  const agentA_Id = getState('HCS11_AGENT_A_ID')
  const agentA_Key = getState('HCS11_AGENT_A_KEY')
  const agentB_Id = getState('HCS11_AGENT_B_ID')
  const agentB_Key = getState('HCS11_AGENT_B_KEY')
  const agentC_Id = getState('HCS11_AGENT_C_ID')
  const agentC_Key = getState('HCS11_AGENT_C_KEY')

  const inbox = getState('HCS11_AGENT_B_INBOUND')
  const outbox = getState('HCS11_AGENT_B_OUTBOUND')

  // Llave de sesión compartida por los agentes: se crea la primera vez y los Labs 09 y 10 la reutilizan.
  let sessionPrivKeyDer = getState('HCS10_SESSION_PRIVATE_KEY')
  if (!sessionPrivKeyDer) {
    sessionPrivKeyDer = PrivateKey.generateECDSA().toStringRaw()
    updateState('HCS10_SESSION_PRIVATE_KEY', sessionPrivKeyDer)
    console.log('[ℹ️ INFO] Se generó una llave de sesión ECDSA nueva para Agente A ↔ Agente B (guardada como HCS10_SESSION_PRIVATE_KEY).')
  }
  const sessionPriv = PrivateKey.fromStringECDSA(sessionPrivKeyDer)
  const sessionPub = sessionPriv.publicKey

  // --- COMPONENTE: AGENTE B (Defensa Activa - IDS Operativo) ---
  const startAgentB = async () => {
    const client = createClient().setOperator(agentB_Id, agentB_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentB_Id, operatorPrivateKey: agentB_Key })

    let lastProcessedRound = 0
    console.log(`🛡️  [ℹ️ INFO] Agente B: Bajo Fuego en Inbox [${inbox}] con IDS Activo...`)

    new TopicMessageQuery()
      .setTopicId(inbox)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          const envelope = JSON.parse(content)
          const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

          if (data?.verified_payload) {
            console.log('\n--- 🛡️  [IDS] TRAZA DE SEGURIDAD: ANALIZANDO COMANDO ENTRANTE ---')
            console.log(`[📊 REGISTRO] Analizando paquete de: ${data.operator_id || 'Identidad Desconocida'}`)

            const payload = JSON.parse(data.verified_payload)

            // CAPA 1: Integridad (ECDSA)
            const isAuthentic = sessionPub.verify(Buffer.from(data.verified_payload, 'utf8'), Buffer.from(data.session_proof, 'hex'))
            if (!isAuthentic) {
              console.log('[ℹ️ INFO] Etapa 1: Firma ECDSA ❌ CORRUPTA')
              console.log('[ℹ️ INFO] BLOQUEADO: Intento de falsificación de identidad.')
              return
            }
            console.log('[ℹ️ INFO] Etapa 1: Firma ECDSA ✅ VÁLIDA')

            // CAPA 2: Frescura (Anti-Replay)
            if (payload.round <= lastProcessedRound) {
              console.log(`[ℹ️ INFO] Etapa 2: Secuencia ❌ DUPLICADA (Ronda ${payload.round} <= ${lastProcessedRound})`)
              console.log('[ℹ️ INFO] BLOQUEADO: Intento de ataque de Replay detectado.')
              return
            }
            console.log(`[ℹ️ INFO] Etapa 2: Secuencia ✅ RECIENTE (Ronda ${payload.round})`)

            // EJECUCIÓN (Solo tras superar todas las barreras)
            console.log(`[✅ ÉXITO] Paquete seguro. Procesando respuesta para "${payload.text}".`)
            lastProcessedRound = payload.round

            await sleep(3000)
            await hcs10.sendMessage(outbox, { text: `World ${payload.round}!`, target: agentA_Id })
          }
        } catch (e) { console.error('[❌ FALLO] El agente no pudo responder:', e.message) }
      })
  }

  // --- COMPONENTE: AGENTE A (Iniciador Legítimo) ---
  const startAgentA = async () => {
    const client = createClient().setOperator(agentA_Id, agentA_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentA_Id, operatorPrivateKey: agentA_Key })

    let currentRound = 1
    console.log(`🤖 [ℹ️ INFO] Agente A: Emisor Genuino en Outbox [${outbox}]...`)

    const sendPing = async (round) => {
      console.log('\n--- 🤖 AGENTE A: SECUENCIA DE SALIDA SEGURA ---')
      const payloadObj = { text: `Hello ${round}`, round, ts: Date.now() }
      const payloadString = JSON.stringify(payloadObj)

      console.log(`[⚙️ PROCESO] Hasheando y firmando carga útil para la Ronda ${round}...`)
      const sig = sessionPriv.sign(Buffer.from(payloadString, 'utf8'))

      await hcs10.sendMessage(inbox, {
        operator_id: agentA_Id,
        verified_payload: payloadString,
        session_proof: Buffer.from(sig).toString('hex')
      })
      console.log('[ℹ️ INFO] Mensaje verificado publicado. El IDS del Agente B lo validará.')
    }

    new TopicMessageQuery()
      .setTopicId(outbox)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()
        if (content.includes(`World ${currentRound}`)) {
          console.log(`\n[✅ ÉXITO] Agente A recibió respuesta legítima para Ronda ${currentRound}.`)
          if (currentRound < 3) {
            currentRound++
            await sleep(4000)
            await sendPing(currentRound)
          } else {
            console.log('\n🏁 --- [✅ ÉXITO] Secuencia completada. Todos los ataques mitigados. ---')
            console.log('\n💡 CONCEPTO CLAVE:')
            console.log('La Red Blindada: En este laboratorio derrotamos con éxito el ataque.')
            console.log('Al incorporar validación criptográfica de sesión, protegimos la conversación')
            console.log('de actores maliciosos, incluso en un tópico de consenso público y sin permisos.')
            console.log('\n--- SESIÓN COMPLETADA ---\n')
            setTimeout(() => process.exit(), 1000)
          }
        }
      })

    await sendPing(currentRound)
  }

  // --- COMPONENTE: AGENTE C (El Adversario Malicioso) ---
  const startAgentC = async () => {
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentC_Id, operatorPrivateKey: agentC_Key })

    console.log('😈 [ℹ️ INFO] Agente C: Atacante Activo en bombardeo de suplantación...')

    for (let i = 0; i < 6; i++) {
      await sleep(Math.floor(Math.random() * 8000) + 7000)
      const isForgery = Math.random() > 0.5

      if (isForgery) {
        console.log('\n--- 😈 INTENTO DE ATAQUE: FALSIFICACIÓN DE FIRMA ---')
        await hcs10.sendMessage(inbox, {
          operator_id: agentA_Id,
          verified_payload: JSON.stringify({ text: 'COMANDO_MALICIOSO', round: 99 }),
          session_proof: 'deadbeef'.repeat(8) // Firma basura
        })
      } else {
        console.log('\n--- 😈 INTENTO DE ATAQUE: REPLAY DE MENSAJE ---')
        console.log('[⚙️ PROCESO] Inyectando firma robada de la Ronda 1...')
        const replay = JSON.stringify({ text: 'Hello 1', round: 1, ts: 1713723000 })
        const sig = sessionPriv.sign(Buffer.from(replay, 'utf8'))
        await hcs10.sendMessage(inbox, {
          operator_id: agentA_Id,
          verified_payload: replay,
          session_proof: Buffer.from(sig).toString('hex')
        })
      }
    }
  }

  // --- ARRANQUE DE LA DEFENSA ACTIVA ---
  startAgentB()
  setTimeout(startAgentA, 2000)
  setTimeout(startAgentC, 8000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
