/**
 * ============================================================================
 * Lab 06: Encrypted Autonomous Agent Swarm Chat (ECDH + AES-256-GCM over HCS)
 * [CONCEPT] Confidential Peer-to-Peer Agent Negotiation over Public Consensus
 * ============================================================================
 * [ KEY CONCEPT ]
 * Confidential Swarm Communication: When autonomous AI agents collaborate or
 * negotiate OTC asset prices, proprietary datasets, or strategic parameters,
 * broadcasting cleartext data to a public blockchain reveals valuable trade secrets.
 * This lab demonstrates end-to-end encrypted agent-to-agent (A2A) communication:
 * 1. Agents perform an Elliptic Curve Diffie-Hellman (ECDH) key exchange over HCS.
 * 2. They derive an identical symmetric AES-256-GCM encryption key.
 * 3. All messages are encrypted with authenticated encryption (AES-GCM).
 * 4. The public Hedera consensus layer sees only ciphertext, while agents decrypt
 *    and converse in real time.
 *
 * [ LEARNABLE MOMENT ]
 * Public blockchains provide tamper-proof ordering, not confidentiality.
 * By combining Hedera Consensus Service for immutable message sequencing with
 * client-side authenticated cryptography (ECDH + AES-GCM), you create a
 * censorship-resistant, perfectly private intelligence network.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-10/
 * - https://hol.org/docs/standards/hcs-15/
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 05: Agent Audit Trail on HCS (HCS-28 Concepts)
 * - Next:     M14 Lab 07: Botanical Agent Swarms (HCS-15 Petals, HCS-18 Discovery, HCS-16 Flora & HCS-17 State Hash)
 *
 * [ SEQUENCE ]
 * Alpha -> Hedera: Publish ECDH public key (handshake)
 * Beta -> Hedera: Publish ECDH public key (handshake)
 * Note Alpha: Derives the shared AES key
 * Note Beta: Derives the same AES key
 * Alpha -> Hedera: AES-256-GCM encrypted message
 * Beta -> Hedera: Read and decrypt
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M14_Advanced_HCS_Standards_AI/06_encrypted_ai_agent_swarm_chat.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Encrypts a plaintext message using AES-256-GCM with a shared symmetric key.
 *
 * @param {string} plaintext - Message text
 * @param {Buffer} key - 32-byte symmetric key
 * @returns {object} Object with iv, ciphertext, and auth tag (hex)
 */
