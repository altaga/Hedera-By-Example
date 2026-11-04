/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 11: Comunicación A2A Cifrada (Full-Duplex Hybrid)
 * [CONCEPTO] Privacidad Basada en Cifrado de Grado Militar (RSA + AES)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Privacidad por Diseño: En una infraestructura de IA profesional, la
 * orquestación no solo debe ser pública y auditable, sino también privada
 * cuando se manejan datos sensibles. Este laboratorio implementa una
 * arquitectura "Full-Duplex" donde cada agente posee su propio canal (Inbox)
 * dedicado. Mediante el uso de la clase `HybridEncryption` (RSA-2048 para
 * intercambio de llaves y AES-256-GCM para datos), los agentes pueden
 * comunicarse sobre el registro público de Hedera con la certeza de que
 * solo el destinatario legítimo podrá descifrar y procesar la información.
 * Es el estándar de oro para la confidencialidad en redes descentralizadas.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El consenso ofrece ordenamiento justo, pero el cifrado híbrido en el cliente (ECDH + AES-256-GCM) garantiza confidencialidad militar: los terceros en el ledger público solo ven texto cifrado indescifrable.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M9 Lab 10: Defensa Activa contra Adversarios
 * - Actual:   M9 Lab 11: Comunicación Cifrada (Confidencialidad)
 * - Siguiente: [ FIN DEL CURSO - ¡FELICIDADES! ]
 *
 * [SECUENCIA]
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
 * node 11_hcs10_a2a_encrypted.js
 * ============================================================================
 */

import { HCS10Client } from '@hashgraphonline/standards-sdk'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { AgentCommunicationHandler, getState, sleep, exitIfStuck } from '../M99_Utilities/index.js'

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'mensajes de la suscripción')
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Flujos Cifrados Híbridos (RSA + AES) ---\n')

  // --- CONFIGURACIÓN DE IDENTIDADES Y CANALES ---
  const agentA_Id = getState('HCS11_AGENT_A_ID')
  const agentA_Key = getState('HCS11_AGENT_A_KEY')
  const agentA_Inbox = getState('HCS11_AGENT_A_INBOUND')

  const agentB_Id = getState('HCS11_AGENT_B_ID')
  const agentB_Key = getState('HCS11_AGENT_B_KEY')
  const agentB_Inbox = getState('HCS11_AGENT_B_INBOUND')

  if (!agentA_Id || !agentB_Id || !agentA_Inbox || !agentB_Inbox) {
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

  const keysA = generateOrLoadKeys('Agente_A')
  const keysB = generateOrLoadKeys('Agente_B')

  // --- COMPONENTE: AGENTE B (Escucha en B_INBOX, Responde en A_INBOX) ---
  const startAgentB = async () => {
    const client_B_Listener = new HCS10Client({ network: 'testnet', operatorId: agentB_Id, operatorPrivateKey: agentB_Key })
    const client_B_Speaker = new HCS10Client({ network: 'testnet', operatorId: agentB_Id, operatorPrivateKey: agentB_Key })

    const pubKeys = { [agentA_Id]: keysA.publicKey }

    // Handler B: Recibe mensajes cifrados y responde con cifrado híbrido
    const handlerB_Listen = new AgentCommunicationHandler(client_B_Listener, agentB_Inbox, agentB_Id, keysB.privateKey, pubKeys, [agentA_Id])
    const handlerB_Speak = new AgentCommunicationHandler(client_B_Speaker, agentA_Inbox, agentB_Id, keysB.privateKey, pubKeys, [])

    handlerB_Listen.on('messageReceived', async ({ senderId, message }) => {
      if (message?.text) {
        console.log('\n---  AGENTE B: MENSAJE RECIBIDO Y DESCIFRADO ---')
        console.log(`[REGISTRO] Contenido Seguro: "${message.text}" (Ronda ${message.round})`)

        await sleep(3000)

        const replyPayload = { text: `¡Confirmación Ronda ${message.round} Recibida!`, round: message.round }
        console.log('[PROCESO] Cifrando respuesta (AES-256) y enrutando al Inbox del Agente A...')
        await handlerB_Speak.sendMessage(replyPayload, agentA_Id)
      }
    })

    console.log(`[INFO] Bajo Cifrado: Escuchando carril privado [${agentB_Inbox}]`)
    handlerB_Listen.monitorConnectionMessages()
  }

  // --- COMPONENTE: AGENTE A (Escucha en A_INBOX, Inicia en B_INBOX) ---
  const startAgentA = async () => {
    const client_A_Listener = new HCS10Client({ network: 'testnet', operatorId: agentA_Id, operatorPrivateKey: agentA_Key })
    const client_A_Speaker = new HCS10Client({ network: 'testnet', operatorId: agentA_Id, operatorPrivateKey: agentA_Key })

    const pubKeys = { [agentB_Id]: keysB.publicKey }
    let currentRound = 1

    // Handler A: Recibe respuestas y despacha pings cifrados
    const handlerA_Listen = new AgentCommunicationHandler(client_A_Listener, agentA_Inbox, agentA_Id, keysA.privateKey, pubKeys, [agentB_Id])
    const handlerA_Speak = new AgentCommunicationHandler(client_A_Speaker, agentB_Inbox, agentA_Id, keysA.privateKey, pubKeys, [])

    const sendPing = async (round) => {
      console.log('\n---  AGENTE A: ENVIANDO MENSAJE PRIVADO ---')
      console.log(`[PROCESO] Aplicando cifrado híbrido para la Ronda ${round}...`)
      await handlerA_Speak.sendMessage({ text: `Secreto Agente A - Ronda ${round}`, round }, agentB_Id)
      console.log('[INFO] Paquete cifrado inyectado en el Inbox de B.')
    }

    handlerA_Listen.on('messageReceived', async ({ senderId, message }) => {
      if (message?.text?.includes(`Ronda ${currentRound}`)) {
        console.log('\n---  AGENTE A: RESPUESTA PRIVADA DESCIFRADA ---')
        console.log(`[REGISTRO] Recibido de B: "${message.text}"`)

        if (currentRound < 3) {
          currentRound++
          await sleep(4000)
          await sendPing(currentRound)
        } else {
          console.log('\n --- [ÉXITO] Orquestación Cifrada Finalizada con Éxito. ---')
          console.log('\n CONCEPTO CLAVE:')
          console.log('Defensa en Capas: El cifrado proporciona Confidencialidad, pero NO autenticidad')
          console.log('por sí solo. En este laboratorio unimos cifrado híbrido sobre validación de sesión')
          console.log('ECDSA para crear el estándar de oro en comunicación segura de agentes en Hedera.')
          console.log('\n--- SESIÓN COMPLETADA ---\n')
          setTimeout(() => process.exit(), 1000)
        }
      }
    })

    console.log(`[AGENTE A] Bajo Cifrado: Escuchando carril privado [${agentA_Inbox}]`)
    handlerA_Listen.monitorConnectionMessages()

    await sleep(2000)
    await sendPing(currentRound)
  }

  // --- ARRANQUE DE LA RED PRIVADA ---
  startAgentB()
  setTimeout(startAgentA, 4000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
