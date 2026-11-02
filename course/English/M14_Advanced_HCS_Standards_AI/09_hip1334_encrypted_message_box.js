/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 09: HIP-1334 Decentralized Encrypted Mailbox on HCS
 * [ CONCEPT ] Asymmetric P2P Confidential Messaging Discovered via Account Memos
 * ============================================================================
 * [ KEY CONCEPT ]
 * In autonomous multi-agent economies, AI agents and institutional accounts must
 * communicate confidential trading orders, cryptographic credentials, and KYC
 * proofs without relying on centralized communication servers (Telegram, Signal, Discord).
 *
 * HIP-1334 standardizes a decentralized, ledger-native encrypted mailbox:
 * 1. Mailbox Advertising: Accounts advertise their public inbox topic and encryption
 *    public key inside their account memo or an HCS identity registry:
 *    `hip1334:inbox=0.0.X;key=04...`
 * 2. Diffie-Hellman Key Exchange (ECDH): The sender generates an ephemeral keypair
 *    and computes a shared secret with the recipient's public key.
 * 3. AES-256-GCM Military-Grade Encryption: The payload is encrypted with an
 *    authenticated AES-GCM cipher, producing ciphertext, IV, and an integrity tag.
 * 4. Immutable HCS Dispatch: The encrypted envelope is submitted to the recipient's
 *    public inbox topic on Hedera Testnet for $0.0001.
 * 5. Recipient Decryption: The recipient consumes their topic feed, derives the
 *    identical shared secret using their private key, verifies the authentication tag,
 *    and recovers the plaintext message.
 *
 * [ LEARNABLE MOMENT ]
 * Consensus provides fair ordering and timestamping; client-side cryptography provides
 * absolute confidentiality. Even though the transaction is broadcast over a public
 * Byzantine Fault Tolerant network, zero eavesdroppers or consensus nodes can read the content.
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 08: HCS-12 HashLinks & HCS-21 Verified Adapters
 * - Next:     M14 Lab 10: Hashnet MCP Server & HOL Guard Security Policy Firewall
 *
 * [ SEQUENCE ]
 * Recipient -> Hedera: Create inbox topic; memo advertises its public key
 * Sender -> Hedera: Read the inbox key from the memo
 * Note Sender: Ephemeral ECDH + AES-256-GCM
 * Sender -> Hedera: Encrypted envelope to the inbox
 * Recipient -> Hedera: Read and decrypt with its private key
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M14_Advanced_HCS_Standards_AI/09_hip1334_encrypted_message_box.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

/**
 * HIP-1334 Cryptographic Mailbox Engine (secp256k1 ECDH + AES-256-GCM)
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

    // Derive symmetric key: SHA-256(ECDH(senderPriv, recipientPub))
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
  console.log('--- SESSION START: HIP-1334 Decentralized Encrypted Mailbox ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Initialize Recipient Agent with Asymmetric Encryption Keys
    console.log('[⚙️ PROCESS] Step 1: Provisioning Recipient Agent Mailbox Identity...')
    const recipientMailbox = new Hip1334MailboxEngine()

    console.log(`[📊 LOG] Recipient Account:      ${operatorId.toString()}`)
    console.log(`[📊 LOG] Public Encryption Key:  ${recipientMailbox.publicKeyHex.substring(0, 32)}...`)

    // 2. Provision Recipient's Inbound HCS Mailbox Topic on Testnet
    console.log('\n[⚙️ PROCESS] Step 2: Provisioning Dedicated HCS Inbound Mailbox Topic...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo(`HIP1334:INBOX:${operatorId.toString()}`)
      .execute(client)

    const topicReceipt = await topicTx.getReceipt(client)
    const inboxTopicId = topicReceipt.topicId
    console.log(`[✅ SUCCESS] Inbound Mailbox Topic Created: ${inboxTopicId.toString()}`)
    console.log(`[🔗 MEMO ADVERTISEMENT] hip1334:inbox=${inboxTopicId.toString()};key=${recipientMailbox.publicKeyHex.substring(0, 16)}...`)

    // 3. Sender Discovers Mailbox & Encrypts Confidential Payload
    console.log('\n[⚙️ PROCESS] Step 3: Sender Deriving ECDH Secret & Encrypting Payload (AES-256-GCM)...')
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

    console.log('[✅ SUCCESS] Payload Encrypted!')
    console.log(`[📊 LOG] Ephemeral Public Key: ${encryptedEnvelope.ephemeralPublicKey.substring(0, 24)}...`)
    console.log(`[📊 LOG] IV (Nonce):           ${encryptedEnvelope.iv}`)
    console.log(`[📊 LOG] Ciphertext (Hex):     ${encryptedEnvelope.ciphertext}`)
    console.log(`[📊 LOG] Auth Tag (GCM):       ${encryptedEnvelope.authTag}`)

    // 4. Dispatch Encrypted Envelope to Hedera Consensus Layer
    console.log('\n[⚙️ PROCESS] Step 4: Dispatching Encrypted Envelope to Recipient HCS Inbound Topic...')
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(inboxTopicId)
      .setMessage(JSON.stringify(encryptedEnvelope))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    console.log(`\n[✅ SUCCESS] Encrypted Message Anchored on HCS! Status: ${submitReceipt.status.toString()}`)
    console.log(`[📊 LOG] Consensus Sequence: #${submitReceipt.topicSequenceNumber.toString()}`)
    console.log(`[📊 LOG] Transaction ID:     ${submitTx.transactionId.toString()}`)
    console.log(`[🔗 EXPLORER] View on HashScan: ${getHashscanUrl(submitTx)}`)

    // 5. Recipient Ingestion, Cryptographic Authentication, and Decryption
    console.log('\n[⚙️ PROCESS] Step 5: Recipient Consuming Envelope & Authenticating GCM Decryption...')
    const decryptedPlaintext = recipientMailbox.decryptEnvelope(encryptedEnvelope)
    const parsedPayload = JSON.parse(decryptedPlaintext)

    console.log('[✅ SUCCESS] Cryptographic Integrity Authenticated & Plaintext Recovered:')
    console.log(`   Order ID:        ${parsedPayload.orderId}`)
    console.log(`   Strategy:        ${parsedPayload.strategy}`)
    console.log(`   Max Borrow:      ${parsedPayload.maxBorrowTinybars / 1e8} ℏ`)
    console.log(`   Authorized:      ${parsedPayload.authorizedAgent}`)

    updateState('HIP1334_INBOX_TOPIC_ID', inboxTopicId.toString())
    updateState('HIP1334_LAST_CIPHERTEXT', encryptedEnvelope.ciphertext)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Zero-Server Confidentiality: HIP-1334 decouples confidential communications')
    console.log('from centralized cloud intermediaries. By anchoring end-to-end encrypted envelopes')
    console.log('on HCS, participants get irrevocable proof-of-delivery without compromising privacy.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Authenticated Encryption (AES-GCM): The 16-byte authentication tag guarantees that')
    console.log('if an attacker attempts to tamper with even a single bit of the ciphertext in transit,')
    console.log('the recipient will mathematically reject the payload with an authentication failure.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] HIP-1334 Mailbox Execution Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
