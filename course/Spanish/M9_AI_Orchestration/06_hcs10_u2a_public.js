/**
 * ============================================================================
 * Lab 06: Comunicación Humano-a-Agente HCS-10 (Pública)
 * [CONCEPTO] Orquestación Reactiva y Arquitectura Orientada a Eventos
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
 * - Anterior:  M9 Lab 05: HCS-14 UAID (Universal Agent ID)
 * - Siguiente: M9 Lab 07: Orquestación Agente-a-Agente (A2A) HCS-10
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
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Ejecuta antes: Lab 04 de M9 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M9_AI_Orchestration/06_hcs10_u2a_public.js
 * ============================================================================
 */

import { PrivateKey, TopicMessageQuery, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getState, sleep, createClient, exitIfStuck, loadEnv } from '../M99_Utilities/index.js'

loadEnv() // lee course/.env (y el .env de la raíz del repositorio)

const main = async () => {
  // Nunca quedarse colgado: falla con un mensaje claro si la red no responde.
  exitIfStuck(180_000, 'los mensajes de la suscripción')
  const sessionStart = new Date(Date.now() - 10000) // 10 s hacia atrás por la propagación del Mirror Node
  console.log('--- INICIO DE SESIÓN: Orquestación U2A en Tiempo Real ---\n')

  const agentId = getState('HCS11_AGENT_A_ID')
  const agentKeyRaw = getState('HCS11_AGENT_A_KEY')
  const agentInbox = getState('HCS11_AGENT_A_INBOUND')
  const agentOutbox = getState('HCS11_AGENT_A_OUTBOUND')

  const operatorId = process.env.ACCOUNT_1_ID
  const operatorKeyRaw = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!agentId || !operatorId) {
    console.error('[FALLO] Faltan los datos del Agente A o de la Cuenta 1 en la configuración.')
    process.exitCode = 1
    return
  }

  // --- SERVIDOR DEL AGENTE: SERVICIO REACTIVO ---
  const startAgent = async () => {
    const hederaClient = createClient().setOperator(agentId, agentKeyRaw)
    const hcs10Agent = new HCS10Client({
      network: 'testnet',
      operatorId: agentId,
      operatorPrivateKey: PrivateKey.fromString(agentKeyRaw).toStringRaw()
    })

    const processedMessages = new Set()
    console.log(`[INFO] Agente A activo: escuchando el Buzón [${agentInbox}]`)

    // Suscripción a través del Mirror Node: los mensajes llegan en orden de consenso.
    new TopicMessageQuery()
      .setTopicId(agentInbox)
      .setStartTime(0)
      .subscribe(
        hederaClient,
        (err) => { console.error(`\n[FALLO] ERROR DEL MIRROR (AGENTE): ${err.message}`); process.exit(1) },
        async (message) => {
          const tsString = message.consensusTimestamp.toString()
          if (processedMessages.has(tsString)) return
          processedMessages.add(tsString)

          if (message.consensusTimestamp.toDate() < sessionStart) return

          try {
            const content = Buffer.from(message.contents, 'utf8').toString()
            const rawJson = JSON.parse(content)
            const parsed = Array.isArray(rawJson) ? rawJson[0] : rawJson

            if (parsed?.data?.toLowerCase().includes('hello')) {
              console.log('\n---  [REGISTRO] AGENTE A: SOLICITUD RECIBIDA ---')
              const num = parsed.data.match(/\d+/) ? parsed.data.match(/\d+/)[0] : ''

              console.log('[PROCESO] El agente "piensa" para procesar la solicitud...')
              await sleep(4000)

              await hcs10Agent.sendMessage(agentOutbox, {
                text: `World ${num}!`.trim(),
                target: parsed.operator_id
              })
              console.log('[ÉXITO] Respuesta enviada al ledger.')
            }
          } catch (e) { console.error('[FALLO] El agente no pudo responder:', e.message) }
        })
  }

  // --- CLIENTE DEL USUARIO HUMANO: MANEJADOR REACTIVO ---
  const startClient = async () => {
    const hederaClient = createClient().setOperator(operatorId, operatorKeyRaw)
    const processedMessages = new Set()

    console.log(`[INFO] Usuario activo: vigilando el Outbox [${agentOutbox}]`)

    let currentRound = 1
    const maxRounds = 3

    const sendPing = async (round) => {
      console.log(`\n---  [PROCESO] USUARIO: INICIANDO RONDA ${round} ---`)
      const rawPayload = JSON.stringify({ operator_id: operatorId, data: `Hello ${round}` })
      // Publicar: el consenso le da al mensaje un número de secuencia y una marca de tiempo en la que todos coinciden.
      const tx = await new TopicMessageSubmitTransaction()
        .setTopicId(agentInbox)
        .setMessage(rawPayload)
        .execute(hederaClient)

      // Esperar el consenso: el recibo dice si la red aceptó la transacción.
      await tx.getReceipt(hederaClient)
      console.log(`[ÉXITO] Publicado "Hello ${round}". Esperando el Pong...`)
    }

    new TopicMessageQuery()
      .setTopicId(agentOutbox)
      .setStartTime(0)
      .subscribe(
        hederaClient,
        (err) => { console.error(`\n[FALLO] ERROR DEL MIRROR (CLIENTE): ${err.message}`); process.exit(1) },
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
              if (replyText.includes(`World ${currentRound}`)) {
                console.log('\n---  [REGISTRO] USUARIO: RESPUESTA DETECTADA ---')
                console.log(`[ÉXITO] El agente respondió: "${replyText}"`)

                if (currentRound < maxRounds) {
                  currentRound++
                  console.log('[PROCESO] Leyendo la respuesta...')
                  await sleep(5000)
                  await sendPing(currentRound)
                } else {
                  console.log('\n [ÉXITO] Secuencia de interacción completa.')
                  console.log('\n CONCEPTO CLAVE:')
                  console.log('Callbacks con estado: los flujos agénticos reales dependen de comunicación')
                  console.log('reactiva en paralelo. En vez de consultar una API una y otra vez, ambos lados')
                  console.log('escuchan el ledger público y solo avanzan cuando se cumple una condición.')
                  console.log('\n--- SESIÓN COMPLETADA ---\n')
                  process.exit()
                }
              }
            }
          } catch (e) {
            console.error('\n[FALLO] Paquete de respuesta mal formado:', e.message)
            process.exitCode = 1
          }
        })

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
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