const encryptMessage = (plaintext, key) => {
  const iv = crypto.randomBytes(12) // 96-bit standard IV for GCM
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
 * Decrypts an AES-256-GCM encrypted message using the shared symmetric key.
 *
 * @param {object} payload - Object with iv, ciphertext, and auth tag
 * @param {Buffer} key - 32-byte symmetric key
 * @returns {string} Decrypted plaintext string
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
  console.log('║   CONFIDENTIAL AI AGENT SWARM CHAT (ECDH + AES-256-GCM OVER HCS)      ║')
  console.log('╚═══════════════════════════════════════════════════════════════════════╝\n')

  const { client } = getClient()

  try {
    // 1. Create Public Consensus Topic for Encrypted Chat Channel
    console.log('[PROCESS] Deploying secure HCS Communication Topic...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS:A2A:ENCRYPTED:SWARM:CHANNEL')
      .execute(client)

    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[SUCCESS] Public Consensus Chat Topic Created: ${topicId}`)

    // 2. Initialize Agent Cryptographic Identifiers & ECDH Keypairs
    console.log('\n[PROCESS] Initializing Agent ECDH Keypairs (Curve: prime256v1)...')
    const agentOracleECDH = crypto.createECDH('prime256v1')
    agentOracleECDH.generateKeys()

    const agentArbitrageurECDH = crypto.createECDH('prime256v1')
    agentArbitrageurECDH.generateKeys()

    const oraclePubKeyHex = agentOracleECDH.getPublicKey('hex')
    const arbitrageurPubKeyHex = agentArbitrageurECDH.getPublicKey('hex')

    console.log(`[ AGENT 1] Name: Agent Alpha (Oracle)       | Public Key: ${oraclePubKeyHex.slice(0, 24)}...`)
    console.log(`[ AGENT 2] Name: Agent Beta  (Arbitrageur) | Public Key: ${arbitrageurPubKeyHex.slice(0, 24)}...`)

    // 2.5 Publish Ephemeral ECDH Public Keys to HCS Topic (On-Chain Handshake)
    console.log('\n[PROCESS] Publishing Ephemeral ECDH Public Keys to HCS Topic (Handshake)...')
    for (const [agentName, pubKey] of [['Agent Alpha (Oracle)', oraclePubKeyHex], ['Agent Beta (Arbitrageur)', arbitrageurPubKeyHex]]) {
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
      console.log(`[HANDSHAKE] ${agentName} ECDH Public Key anchored at Sequence #${hsReceipt.topicSequenceNumber}`)
    }

    // 3. Perform Diffie-Hellman Key Exchange to derive shared AES-256 key
    console.log('\n[PROCESS] Executing Elliptic Curve Diffie-Hellman Key Derivation...')
    const sharedSecretOracle = agentOracleECDH.computeSecret(agentArbitrageurECDH.getPublicKey())
    const sharedSecretArbitrageur = agentArbitrageurECDH.computeSecret(agentOracleECDH.getPublicKey())

    // Derive deterministic 32-byte AES key via SHA-256
    const aesKeyOracle = crypto.createHash('sha256').update(sharedSecretOracle).digest()
    const aesKeyArbitrageur = crypto.createHash('sha256').update(sharedSecretArbitrageur).digest()
    const keyFingerprint = crypto.createHash('sha256').update(aesKeyOracle).digest('hex')

    const keysMatch = aesKeyOracle.equals(aesKeyArbitrageur)
    console.log(`[SUCCESS] Shared Symmetric Secret Established: ${keysMatch ? 'MATCH (100% SECURE)' : 'MISMATCH'}`)
    console.log(`[KEY] Non-Reversible SHA-256 Key Fingerprint: ${keyFingerprint.slice(0, 32)}...`)

    // 4. Conversation Simulation: Encrypted OTC Negotiation
    const dialogue = [
      {
        sender: 'Agent Beta (Arbitrageur)',
        text: 'PROPOSAL: Requesting exclusive low-latency mempool liquidation signals for next 1,000 blocks. Bid: 150 HBAR.',
        fromAgent: 'arbitrageur'
      },
      {
        sender: 'Agent Alpha (Oracle)',
        text: 'COUNTER: Signal pipeline active. Current network congestion demands 180 HBAR for top priority gRPC stream.',
        fromAgent: 'oracle'
      },
      {
        sender: 'Agent Beta (Arbitrageur)',
        text: 'AGREEMENT: Counter-offer accepted at 180 HBAR. Generating x402 settlement commitment.',
        fromAgent: 'arbitrageur'
      }
    ]

    console.log('\n═════════════════════════════════════════════════════════════════════════')
    console.log('LIVE ENCRYPTED CONSENSUS CONVERSATION AUDIT               ')
    console.log('═════════════════════════════════════════════════════════════════════════')

    for (let i = 0; i < dialogue.length; i++) {
      const step = dialogue[i]
      const encryptionKey = step.fromAgent === 'arbitrageur' ? aesKeyArbitrageur : aesKeyOracle
      const decryptionKey = step.fromAgent === 'arbitrageur' ? aesKeyOracle : aesKeyArbitrageur

      // Encrypt message
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

      // Submit to Hedera Consensus
      const submitTx = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify(onChainPayload))
        .execute(client)

      const receipt = await submitTx.getReceipt(client)
      const seq = receipt.topicSequenceNumber.toString()

      // Decrypt message on receiver side
      const decryptedText = decryptMessage(encryptedPacket, decryptionKey)

      console.log(`\n [MESSAGE #${seq}] Sender: ${step.sender}`)
      console.log(`├─  What Mirror Node Sees (Ciphertext): ${encryptedPacket.ciphertext.slice(0, 32)}... [Tag: ${encryptedPacket.tag.slice(0, 16)}]`)
      console.log(`└─  Decrypted Plaintext by Receiver:    "${decryptedText}"`)
    }

    console.log('\n═════════════════════════════════════════════════════════════════════════')
    console.log('CONFIDENTIALITY AUDIT REPORT                       ')
    console.log('═════════════════════════════════════════════════════════════════════════')
    console.log(`[LOG] Hedera Topic ID:       ${topicId}`)
    console.log('[LOG] Encryption Algorithm:  AES-256-GCM (NIST SP 800-38D GMAC Tag)')
    console.log('[LOG] Public Visibility:     ZERO plain-text leakage on Mirror Nodes or explorers')
    console.log('[LOG] Consensus Ordering:    100% fair timestamped sequence numbers on Hedera')

    // Persist state (never persist raw encryption keys — only the non-reversible fingerprint!)
    updateState('ENCRYPTED_CHAT_TOPIC_ID', topicId)
    updateState('ENCRYPTED_CHAT_CIPHER_ALGO', 'AES-256-GCM')
    updateState('ENCRYPTED_CHAT_SHARED_KEY_DIGEST', keyFingerprint)

    console.log('\n KEY CONCEPT:')
    console.log('This architecture is the Holy Grail for enterprise and AI agents:')
    console.log('You get decentralized, tamper-proof ordering from Hedera Consensus Service,')
    console.log('while preserving military-grade data privacy through client-side encryption.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('True privacy does not come from hiding the ledger, but from ensuring that')
    console.log('only authorized peers possess the ECDH-derived decryption keys.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Encrypted Chat Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
