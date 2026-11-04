/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import * as crypto from 'crypto'
import { EventEmitter } from 'events'
import * as fs from 'fs' // Requerido para funciones de utilidad en HybridEncryption

// ============================================
//  Clase Utilitaria HybridEncryption
// ============================================

class HybridEncryption {
  /**
   * Cifra datos de cualquier tipo usando cifrado híbrido (RSA + AES-256-GCM)
   * Maneja automáticamente cadenas, objetos, arreglos y primitivos.
   * @param {any} data - Los datos a cifrar (cadena, objeto, arreglo, número, boolean, etc.)
   * @param {string} publicKeyPem - Clave pública RSA en formato PEM
   * @returns {string} - Objeto de datos cifrados como una cadena JSON para transmisión/almacenamiento.
   */
  static encrypt (data, publicKeyPem) {
    // Determinar tipo de dato y preparar para cifrado
    const dataType = this._getDataType(data)
    const plaintext = this._serialize(data, dataType)

    // Generar una clave AES de 256 bits aleatoria (32 bytes)
    const aesKey = crypto.randomBytes(32)

    // Generar un vector de inicialización de 128 bits aleatorio (16 bytes)
    const iv = crypto.randomBytes(16)

    // Cifrar el texto plano usando AES-256-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
    let encryptedData = cipher.update(plaintext, 'utf8', 'base64')
    encryptedData += cipher.final('base64')

    // Obtener la etiqueta de autenticación (para verificar la integridad de datos)
    const authTag = cipher.getAuthTag()

    // Cifrar la clave AES con la clave pública RSA (RSA-OAEP con SHA256)
    const encryptedKey = crypto.publicEncrypt(
      {
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      aesKey
    )

    // Empaquetar todos los componentes en un objeto
    const resultObject = {
      ciphertext: encryptedData,
      encryptedKey: encryptedKey.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      dataType // Almacenar tipo para una correcta deserialización
    }

    // Retornar la versión stringificada para fácil almacenamiento/transmisión
    return JSON.stringify(resultObject)
  }

  /**
   * Descifra datos cifrados con el método encrypt.
   * Puede aceptar los datos como string o como objeto.
   * @param {object|string} encryptedData - Objeto o string JSON con ciphertext, encryptedKey, etc.
   * @param {string} privateKeyPem - Clave privada RSA en formato PEM
   * @returns {any} - Los datos descifrados en su tipo original
   */
  static decrypt (encryptedData, privateKeyPem) {
    let dataToDecrypt

    // Manejar entrada de string parseándola
    if (typeof encryptedData === 'string') {
      try {
        dataToDecrypt = JSON.parse(encryptedData)
      } catch (error) {
        throw new Error(
          'El input a descifrar es un string JSON inválido: ' + error.message
        )
      }
    } else if (typeof encryptedData === 'object' && encryptedData !== null) {
      dataToDecrypt = encryptedData
    } else {
      throw new Error(
        'Formato encryptedData inválido. Debe ser string JSON o un objeto.'
      )
    }

    const {
      ciphertext,
      encryptedKey,
      iv,
      authTag,
      dataType = 'string'
    } = dataToDecrypt

    if (!ciphertext || !encryptedKey || !iv || !authTag) {
      throw new Error(
        'El objeto cifrado no tiene los campos requeridos (ciphertext, encryptedKey, iv, o authTag).'
      )
    }

    // Descifrar la clave AES usando la clave privada RSA
    const aesKey = crypto.privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      Buffer.from(encryptedKey, 'base64')
    )

    // Descifrar el ciphertext usando la clave AES
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      aesKey,
      Buffer.from(iv, 'base64')
    )

    // Establecer la etiqueta de autenticación para verificación
    decipher.setAuthTag(Buffer.from(authTag, 'base64'))

    // Descifrar los datos
    let decrypted = decipher.update(ciphertext, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    // Deserializar basado en el tipo original
    return this._deserialize(decrypted, dataType)
  }

  /**
   * Cifra un objeto JSON directamente (método de conveniencia)
   */
  static encryptJSON (jsonObject, publicKeyPem) {
    if (typeof jsonObject !== 'object' || jsonObject === null) {
      throw new Error('encryptJSON requiere un objeto de entrada')
    }
    return this.encrypt(jsonObject, publicKeyPem)
  }

  /**
   * Descifra y retorna un objeto JSON (método de conveniencia)
   */
  static decryptJSON (encryptedData, privateKeyPem) {
    const result = this.decrypt(encryptedData, privateKeyPem)
    if (typeof result !== 'object' || result === null) {
      throw new Error('Los datos descifrados no son un objeto JSON válido')
    }
    return result
  }

  // --- Helpers de Serialización/Deserialización Privados ---

  static _getDataType (data) {
    if (typeof data === 'string') return 'string'
    if (typeof data === 'number') return 'number'
    if (typeof data === 'boolean') return 'boolean'
    if (data === null) return 'null'
    if (data === undefined) return 'undefined'
    if (Array.isArray(data)) return 'array'
    if (typeof data === 'object') return 'object'
    return 'string'
  }

  static _serialize (data, dataType) {
    switch (dataType) {
      case 'string': return data
      case 'number':
      case 'boolean': return String(data)
      case 'null': return 'null'
      case 'undefined': return 'undefined'
      case 'array':
      case 'object': return JSON.stringify(data)
      default: return String(data)
    }
  }

