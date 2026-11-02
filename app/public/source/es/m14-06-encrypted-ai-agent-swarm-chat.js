/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Chat Encriptado de Enjambre de Agentes de IA (ECDH + AES-256-GCM en HCS)
 * [ CONCEPTO ] Negociación Confidencial Peer-to-Peer de Agentes sobre Consenso Público
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Comunicación Confidencial de Enjambres: Cuando agentes de IA autónomos colaboran
 * o negocian precios de activos OTC, datos propietarios o estrategias financieras,
 * transmitir datos en texto plano a una blockchain pública filtra secretos comerciales.
 * Este laboratorio demuestra comunicación encriptada de extremo a extremo entre agentes (A2A):
 * 1. Los agentes realizan un intercambio de claves Diffie-Hellman en Curvas Elípticas (ECDH) en HCS.
 * 2. Derivan una clave simétrica idéntica AES-256-GCM.
 * 3. Todos los mensajes se encriptan con cifrado autenticado (AES-GCM).
 * 4. La capa de consenso pública de Hedera solo ve texto cifrado, mientras los agentes
 *    descifran y conversan en tiempo real.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las blockchains públicas ofrecen ordenamiento inmutable, no confidencialidad.
 * Al combinar Hedera Consensus Service para la secuenciación de mensajes con
 * criptografía autenticada en el cliente (ECDH + AES-GCM), se crea una red
 * de inteligencia privada, resistente a la censura y matemáticamente segura.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 05: Flujo de Auditoría Cognitiva de Agentes HCS-28
 * - Siguiente: M14 Lab 07: Enjambres Botánicos HCS-15..18
 *
 * [ SECUENCIA ]
 * Alpha -> Hedera: Publicar llave pública ECDH (handshake)
 * Beta -> Hedera: Publicar llave pública ECDH (handshake)
 * Nota Alpha: Deriva la llave AES compartida
 * Nota Beta: Deriva la misma llave AES
 * Alpha -> Hedera: Mensaje cifrado con AES-256-GCM
 * Beta -> Hedera: Leer y descifrar
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/06_encrypted_ai_agent_swarm_chat.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Encripta un mensaje en texto plano usando AES-256-GCM con una clave simétrica compartida.
 *
 * @param {string} plaintext - Texto del mensaje
 * @param {Buffer} key - Clave simétrica de 32 bytes
 * @returns {object} Objeto con iv, texto cifrado y etiqueta de autenticación (hex)
 */
const encryptMessage = (plaintext, key) => {
  const iv = crypto.randomBytes(12) // IV estándar de 96 bits para GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag().toString('hex')

  return {
    iv: iv.toString('hex'),
    ciphertext: encrypted,
    tag
  }
}

/**
 * Desencripta un mensaje cifrado con AES-256-GCM usando la clave compartida.
 *
 * @param {object} payload - Objeto con iv, ciphertext y tag
 * @param {Buffer} key - Clave simétrica de 32 bytes
 * @returns {string} Cadena de texto plano descifrada
 */
const decryptMessage = ({ iv, ciphertext, tag }, key) => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(tag, 'hex'))
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

