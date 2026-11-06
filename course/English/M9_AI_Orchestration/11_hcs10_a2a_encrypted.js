/**
 * ============================================================================
 * Lab 11: Encrypted A2A Communication (HCS-10)
 * [CONCEPT] Hybrid Encryption & Privacy over Public Ledger
 * ============================================================================
 * [ KEY CONCEPT ]
 * Layered Defense: Encryption provides Confidentiality, but it does NOT
 * provide Authenticity on its own if public keys are known. In this lab,
 * we layer Hybrid Encryption (RSA + AES-256-GCM) on top of the "Zero Trust"
 * ECDSA session validation. Even if an adversary knows your public key
 * and sends an encrypted message, the IDS will decrypt it and immediately
 * reject it for failing the session signature or sequence nonce checks.
 * This is the gold standard for secure Agentic communication on Hedera.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Consensus provides fair ordering, but client-side hybrid encryption (ECDH + AES-256-GCM) ensures military-grade confidentiality: third parties on the public ledger see only undecipherable ciphertext.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 10: Secure A2A Communication with Active Attack
 * - Next:     M10 Lab 01: Server HTTP 402 Challenge Generation
 *
 * [ SEQUENCE ]
 * Agent A -> Agent B Inbox: Request encrypted with Agent B RSA public key
 * Note Agent B: Only Agent B private key can decrypt it
 * Agent B -> Agent A Inbox: Reply encrypted with Agent A public key
 * Note HCS: Everyone sees the ciphertext, nobody else reads it
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M9 Lab 04 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M9_AI_Orchestration/11_hcs10_a2a_encrypted.js
 * ============================================================================
 */

import { HCS10Client } from '@hashgraphonline/standards-sdk'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { AgentCommunicationHandler, getState, sleep, exitIfStuck, loadEnv } from '../M99_Utilities/index.js'

loadEnv() // reads course/.env (and the repository root .env)

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'subscription messages')
  console.log('--- SESSION START: Full-Duplex RSA Encrypted Streams ---\n')

  // --- CONFIGURATION ---
  const agentAId = getState('HCS11_AGENT_A_ID')
  const agentAKey = getState('HCS11_AGENT_A_KEY')
  const agentAInbox = getState('HCS11_AGENT_A_INBOUND')

  const agentBId = getState('HCS11_AGENT_B_ID')
  const agentBKey = getState('HCS11_AGENT_B_KEY')
  const agentBInbox = getState('HCS11_AGENT_B_INBOUND')

  if (!agentAId || !agentBId || !agentAInbox || !agentBInbox) {
    console.error('[FAILED] Missing Agent data or Inbox Topics in configuration.')
    process.exitCode = 1
    return
  }

  // --- RSA KEY MANAGEMENT ---
  const generateOrLoadKeys = (agentAlias) => {
    const keysDir = path.join(import.meta.dirname, 'privateKeys')
    if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true })

    const privateKeyPath = path.join(keysDir, `${agentAlias}_private.pem`)
    const publicKeyPath = path.join(keysDir, `${agentAlias}_public.pem`)

    if (fs.existsSync(privateKeyPath)) {
      return { privateKey: fs.readFileSync(privateKeyPath, 'utf8'), publicKey: fs.readFileSync(publicKeyPath, 'utf8') }
    }
    console.log(`[PROCESS] Generating RSA Keypair for ${agentAlias}...`)
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
    fs.writeFileSync(privateKeyPath, privateKey); fs.writeFileSync(publicKeyPath, publicKey)
    return { privateKey, publicKey }
  }

  const keysA = generateOrLoadKeys('agentA')
  const keysB = generateOrLoadKeys('agentB')

  // --- AGENT B: LISTENS [B_INBOX], SENDS [A_INBOX] ---
  const startAgentB = async () => {
    const clientBListener = new HCS10Client({ network: 'testnet', operatorId: agentBId, operatorPrivateKey: agentBKey })
    const clientBSpeaker = new HCS10Client({ network: 'testnet', operatorId: agentBId, operatorPrivateKey: agentBKey })

    const pubKeys = { [agentAId]: keysA.publicKey }

    const handlerBListen = new AgentCommunicationHandler(clientBListener, agentBInbox, agentBId, keysB.privateKey, pubKeys, [agentAId])
    const handlerBSpeak = new AgentCommunicationHandler(clientBSpeaker, agentAInbox, agentBId, keysB.privateKey, pubKeys, [])

    handlerBListen.on('messageReceived', async ({ senderId, message }) => {
      if (message?.text) {
        console.log('\n---  [LOG] AGENT B: DECRYPTED INBOUND ---')
        console.log(`[SUCCESS] Decrypted message: "${message.text}"`)

        await sleep(3000)

        const replyPayload = { text: `World ${message.round}!` }
        console.log('[PROCESS] Routing RSA-encrypted reply to Agent A\'s Inbox...')
        await handlerBSpeak.sendMessage(replyPayload, agentAId)
      }
    })

    console.log(`[INFO] Agent B Live: Monitoring lane ${agentBInbox}`)
    handlerBListen.monitorConnectionMessages()
  }

  // --- AGENT A: LISTENS [A_INBOX], SENDS [B_INBOX] ---
  const startAgentA = async () => {
    const clientAListener = new HCS10Client({ network: 'testnet', operatorId: agentAId, operatorPrivateKey: agentAKey })
    const clientASpeaker = new HCS10Client({ network: 'testnet', operatorId: agentAId, operatorPrivateKey: agentAKey })

    const pubKeys = { [agentBId]: keysB.publicKey }
    let currentRound = 1

    const handlerAListen = new AgentCommunicationHandler(clientAListener, agentAInbox, agentAId, keysA.privateKey, pubKeys, [agentBId])
    const handlerASpeak = new AgentCommunicationHandler(clientASpeaker, agentBInbox, agentAId, keysA.privateKey, pubKeys, [])

    const sendPing = async (round) => {
      console.log('\n---  [PROCESS] AGENT A: OUTBOUND DISPATCH ---')
      console.log('[PROCESS] Routing RSA-encrypted request to Agent B\'s Inbox...')
      await handlerASpeak.sendMessage({ text: `Hello ${round}`, round }, agentBId)
    }

    handlerAListen.on('messageReceived', async ({ senderId, message }) => {
      if (message?.text?.includes(`World ${currentRound}`)) {
        console.log('\n---  [LOG] AGENT A: DECRYPTED INBOUND ---')
        console.log(`[SUCCESS] Valid response received: "${message.text}"`)

        if (currentRound < 3) {
          currentRound++
          await sleep(4000)
          await sendPing(currentRound)
        } else {
          console.log('\n [SUCCESS] Full-Duplex Encrypted Orchestration Complete.')
          console.log('\n KEY CONCEPT:')
          console.log('Layered Defense: Encryption provides Confidentiality, but it does')
          console.log('NOT provide Authenticity on its own. In this lab, we layered Hybrid')
          console.log('Encryption on top of ECDSA session validation to create the gold')
          console.log('standard for secure Agentic communication on Hedera.')
          console.log('\n--- SESSION COMPLETE ---\n')
          process.exit()
        }
      }
    })

    console.log(`[INFO] Agent A Live: Monitoring lane ${agentAInbox}`)
    handlerAListen.monitorConnectionMessages()

    await sleep(2000)
    await sendPing(currentRound)
  }

  startAgentB()
  setTimeout(startAgentA, 3000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
