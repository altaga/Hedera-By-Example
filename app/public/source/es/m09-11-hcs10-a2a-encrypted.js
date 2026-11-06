/**
 * ============================================================================
 * Lab 11: Comunicación A2A Cifrada (Full-Duplex Hybrid)
 * [CONCEPTO] Privacidad Basada en Cifrado de Grado Militar (RSA + AES)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Privacidad por Diseño: Las conversaciones entre agentes en HCS son públicas y
 * auditables, pero los datos sensibles deben ser privados. Aquí cada agente
 * tiene su propio buzón y un par de llaves RSA-2048, y cada mensaje usa cifrado
 * híbrido: una llave AES-256-GCM nueva cifra el contenido y la llave pública
 * RSA del destinatario cifra esa llave AES. Cualquiera puede leer el tópico,
 * pero solo el destinatario puede descifrar lo que se le envió.
 *
 * El cifrado da confidencialidad, no autenticidad: cualquiera que conozca una
 * llave pública puede enviar un mensaje cifrado. Un agente en producción lo
 * combina con las verificaciones de firma y secuencia de los Labs 09 y 10.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * El consenso ordena los mensajes de forma justa, pero solo el cifrado híbrido en el cliente (RSA-2048 + AES-256-GCM) los mantiene confidenciales: el resto del ledger público solo ve texto cifrado.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M9 Lab 10: Auditoría de Seguridad con Defensa Activa
 * - Siguiente: M10 Lab 01: Generación del Desafío Servidor HTTP 402
 *
 * [ SECUENCIA ]
 * Agente A -> Buzón del agente B: Solicitud cifrada con la llave pública RSA del agente B
 * Nota Agente B: Solo su llave privada puede descifrarla
 * Agente B -> Buzón del agente A: Respuesta cifrada con la llave pública del agente A
 * Nota HCS: Todos ven el texto cifrado, nadie más puede leerlo
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 04 de M9 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M9_AI_Orchestration/11_hcs10_a2a_encrypted.js
 * ============================================================================
 */

import { HCS10Client } from '@hashgraphonline/standards-sdk'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { AgentCommunicationHandler, getState, sleep, exitIfStuck, loadEnv } from '../M99_Utilities/index.js'

