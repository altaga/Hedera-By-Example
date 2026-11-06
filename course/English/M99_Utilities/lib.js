import * as crypto from 'crypto'
import { EventEmitter } from 'events'
import * as fs from 'fs' // Required for utility functions in HybridEncryption

// Mirror Node base URL for the configured network (kept local so the browser bundle stays small).
const mirrorNode = () => {
  const network = (process.env.NETWORK || 'testnet').toLowerCase()
  if (network === 'mainnet') return 'https://mainnet-public.mirrornode.hedera.com'
  if (network === 'previewnet') return 'https://previewnet.mirrornode.hedera.com'
  return 'https://testnet.mirrornode.hedera.com'
}

// ============================================
//  HybridEncryption Utility Class
// ============================================

class HybridEncryption {
  /**
   * Encrypts data of any type using hybrid encryption (RSA + AES-256-GCM)
   * Automatically handles strings, objects, arrays, and primitives.
   * * @param {any} data - The data to encrypt (string, object, array, number, boolean, etc.)
   * @param {string} publicKeyPem - RSA public key in PEM format
   * @returns {string} - Encrypted data object as a JSON string for transmission/storage.
   */
  static encrypt (data, publicKeyPem) {
    // Determine data type and prepare for encryption
    const dataType = this._getDataType(data)
    const plaintext = this._serialize(data, dataType)

    // Generate a random 256-bit AES key (32 bytes)
    const aesKey = crypto.randomBytes(32)

    // Generate a random 128-bit initialization vector (16 bytes)
    const iv = crypto.randomBytes(16)

    // Encrypt the plaintext using AES-256-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv)
    let encryptedData = cipher.update(plaintext, 'utf8', 'base64')
    encryptedData += cipher.final('base64')

    // Get the authentication tag (for data integrity verification)
    const authTag = cipher.getAuthTag()

    // Encrypt the AES key with the RSA public key (RSA-OAEP with SHA256)
    const encryptedKey = crypto.publicEncrypt(
      {
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      aesKey
    )

    // Package all components into an object
    const resultObject = {
      ciphertext: encryptedData,
      encryptedKey: encryptedKey.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      dataType // Store type for proper deserialization
    }

    // Return the stringified version for easy storage/transmission
    return JSON.stringify(resultObject)
  }

  /**
   * Decrypts data encrypted with the encrypt method.
   * Can accept the encrypted data as a string (from storage/network) or an object.
   * Automatically deserializes to the original data type.
   * * @param {object|string} encryptedData - Object containing ciphertext, encryptedKey, etc., OR the JSON stringified version of this object.
   * @param {string} privateKeyPem - RSA private key in PEM format
   * @returns {any} - The decrypted data in its original type
   */
  static decrypt (encryptedData, privateKeyPem) {
    let dataToDecrypt

    // Handle string input by parsing it
    if (typeof encryptedData === 'string') {
      try {
        dataToDecrypt = JSON.parse(encryptedData)
      } catch (error) {
        throw new Error(
          'Input to decrypt is an invalid JSON string: ' + error.message
        )
      }
    } else if (typeof encryptedData === 'object' && encryptedData !== null) {
      dataToDecrypt = encryptedData
    } else {
      throw new Error(
        'Invalid encryptedData format. Must be a JSON string or an object.'
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
        'Encrypted data object is missing required fields (ciphertext, encryptedKey, iv, or authTag).'
      )
    }

    // Decrypt the AES key using the RSA private key
    const aesKey = crypto.privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      },
      Buffer.from(encryptedKey, 'base64')
    )

    // Decrypt the ciphertext using the AES key
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      aesKey,
      Buffer.from(iv, 'base64')
    )

    // Set the authentication tag for verification
    decipher.setAuthTag(Buffer.from(authTag, 'base64'))

    // Decrypt the data
    let decrypted = decipher.update(ciphertext, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    // Deserialize based on original data type
    return this._deserialize(decrypted, dataType)
  }

  /**
   * Encrypts a JSON object directly (convenience method)
   * @param {object} jsonObject - JavaScript object to encrypt
   * @param {string} publicKeyPem - RSA public key in PEM format
   * @returns {string} - Encrypted data object as a JSON string
   */
  static encryptJSON (jsonObject, publicKeyPem) {
    if (typeof jsonObject !== 'object' || jsonObject === null) {
      throw new Error('encryptJSON requires an object as input')
    }
    return this.encrypt(jsonObject, publicKeyPem)
  }

  /**
   * Decrypts and returns a JSON object (convenience method)
   * @param {object|string} encryptedData - Encrypted data object OR JSON string
   * @param {string} privateKeyPem - RSA private key in PEM format
   * @returns {object} - The decrypted JavaScript object
   */
  static decryptJSON (encryptedData, privateKeyPem) {
    const result = this.decrypt(encryptedData, privateKeyPem)
    if (typeof result !== 'object' || result === null) {
      throw new Error('Decrypted data is not a valid JSON object')
    }
    return result
  }

  // --- Private Serialization/Deserialization Helpers ---

  /**
   * Determines the type of data for proper serialization
   * @private
   */
  static _getDataType (data) {
    if (typeof data === 'string') return 'string'
    if (typeof data === 'number') return 'number'
    if (typeof data === 'boolean') return 'boolean'
    if (data === null) return 'null'
    if (data === undefined) return 'undefined'
    if (Array.isArray(data)) return 'array'
    if (typeof data === 'object') return 'object'
    return 'string' // fallback
  }

  /**
   * Serializes data to string format for encryption
   * @private
   */
  static _serialize (data, dataType) {
    switch (dataType) {
      case 'string':
        return data
      case 'number':
      case 'boolean':
        return String(data)
      case 'null':
        return 'null'
      case 'undefined':
        return 'undefined'
      case 'array':
      case 'object':
        return JSON.stringify(data)
      default:
        return String(data)
    }
  }

  /**
   * Deserializes decrypted string back to original data type
   * @private
   */
  static _deserialize (decryptedString, dataType) {
    switch (dataType) {
      case 'string':
        return decryptedString
      case 'number':
        return Number(decryptedString)
      case 'boolean':
        return decryptedString === 'true'
      case 'null':
        return null
      case 'undefined':
        return undefined
      case 'array':
      case 'object':
        return JSON.parse(decryptedString)
      default:
        return decryptedString
    }
  }

  // --- Utility Methods for Key Management ---

  /**
   * Load a PEM file from disk
   * @param {string} filePath - Path to the PEM file
   * @returns {string} - Contents of the PEM file
   */
  static loadPemFile (filePath) {
    return fs.readFileSync(filePath, 'utf8')
  }

  /**
   * Generate a new RSA key pair
   * @param {number} modulusLength - Key size in bits (e.g., 2048)
   * @returns {object} - Object containing publicKey and privateKey in PEM format
   */
  static generateKeyPair (modulusLength = 2048) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    })

    return { publicKey, privateKey }
  }

  /**
   * Save keys to PEM files
   */
  static saveKeyPair (publicKey, privateKey, publicKeyPath, privateKeyPath) {
    fs.writeFileSync(publicKeyPath, publicKey)
    fs.writeFileSync(privateKeyPath, privateKey)
    console.log(`Keys saved to ${publicKeyPath} and ${privateKeyPath}`)
  }
}

