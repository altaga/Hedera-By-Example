/**
 * ============================================================================
 * Lab 11: Encrypted A2A Communication (HCS-10)
 * [CONCEPT] Hybrid Encryption & Privacy over Public Ledger
 * ============================================================================
 * [ KEY CONCEPT ]
 * Privacy by Design: Agent conversations on HCS are public and auditable, but
 * sensitive data must stay private. Here each agent has its own inbox and an
 * RSA-2048 key pair, and every message uses hybrid encryption: a fresh
 * AES-256-GCM key encrypts the content, and the recipient's RSA public key
 * encrypts that AES key. Anyone can read the topic, but only the recipient
 * can decrypt what was sent to it.
 *
 * Encryption gives confidentiality, not authenticity: anyone who knows a
 * public key can send an encrypted message. A production agent combines it
 * with the signature and sequence checks of Labs 09 and 10.
 *
 * [ LEARNABLE MOMENT ]
 * Consensus orders the messages fairly, but only client-side hybrid encryption (RSA-2048 + AES-256-GCM) keeps them confidential: everyone else on the public ledger sees ciphertext.
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
      return {
        privateKey: fs.readFileSync(privateKeyPath, 'utf8'),
        publicKey: fs.readFileSync(publicKeyPath, 'utf8')
      }
    }
    console.log(`[PROCESS] Generating RSA Keypair for ${agentAlias}...`)
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

  // The conversation ends after round 3: stop both listeners and let main() return.
  const listeners = []
  let finishSession
  const finished = new Promise((resolve) => { finishSession = resolve })

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

        const replyPayload = { text: `World ${message.round}!`, round: message.round }
        console.log('[PROCESS] Routing RSA-encrypted reply to Agent A\'s Inbox...')
        await handlerBSpeak.sendMessage(replyPayload, agentAId)
      }
    })

    console.log(`[INFO] Agent B Live: Monitoring lane ${agentBInbox}`)
    handlerBListen.on('error', (error) => console.error(`[FAILED] Agent B could not read a message: ${error.message}`))
    listeners.push(handlerBListen)
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
      if (message?.round === currentRound) {
        console.log('\n---  [LOG] AGENT A: DECRYPTED INBOUND ---')
        console.log(`[SUCCESS] Valid response received: "${message.text}"`)

        if (currentRound < 3) {
          currentRound++
          await sleep(4000)
          await sendPing(currentRound)
        } else {
          console.log('\n [SUCCESS] Full-Duplex Encrypted Orchestration Complete.')
          console.log('\n KEY CONCEPT:')
          console.log('Privacy by Design: every message crossed a public topic, yet only its')
          console.log('recipient could decrypt it. Encryption gives confidentiality, not')
          console.log('authenticity: pair it with the signature checks of Labs 09 and 10.')
          console.log('\n--- SESSION COMPLETE ---\n')
          listeners.forEach((handler) => handler.stop())
          finishSession()
        }
      }
    })

    console.log(`[INFO] Agent A Live: Monitoring lane ${agentAInbox}`)
    handlerAListen.on('error', (error) => console.error(`[FAILED] Agent A could not read a message: ${error.message}`))
    listeners.push(handlerAListen)
    handlerAListen.monitorConnectionMessages()

    await sleep(2000)
    await sendPing(currentRound)
  }

  startAgentB()
  await sleep(3000)
  await startAgentA()
  await finished
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