loadEnv() // lee course/.env (y el .env de la raíz del repositorio)

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Flujos Cifrados Híbridos (RSA + AES) ---\n')

  // --- CONFIGURACIÓN DE IDENTIDADES Y CANALES ---
  const agentAId = getState('HCS11_AGENT_A_ID')
  const agentAKey = getState('HCS11_AGENT_A_KEY')
  const agentAInbox = getState('HCS11_AGENT_A_INBOUND')

  const agentBId = getState('HCS11_AGENT_B_ID')
  const agentBKey = getState('HCS11_AGENT_B_KEY')
  const agentBInbox = getState('HCS11_AGENT_B_INBOUND')

  if (!agentAId || !agentBId || !agentAInbox || !agentBInbox) {
    console.error('[FALLO] Faltan identidades o canales para la orquestación cifrada.')
    process.exitCode = 1
    return
  }

  // --- GESTIÓN DE BÓVEDA RSA (Claves locales para cifrado híbrido) ---
  const generateOrLoadKeys = (agentAlias) => {
    const keysDir = path.join(import.meta.dirname, 'privateKeys')
    if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true })

    const privateKeyPath = path.join(keysDir, `${agentAlias}_private.pem`)
    const publicKeyPath = path.join(keysDir, `${agentAlias}_public.pem`)

    if (fs.existsSync(privateKeyPath)) {
      return {
        privateKey: fs.readFileSync(privateKeyPath, 'utf8'),
        publicKey: fs.readFileSync(publicKeyPath, 'utf8')
      }
    }

    console.log(`[PROCESO] Generando par de claves RSA-2048 para el ${agentAlias}...`)
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })

    fs.writeFileSync(privateKeyPath, privateKey)
    fs.writeFileSync(publicKeyPath, publicKey)
    return { privateKey, publicKey }
  }

  const keysA = generateOrLoadKeys('agentA')
  const keysB = generateOrLoadKeys('agentB')

  // La conversación termina tras la ronda 3: se detienen ambos listeners y main() regresa.
  const listeners = []
  let finishSession
  const finished = new Promise((resolve) => { finishSession = resolve })

  // --- COMPONENTE: AGENTE B (Escucha en B_INBOX, Responde en A_INBOX) ---
  const startAgentB = async () => {
    const clientBListener = new HCS10Client({ network: 'testnet', operatorId: agentBId, operatorPrivateKey: agentBKey })
    const clientBSpeaker = new HCS10Client({ network: 'testnet', operatorId: agentBId, operatorPrivateKey: agentBKey })

    const pubKeys = { [agentAId]: keysA.publicKey }

    // Handler B: Recibe mensajes cifrados y responde con cifrado híbrido
    const handlerBListen = new AgentCommunicationHandler(clientBListener, agentBInbox, agentBId, keysB.privateKey, pubKeys, [agentAId])
    const handlerBSpeak = new AgentCommunicationHandler(clientBSpeaker, agentAInbox, agentBId, keysB.privateKey, pubKeys, [])

    handlerBListen.on('messageReceived', async ({ senderId, message }) => {
      if (message?.text) {
        console.log('\n---  AGENTE B: MENSAJE RECIBIDO Y DESCIFRADO ---')
        console.log(`[REGISTRO] Contenido Seguro: "${message.text}" (Ronda ${message.round})`)

        await sleep(3000)

        const replyPayload = { text: `World ${message.round}!`, round: message.round }
        console.log('[PROCESO] Cifrando respuesta (AES-256) y enrutando al Inbox del Agente A...')
        await handlerBSpeak.sendMessage(replyPayload, agentAId)
      }
    })

    console.log(`[INFO] Bajo Cifrado: Escuchando carril privado [${agentBInbox}]`)
    handlerBListen.on('error', (error) => console.error(`[FALLO] Agente B no pudo leer un mensaje: ${error.message}`))
    listeners.push(handlerBListen)
    handlerBListen.monitorConnectionMessages()
  }

  // --- COMPONENTE: AGENTE A (Escucha en A_INBOX, Inicia en B_INBOX) ---
  const startAgentA = async () => {
    const clientAListener = new HCS10Client({ network: 'testnet', operatorId: agentAId, operatorPrivateKey: agentAKey })
    const clientASpeaker = new HCS10Client({ network: 'testnet', operatorId: agentAId, operatorPrivateKey: agentAKey })

    const pubKeys = { [agentBId]: keysB.publicKey }
    let currentRound = 1

    // Handler A: Recibe respuestas y despacha pings cifrados
    const handlerAListen = new AgentCommunicationHandler(clientAListener, agentAInbox, agentAId, keysA.privateKey, pubKeys, [agentBId])
    const handlerASpeak = new AgentCommunicationHandler(clientASpeaker, agentBInbox, agentAId, keysA.privateKey, pubKeys, [])

    const sendPing = async (round) => {
      console.log('\n---  AGENTE A: ENVIANDO MENSAJE PRIVADO ---')
      console.log(`[PROCESO] Aplicando cifrado híbrido para la Ronda ${round}...`)
      await handlerASpeak.sendMessage({ text: `Hello ${round}`, round }, agentBId)
      console.log('[INFO] Paquete cifrado inyectado en el Inbox de B.')
    }

    handlerAListen.on('messageReceived', async ({ senderId, message }) => {
      if (message?.round === currentRound) {
        console.log('\n---  AGENTE A: RESPUESTA PRIVADA DESCIFRADA ---')
        console.log(`[REGISTRO] Recibido de B: "${message.text}"`)

        if (currentRound < 3) {
          currentRound++
          await sleep(4000)
          await sendPing(currentRound)
        } else {
          console.log('\n --- [ÉXITO] Orquestación Cifrada Finalizada con Éxito. ---')
          console.log('\n CONCEPTO CLAVE:')
          console.log('Privacidad por Diseño: cada mensaje cruzó un tópico público y aun así solo')
          console.log('su destinatario pudo descifrarlo. El cifrado da confidencialidad, no')
          console.log('autenticidad: combínalo con las verificaciones de firma de los Labs 09 y 10.')
          console.log('\n--- SESIÓN COMPLETADA ---\n')
          listeners.forEach((handler) => handler.stop())
          finishSession()
        }
      }
    })

    console.log(`[AGENTE A] Bajo Cifrado: Escuchando carril privado [${agentAInbox}]`)
    handlerAListen.on('error', (error) => console.error(`[FALLO] Agente A no pudo leer un mensaje: ${error.message}`))
    listeners.push(handlerAListen)
    handlerAListen.monitorConnectionMessages()

    await sleep(2000)
    await sendPing(currentRound)
  }

  // --- ARRANQUE DE LA RED PRIVADA ---
  startAgentB()
  await sleep(3000)
  await startAgentA()
  await finished
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