const main = async () => {
  console.log('╔═══════════════════════════════════════════════════════════════════════╗')
  console.log('║   CHAT ENCRIPTADO DE ENJAMBRE DE AGENTES (ECDH + AES-256-GCM EN HCS)  ║')
  console.log('╚═══════════════════════════════════════════════════════════════════════╝\n')

  const { client } = getClient()

  try {
    // 1. Crear Tópico de Consenso Público para el Canal Encriptado
    console.log('[⚙️ PROCESO] Desplegando Tópico de Comunicación Segura en HCS...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS:A2A:ENCRYPTED:SWARM:CHANNEL')
      .execute(client)

    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[✅ ÉXITO] Tópico de Chat en Consenso Público Creado: ${topicId}`)

    // 2. Inicializar Pares de Claves ECDH de los Agentes (Curva: prime256v1)
    console.log('\n[⚙️ PROCESO] Inicializando pares de claves ECDH de Agentes (Curva: prime256v1)...')
    const agentOracleECDH = crypto.createECDH('prime256v1')
    agentOracleECDH.generateKeys()

    const agentArbitrageurECDH = crypto.createECDH('prime256v1')
    agentArbitrageurECDH.generateKeys()

    const oraclePubKeyHex = agentOracleECDH.getPublicKey('hex')
    const arbitrageurPubKeyHex = agentArbitrageurECDH.getPublicKey('hex')

    console.log(`[🤖 AGENTE 1] Nombre: Agente Alfa (Oráculo)     | Clave Pública: ${oraclePubKeyHex.slice(0, 24)}...`)
    console.log(`[🤖 AGENTE 2] Nombre: Agente Beta  (Arbitrajista) | Clave Pública: ${arbitrageurPubKeyHex.slice(0, 24)}...`)

    // 2.5 Publicar Claves Públicas Efímeras ECDH en el Tópico HCS (Handshake On-Chain)
    console.log('\n[⚙️ PROCESO] Publicando Claves Públicas Efímeras ECDH en el Tópico HCS (Handshake)...')
    for (const [agentName, pubKey] of [['Agente Alfa (Oráculo)', oraclePubKeyHex], ['Agente Beta (Arbitrajista)', arbitrageurPubKeyHex]]) {
      const handshakeTx = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify({
          protocol: 'hcs-encrypted-a2a-v1',
          step: 'ECDH_HANDSHAKE',
          sender: agentName,
          curve: 'prime256v1',
          ephemeralPublicKey: pubKey,
          timestamp: new Date().toISOString()
        }))
        .execute(client)
      const hsReceipt = await handshakeTx.getReceipt(client)
      console.log(`[🤝 HANDSHAKE] Clave Pública ECDH de ${agentName} anclada en Secuencia #${hsReceipt.topicSequenceNumber}`)
    }

    // 3. Ejecutar Intercambio de Claves Diffie-Hellman para Derivar Clave Simétrica
    console.log('\n[⚙️ PROCESO] Ejecutando derivación Diffie-Hellman en Curvas Elípticas...')
    const sharedSecretOracle = agentOracleECDH.computeSecret(agentArbitrageurECDH.getPublicKey())
    const sharedSecretArbitrageur = agentArbitrageurECDH.computeSecret(agentOracleECDH.getPublicKey())

    // Derivar clave AES de 32 bytes determinista mediante SHA-256
    const aesKeyOracle = crypto.createHash('sha256').update(sharedSecretOracle).digest()
    const aesKeyArbitrageur = crypto.createHash('sha256').update(sharedSecretArbitrageur).digest()
    const keyFingerprint = crypto.createHash('sha256').update(aesKeyOracle).digest('hex')

    const keysMatch = aesKeyOracle.equals(aesKeyArbitrageur)
    console.log(`[✅ ÉXITO] Secreto Simétrico Compartido Establecido: ${keysMatch ? 'COINCIDENCIA (100% SEGURO)' : 'DISCREPANCIA'}`)
    console.log(`[🔑 CLAVE] Huella No Reversible SHA-256 de la Clave: ${keyFingerprint.slice(0, 32)}...`)

    // 4. Negociación OTC Encriptada en Vivo
    const dialogue = [
      {
        sender: 'Agente Beta (Arbitrajista)',
        text: 'PROPUESTA: Solicito flujo exclusivo de liquidaciones de mempool para los próximos 1,000 bloques. Oferta: 150 HBAR.',
        fromAgent: 'arbitrageur'
      },
      {
        sender: 'Agente Alfa (Oráculo)',
        text: 'CONTRA-OFERTA: Canal activo. La congestión actual de red exige 180 HBAR para prioridad máxima de streaming gRPC.',
        fromAgent: 'oracle'
      },
      {
        sender: 'Agente Beta (Arbitrajista)',
        text: 'ACUERDO: Contra-oferta aceptada en 180 HBAR. Generando compromiso de liquidación x402.',
        fromAgent: 'arbitrageur'
      }
    ]

    console.log('\n═════════════════════════════════════════════════════════════════════════')
    console.log('             AUDITORÍA DE CONVERSACIÓN ENCRIPTADA EN CONSENSO            ')
    console.log('═════════════════════════════════════════════════════════════════════════')

    for (let i = 0; i < dialogue.length; i++) {
      const step = dialogue[i]
      const encryptionKey = step.fromAgent === 'arbitrageur' ? aesKeyArbitrageur : aesKeyOracle
      const decryptionKey = step.fromAgent === 'arbitrageur' ? aesKeyOracle : aesKeyArbitrageur

      // Encriptar mensaje
      const encryptedPacket = encryptMessage(step.text, encryptionKey)

      const onChainPayload = {
        protocol: 'hcs-encrypted-a2a-v1',
        step: i + 1,
        sender: step.sender,
        iv: encryptedPacket.iv,
        ciphertext: encryptedPacket.ciphertext,
        tag: encryptedPacket.tag,
        timestamp: new Date().toISOString()
      }

      // Transmitir al Consenso de Hedera
      const submitTx = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify(onChainPayload))
        .execute(client)

      const receipt = await submitTx.getReceipt(client)
      const seq = receipt.topicSequenceNumber.toString()

      // Desencriptar mensaje en el receptor
      const decryptedText = decryptMessage(encryptedPacket, decryptionKey)

      console.log(`\n💬 [MENSAJE #${seq}] Emisor: ${step.sender}`)
      console.log(`   ├─ 🔒 Lo que ve el Mirror Node (Cifrado): ${encryptedPacket.ciphertext.slice(0, 32)}... [Tag: ${encryptedPacket.tag.slice(0, 16)}]`)
      console.log(`   └─ 🔓 Texto Plano Descifrado por Receptor: "${decryptedText}"`)
    }

    console.log('\n═════════════════════════════════════════════════════════════════════════')
    console.log('                 INFORME DE AUDITORÍA DE CONFIDENCIALIDAD               ')
    console.log('═════════════════════════════════════════════════════════════════════════')
    console.log(`[📊 REGISTRO] Tópico de Hedera:       ${topicId}`)
    console.log('[📊 REGISTRO] Algoritmo Cifrado:      AES-256-GCM (Etiqueta Autenticada NIST SP 800-38D GMAC)')
    console.log('[📊 REGISTRO] Visibilidad Pública:    CERO filtración de texto plano en exploradores')
    console.log('[📊 REGISTRO] Orden de Consenso:      Números de secuencia 100% justos en Hedera')

    // Persistir estado (¡jamás guardar la clave de cifrado cruda, solo la huella SHA-256!)
    updateState('ENCRYPTED_CHAT_TOPIC_ID', topicId)
    updateState('ENCRYPTED_CHAT_CIPHER_ALGO', 'AES-256-GCM')
    updateState('ENCRYPTED_CHAT_SHARED_KEY_DIGEST', keyFingerprint)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Esta arquitectura es el Santo Grial para empresas y agentes de IA:')
    console.log('Se obtiene el orden inmutable y descentralizado de Hedera Consensus Service,')
    console.log('mientras se preserva privacidad militar en los datos mediante criptografía en cliente.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('La privacidad real no proviene de ocultar la blockchain, sino de asegurar')
    console.log('que solo los destinatarios autorizados posean las claves de descifrado.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en el Chat Encriptado:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
