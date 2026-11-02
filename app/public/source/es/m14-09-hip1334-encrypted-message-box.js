/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 09: Buzón de Mensajes Cifrado Descentralizado HIP-1334 en HCS
 * [ CONCEPTO ] Mensajería Confidencial P2P Asimétrica Descubierta por el Memo de Cuenta
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En las economías multiagente autónomas, los agentes de IA y las cuentas institucionales
 * deben comunicarse órdenes de trading confidenciales, credenciales criptográficas y pruebas
 * KYC sin depender de servidores centralizados de mensajería (Telegram, Signal, Discord).
 *
 * HIP-1334 estandariza un buzón cifrado descentralizado integrado en el libro mayor:
 * 1. Publicidad del Buzón: Las cuentas publican su tópico de entrada y clave pública de
 *    cifrado en su memo de cuenta o registro de identidad HCS:
 *    `hip1334:inbox=0.0.X;key=04...`
 * 2. Intercambio Diffie-Hellman (ECDH): El emisor genera un par de claves efímero y calcula
 *    un secreto compartido con la clave pública del destinatario.
 * 3. Cifrado Militar AES-256-GCM: La carga útil se cifra con un algoritmo AES-GCM autenticado,
 *    produciendo texto cifrado, IV y una etiqueta de integridad.
 * 4. Envío Inmutable a HCS: El sobre cifrado se envía al tópico público del buzón en
 *    Hedera Testnet por $0.0001.
 * 5. Descifrado por el Destinatario: El receptor consume el flujo del tópico, deriva el
 *    mismo secreto compartido con su clave privada, valida la etiqueta de autenticación
 *    y recupera el texto original.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * El consenso aporta orden justo y sellado de tiempo; la criptografía en cliente proporciona
 * confidencialidad absoluta. Aunque la transacción se transmite en una red pública
 * Byzantine Fault Tolerant, ningún espía ni nodo de consenso puede leer el contenido.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-1334
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 08: HashLinks HCS-12 y Adaptadores Verificados HCS-21
 * - Siguiente: M14 Lab 10: Servidor MCP Hashnet y Firewall de Políticas HOL Guard
 *
 * [ SECUENCIA ]
 * Destinatario -> Hedera: Crear tema buzón; el memo anuncia su llave pública
 * Remitente -> Hedera: Leer la llave del buzón desde el memo
 * Nota Remitente: ECDH efímero + AES-256-GCM
 * Remitente -> Hedera: Sobre cifrado al buzón
 * Destinatario -> Hedera: Leer y descifrar con su llave privada
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/09_hip1334_encrypted_message_box.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

/**
 * Motor Criptográfico del Buzón HIP-1334 (secp256k1 ECDH + AES-256-GCM)
 */
class Hip1334MailboxEngine {
  constructor () {
    this.ecdh = crypto.createECDH('secp256k1')
    this.ecdh.generateKeys()
    this.publicKeyHex = this.ecdh.getPublicKey('hex')
  }

