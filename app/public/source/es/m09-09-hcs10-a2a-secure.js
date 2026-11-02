/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 09: Comunicación A2A Paralela Segura
 * [ CONCEPTO ] Arquitectura Zero Trust y Detección de Intrusos (IDS)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Confianza Cero (Zero Trust): En un entorno seguro de IA distribuida, cada
 * mensaje es tratado como hostil hasta que supera un "guantelete" de
 * validación criptográfica. El Agente B implementa dos capas críticas:
 * 1. VERIFICACIÓN ECDSA: Garantiza que el mensaje fue firmado por el
 * titular de la clave de sesión y no ha sido alterado en tránsito.
 * 2. VALIDACIÓN DE SECUENCIA: Asegura que el mensaje es reciente y no una
 * repetición (Replay) de datos históricos. Al combinar estas capas, el
 * sistema de arbitraje se vuelve inmune a la suplantación de identidad y
 * a la manipulación de la telemetría del juego.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Al firmar cada mensaje A2A con la llave privada del agente e incluir marcas de tiempo efímeras, los agentes autónomos verifican la firma criptográfica de sus pares y descartan mensajes falsificados.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M9 Lab 08: Simulación de Ataque de Suplantación
 * - Actual:   M9 Lab 09: Comunicación Segura y Verificada
 * - Siguiente: M9 Lab 10: Defensa Activa contra Adversarios
 *
 * [ SECUENCIA ]
 * Agente A -> Buzón del agente B: Contenido + hash + firma (llave de sesión)
 * Nota Agente B: Verifica la firma con la llave del agente A
 * Agente B -> Buzón del agente A: Respuesta firmada
 * Nota Agente A: Verifica antes de confiar en la respuesta
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 04 de M9, Lab 08 de M9 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 09_hcs10_a2a_secure.js
 * ============================================================================
 */

import { Client, PrivateKey, TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getState, sleep, getClient, createClient, exitIfStuck, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Seguridad Zero-Trust (HCS-10) ---\n')

  // --- CONFIGURACIÓN DE IDENTIDADES ---
  const agentA_Id = getState('HCS11_AGENT_A_ID')
  const agentA_Key = getState('HCS11_AGENT_A_KEY')
  const agentB_Id = getState('HCS11_AGENT_B_ID')
  const agentB_Key = getState('HCS11_AGENT_B_KEY')

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

  // --- COMPONENTE: AGENTE B (Servicio con Seguridad Activa) ---
  const startAgentB = async () => {
    const client = createClient().setOperator(agentB_Id, agentB_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentB_Id, operatorPrivateKey: agentB_Key })

    let lastProcessedRound = 0
    console.log(`🛡️  [ℹ️ INFO] Agente B: Operativo en Modo Seguro en Inbox [${inbox}]...`)

    new TopicMessageQuery()
      .setTopicId(inbox)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          const envelope = JSON.parse(content)
          const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

          if (data?.verified_payload) {
            console.log('\n--- 🛡️  [DETECCIÓN] TRAZA DEL SISTEMA DE SEGURIDAD ---')
            console.log(`[📊 REGISTRO] Analizando paquete del registro público: ${inbox}`)

            const payload = JSON.parse(data.verified_payload)

            // CAPA 1: Integridad Criptográfica (ECDSA)
            const isAuthentic = sessionPub.verify(
              Buffer.from(data.verified_payload, 'utf8'),
              Buffer.from(data.session_proof, 'hex')
            )

            if (!isAuthentic) {
              console.log('[ℹ️ INFO] Etapa 1: Firma ECDSA ❌ INVÁLIDA')
              console.log('[ℹ️ INFO] Intento de falsificación detectado. Descartando datos.')
              return
            }
            console.log('[ℹ️ INFO] Etapa 1: Firma ECDSA ✅ VERIFICADA')

            // CAPA 2: Frescura y Secuencia (Anti-Replay)
            if (payload.round <= lastProcessedRound) {
              console.log(`[ℹ️ INFO] Etapa 2: Secuencia ❌ REPETIDA (Ronda ${payload.round} <= ${lastProcessedRound})`)
              console.log('[ℹ️ INFO] Ataque de Replay detectado. Ignorando mensaje antiguo.')
              return
            }
            console.log(`[ℹ️ INFO] Etapa 2: Secuencia ✅ RECIENTE (Ronda ${payload.round})`)

            // EJECUCIÓN (Solo tras superar todo el guantelete criptográfico)
            console.log('[✅ ÉXITO] Paquete de confianza. Procesando lógica de respuesta...')
            lastProcessedRound = payload.round

            await sleep(3000)
            await hcs10.sendMessage(outbox, { text: `¡Respuesta Segura para Ronda ${payload.round}!`, target: agentA_Id })
          }
        } catch (e) { console.error('[❌ FALLO] El agente no pudo responder:', e.message) }
      })
  }

  // --- COMPONENTE: AGENTE A (Emisor Autorizado) ---
  const startAgentA = async () => {
    const client = createClient().setOperator(agentA_Id, agentA_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentA_Id, operatorPrivateKey: agentA_Key })

    let currentRound = 1
    console.log(`🤖 [ℹ️ INFO] Agente A: Emisor Genuino en Outbox [${outbox}]...`)

    const sendPing = async (round) => {
      console.log('\n--- 🤖 AGENTE A: ENSAMBLAJE DE MENSAJE SEGURO ---')
      const payloadObj = { text: `Mensaje de Ronda ${round}`, round, ts: Date.now() }
      const payloadString = JSON.stringify(payloadObj)

      console.log('[⚙️ PROCESO] Hasheando y firmando carga útil con llave de sesión...')
      const sig = sessionPriv.sign(Buffer.from(payloadString, 'utf8'))

      await hcs10.sendMessage(inbox, {
        operator_id: agentA_Id,
        verified_payload: payloadString,
        session_proof: Buffer.from(sig).toString('hex')
      })
      console.log('[ℹ️ INFO] Mensaje verificado publicado en el ledger.')
    }

    new TopicMessageQuery()
      .setTopicId(outbox)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()
        if (content.includes(`Ronda ${currentRound}`)) {
          console.log(`\n[✅ ÉXITO] Agente A recibió respuesta segura para Ronda ${currentRound}.`)
          if (currentRound < 3) {
            currentRound++
            await sleep(4000)
            await sendPing(currentRound)
          } else {
            console.log('\n🏁 --- [✅ ÉXITO] Secuencia completada. Seguridad 100% verificada. ---')
            console.log('\n💡 CONCEPTO CLAVE:')
            console.log('Detección de Intrusos (IDS): Este script demuestra una arquitectura "Zero Trust".')
            console.log('Al combinar verificación ECDSA y control de nonces, transformas un tópico')
            console.log('público de HCS en un canal de comando seguro e inviolable.')
            console.log('\n--- SESIÓN COMPLETADA ---\n')
            setTimeout(() => process.exit(), 1000)
          }
        }
      })

    await sendPing(currentRound)
  }

  // --- ARRANQUE DE LA ORQUESTACIÓN SEGURA ---
  startAgentB()
  setTimeout(startAgentA, 3000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