// ============================================
//  AgentCommunicationHandler Class
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
    this.stopped = false
  }

  // Ends the monitoring loop after its current poll.
  stop () {
    this.stopped = true
  }

  // --- Monitoring Loop ---
  async monitorConnectionMessages () {
    // Start after the newest message already on the topic: only messages sent from now on count.
    const res = await fetch(`${mirrorNode()}/api/v1/topics/${this.connectionTopicId}/messages?order=desc&limit=1`)
    let lastSequence = res.ok ? ((await res.json()).messages?.[0]?.sequence_number ?? 0) : 0
    console.log(`Monitoring connection topic ${this.connectionTopicId} for messages`)

    while (!this.stopped) {
      try {
        // Ask only for messages after the last sequence number seen, not the whole topic history.
        const { messages } = await this.client.getMessages(this.connectionTopicId, { sequenceNumber: `gt:${lastSequence}`, order: 'asc', limit: 25 })
        for (const msg of messages) {
          if (this.stopped) break
          lastSequence = Math.max(lastSequence, msg.sequence_number)
          if (msg.op !== 'message') continue
          const idSplit = msg.operator_id.includes('@') ? msg.operator_id.split('@') : []
          if (msg.operator_id !== this.operatorId && (idSplit.length === 0 || this.authorizedClients.includes(idSplit[1]))) {
            await this.processMessage(msg)
          }
        }
      } catch (error) {
        console.error(`Error monitoring connection messages: ${error.message}`)
        if (this.listenerCount('error')) this.emit('error', error)
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }

  // --- Process received message using HybridEncryption (Handles JSON/String/Buffer) ---
  async processMessage (message) {
    try {
      let payloadToDecrypt = message.data
      if (payloadToDecrypt instanceof Uint8Array || Buffer.isBuffer(payloadToDecrypt)) {
        payloadToDecrypt = Buffer.from(payloadToDecrypt).toString('utf8')
      }
      // Large payloads arrive as an HCS-1 reference (hcs://1/<topic>): fetch the content first.
      if (typeof payloadToDecrypt === 'string' && payloadToDecrypt.startsWith('hcs://')) {
        payloadToDecrypt = await this.client.getMessageContent(payloadToDecrypt)
        if (typeof payloadToDecrypt !== 'string') payloadToDecrypt = Buffer.from(payloadToDecrypt).toString('utf8')
      }
      // The encrypted envelope travels as a JSON string: parse it so it can be decrypted.
      if (typeof payloadToDecrypt === 'string') {
        try { payloadToDecrypt = JSON.parse(payloadToDecrypt) } catch (_) {}
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
      if (this.listenerCount('error')) this.emit('error', error)
    }
  }

  // --- Send message using HybridEncryption (Fix: added JSON.stringify) ---
  async sendMessage (data, recipientAccountId, memo = '') {
    try {
      const recipientPublicKey = this.recipientPublicKeys[recipientAccountId]
      if (!recipientPublicKey) {
        throw new Error(
          `No public key found for recipient ${recipientAccountId}`
        )
      }

      console.log(
        `[SEND] Encrypting and sending data to ${recipientAccountId}`
      )

      // 1. Encrypt the data (returns the object containing ciphertext, key, iv, etc.)
      const encryptedPayload = HybridEncryption.encrypt(
        data,
        recipientPublicKey
      )

      // 2. Send the transaction with the serialized string
      const result = await this.client.sendMessage(
        this.connectionTopicId,
        encryptedPayload,
        memo
      )
      console.log(
        'Message sent successfully.'
      )
      return result
    } catch (error) {
      console.error(`Failed to send message: ${error.message}`)
      throw error
    }
  }
}

export { HybridEncryption }
export default AgentCommunicationHandler