  encryptForRecipient (recipientPublicKeyHex, plaintext) {
    const senderEcdh = crypto.createECDH('secp256k1')
    senderEcdh.generateKeys()
    const ephemeralPubKeyHex = senderEcdh.getPublicKey('hex')

    // Derivar clave simétrica: SHA-256(ECDH(senderPriv, recipientPub))
    const sharedSecret = senderEcdh.computeSecret(recipientPublicKeyHex, 'hex')
    const symmetricKey = crypto.createHash('sha256').update(sharedSecret).digest()

    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', symmetricKey, iv)
    let encrypted = cipher.update(plaintext, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const authTag = cipher.getAuthTag().toString('hex')

    return {
      standard: 'HIP-1334',
      version: '1.0',
      ephemeralPublicKey: ephemeralPubKeyHex,
      iv: iv.toString('hex'),
      ciphertext: encrypted,
      authTag,
      timestamp: Date.now()
    }
  }

  decryptEnvelope (envelope) {
    const sharedSecret = this.ecdh.computeSecret(envelope.ephemeralPublicKey, 'hex')
    const symmetricKey = crypto.createHash('sha256').update(sharedSecret).digest()

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      symmetricKey,
      Buffer.from(envelope.iv, 'hex')
    )
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'hex'))

    let decrypted = decipher.update(envelope.ciphertext, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Buzón Cifrado Descentralizado HIP-1334 ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Inicializar Agente Destinatario con Claves de Cifrado Asimétricas
    console.log('[⚙️ PROCESO] Paso 1: Configurando Identidad del Buzón del Agente Destinatario...')
    const recipientMailbox = new Hip1334MailboxEngine()

    console.log(`[📊 LOG] Cuenta Destinataria:    ${operatorId.toString()}`)
    console.log(`[📊 LOG] Clave Pública de Cifrado: ${recipientMailbox.publicKeyHex.substring(0, 32)}...`)

    // 2. Crear Tópico de Entrada HCS Dedicado en Testnet
    console.log('\n[⚙️ PROCESO] Paso 2: Creando Tópico HCS Dedicado de Entrada para el Buzón...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo(`HIP1334:INBOX:${operatorId.toString()}`)
      .execute(client)

    const topicReceipt = await topicTx.getReceipt(client)
    const inboxTopicId = topicReceipt.topicId
    console.log(`[✅ ÉXITO] Tópico de Buzón de Entrada Creado: ${inboxTopicId.toString()}`)
    console.log(`[🔗 ANUNCIO EN MEMO] hip1334:inbox=${inboxTopicId.toString()};key=${recipientMailbox.publicKeyHex.substring(0, 16)}...`)

    // 3. El Emisor Descubre el Buzón y Cifra la Carga Confidencial
    console.log('\n[⚙️ PROCESO] Paso 3: Emisor Derivando Secreto ECDH y Cifrando Carga Útil (AES-256-GCM)...')
    const confidentialOrder = JSON.stringify({
      orderId: 'AGENT-OTC-7712',
      strategy: 'DELTA_NEUTRAL_ARBITRAGE',
      maxBorrowTinybars: 500000000,
      authorizedAgent: '0.0.11226623',
      settlementDeadline: Date.now() + 60000
    })

    const senderEngine = new Hip1334MailboxEngine()
    const encryptedEnvelope = senderEngine.encryptForRecipient(
      recipientMailbox.publicKeyHex,
      confidentialOrder
    )

    console.log('[✅ ÉXITO] ¡Carga Útil Cifrada!')
    console.log(`[📊 LOG] Clave Pública Efímera: ${encryptedEnvelope.ephemeralPublicKey.substring(0, 24)}...`)
    console.log(`[📊 LOG] IV (Nonce):           ${encryptedEnvelope.iv}`)
    console.log(`[📊 LOG] Texto Cifrado (Hex):   ${encryptedEnvelope.ciphertext}`)
    console.log(`[📊 LOG] Tag Auth (GCM):       ${encryptedEnvelope.authTag}`)

    // 4. Enviar Sobre Cifrado a la Capa de Consenso de Hedera
    console.log('\n[⚙️ PROCESO] Paso 4: Enviando Sobre Cifrado al Tópico de Entrada HCS del Destinatario...')
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(inboxTopicId)
      .setMessage(JSON.stringify(encryptedEnvelope))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    console.log(`\n[✅ ÉXITO] ¡Mensaje Cifrado Anclado en HCS! Estado: ${submitReceipt.status.toString()}`)
    console.log(`[📊 LOG] Secuencia de Consenso: #${submitReceipt.topicSequenceNumber.toString()}`)
    console.log(`[📊 LOG] ID de Transacción:      ${submitTx.transactionId.toString()}`)
    console.log(`[🔗 EXPLORADOR] Ver en HashScan: ${getHashscanUrl(submitTx)}`)

    // 5. Ingesta por el Destinatario, Autenticación y Descifrado
    console.log('\n[⚙️ PROCESO] Paso 5: Destinatario Ingestando el Sobre y Autenticando Descifrado GCM...')
    const decryptedPlaintext = recipientMailbox.decryptEnvelope(encryptedEnvelope)
    const parsedPayload = JSON.parse(decryptedPlaintext)

    console.log('[✅ ÉXITO] ¡Integridad Criptográfica Autenticada y Texto Plano Recuperado!')
    console.log(`   ID de Orden:        ${parsedPayload.orderId}`)
    console.log(`   Estrategia:         ${parsedPayload.strategy}`)
    console.log(`   Préstamo Máximo:    ${parsedPayload.maxBorrowTinybars / 1e8} ℏ`)
    console.log(`   Agente Autorizado:  ${parsedPayload.authorizedAgent}`)

    updateState('HIP1334_INBOX_TOPIC_ID', inboxTopicId.toString())
    updateState('HIP1334_LAST_CIPHERTEXT', encryptedEnvelope.ciphertext)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Confidencialidad Sin Servidores: HIP-1334 desacopla las comunicaciones confidenciales')
    console.log('de intermediarios en la nube. Al anclar sobres cifrados de extremo a extremo en HCS,')
    console.log('las partes obtienen prueba irrevocable de entrega sin comprometer la privacidad.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Cifrado Autenticado (AES-GCM): La etiqueta de autenticación de 16 bytes garantiza que si')
    console.log('un atacante intenta alterar incluso un solo bit del texto cifrado en tránsito,')
    console.log('el destinatario rechazará matemáticamente el paquete con un error de autenticación.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en el Buzón HIP-1334:', error.message)
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