  static _deserialize (decryptedString, dataType) {
    switch (dataType) {
      case 'string': return decryptedString
      case 'number': return Number(decryptedString)
      case 'boolean': return decryptedString === 'true'
      case 'null': return null
      case 'undefined': return undefined
      case 'array':
      case 'object': return JSON.parse(decryptedString)
      default: return decryptedString
    }
  }

  // --- Métodos de Utilidad para Gestión de Claves ---

  static loadPemFile (filePath) {
    return fs.readFileSync(filePath, 'utf8')
  }

  static generateKeyPair (modulusLength = 2048) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    return { publicKey, privateKey }
  }

  static saveKeyPair (publicKey, privateKey, publicKeyPath, privateKeyPath) {
    fs.writeFileSync(publicKeyPath, publicKey)
    fs.writeFileSync(privateKeyPath, privateKey)
    console.log(`[VERIFICADO] Claves guardadas en ${publicKeyPath} y ${privateKeyPath}`)
  }
}

// ============================================
//  Clase AgentCommunicationHandler
// ============================================

export class AgentCommunicationHandler extends EventEmitter {
  constructor (
    client,
    connectionTopicId,
    operatorId,
    myPrivateKeyPem,
    recipientPublicKeys = {},
    authorizedClients = []
  ) {
    super()
    this.client = client
    this.connectionTopicId = connectionTopicId
    this.operatorId = operatorId
    this.myPrivateKeyPem = myPrivateKeyPem
    this.recipientPublicKeys = recipientPublicKeys
    this.authorizedClients = authorizedClients
  }

  // --- Bucle de Monitoreo ---
  async monitorConnectionMessages () {
    let lastProcessedTimestamp = 0.0
    const initial = await this.client.getMessages(this.connectionTopicId)
    for (const msg of initial.messages) {
      if (parseFloat(msg.consensus_timestamp) > lastProcessedTimestamp && msg.op === 'message') {
        lastProcessedTimestamp = parseFloat(msg.consensus_timestamp)
      }
    }
    console.log(`[ESTADO] Monitoreando tópico ${this.connectionTopicId} para mensajes.`)

    while (true) {
      try {
        const snapshot = await this.client.getMessages(this.connectionTopicId)
        for (const msg of snapshot.messages) {
          if (parseFloat(msg.consensus_timestamp) > lastProcessedTimestamp && msg.op === 'message') {
            lastProcessedTimestamp = parseFloat(msg.consensus_timestamp)

            const idSplit = msg.operator_id.includes('@') ? msg.operator_id.split('@') : []
            if (msg.operator_id !== this.operatorId && (idSplit.length === 0 || this.authorizedClients.includes(idSplit[1]))) {
              await this.processMessage(msg)
            }
          }
        }
      } catch (error) {
        console.error(`[ERROR] Monitoreo de conexión: ${error.message}`)
        this.emit('error', error)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  // --- Procesar mensaje recibido usando HybridEncryption ---
  async processMessage (message) {
    try {
      let payloadToDecrypt = message.data
      if (payloadToDecrypt instanceof Uint8Array || Buffer.isBuffer(payloadToDecrypt)) {
        payloadToDecrypt = Buffer.from(payloadToDecrypt).toString('utf8')
      }
      if (typeof payloadToDecrypt === 'string') {
        try {
          // If it's valid JSON, this works. If it's a file reference, it throws and we fetch it.
          JSON.parse(payloadToDecrypt)
        } catch (e) {
          payloadToDecrypt = await this.client.getMessageContent(payloadToDecrypt)
        }
      }
      let decryptedMessage = payloadToDecrypt

      // Check if the payload is a Hybrid Encrypted object
      if (typeof payloadToDecrypt === 'object' && payloadToDecrypt !== null && payloadToDecrypt.ciphertext && payloadToDecrypt.encryptedKey) {
        decryptedMessage = HybridEncryption.decrypt(payloadToDecrypt, this.myPrivateKeyPem)
      }

      const senderId = message.operator_id.includes('@') ? message.operator_id.split('@')[1] : message.operator_id

      this.emit('messageReceived', {
        senderId,
        message: decryptedMessage,
        timestamp: message.consensus_timestamp
      })
    } catch (error) {
      this.emit('error', error)
    }
  }

  // --- Enviar mensaje usando HybridEncryption ---
  async sendMessage (data, recipientAccountId, memo = '') {
    try {
      const recipientPublicKey = this.recipientPublicKeys[recipientAccountId]
      if (!recipientPublicKey) {
        throw new Error(`Clave pública no encontrada para el receptor ${recipientAccountId}`)
      }

      console.log(`[ACCIÓN] Cifrando y enviando datos al receptor ${recipientAccountId}`)

      // 1. Cifrar los datos
      const encryptedPayload = HybridEncryption.encrypt(data, recipientPublicKey)

      // 2. Enviar la transacción
      const result = await this.client.sendMessage(this.connectionTopicId, encryptedPayload, memo)
      console.log('[VERIFICADO] Mensaje enviado exitosamente.')
      return result
    } catch (error) {
      console.error(`[ERROR] Fallo al enviar mensaje: ${error.message}`)
      throw error
    }
  }
}

export { HybridEncryption }
export default AgentCommunicationHandler
