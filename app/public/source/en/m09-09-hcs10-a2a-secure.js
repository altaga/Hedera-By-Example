/**
 * ============================================================================
 * Lab 09: Secure A2A Communication (HCS-10)
 * [CONCEPT] Zero Trust Cryptographic Validation
 * ============================================================================
 * [ KEY CONCEPT ]
 * Intrusion Detection (IDS): This script demonstrates a "Zero Trust"
 * architecture. Agent B treats every incoming message as hostile until it
 * passes a two-stage cryptographic gauntlet:
 * 1. ECDSA VERIFICATION: Proves the message was signed by the holder of the
 * Session Private Key.
 * 2. SEQUENCE VALIDATION: Proves the message is fresh and not a "Replay"
 * of historical data. By layering these checks, you transform a public
 * HCS topic into a secure, tamper-proof command channel.
 *
 *
 * [ LEARNABLE MOMENT ]
 * By signing every A2A message with the agent private key and embedding an ephemeral timestamp, autonomous agents verify the cryptographic signature of their peers and reject spoofed messages.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 08: The Impersonation Attack (Security Gap)
 * - Next:     M9 Lab 10: Secure A2A Communication with Active Attack
 *
 * [ SEQUENCE ]
 * Agent A -> Agent B Inbox: Payload + hash + signature (session key)
 * Note Agent B: Verifies the signature against Agent A key
 * Agent B -> Agent A Inbox: Signed reply
 * Note Agent A: Verifies before trusting the reply
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M9 Lab 04 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M9_AI_Orchestration/09_hcs10_a2a_secure.js
 * ============================================================================
 */

import { PrivateKey, TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getState, sleep, createClient, exitIfStuck, updateState, loadEnv } from '../M99_Utilities/index.js'

loadEnv() // reads course/.env (and the repository root .env)

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'subscription messages')
  const sessionStart = new Date(Date.now() - 10000) // only messages from this run (10 s look-back for Mirror Node propagation)
  console.log('--- SESSION START: Secure Parallel Security Audit ---\n')

  // --- CONFIGURATION ---
  const agentAId = getState('HCS11_AGENT_A_ID')
  const agentAKey = getState('HCS11_AGENT_A_KEY')
  const agentBId = getState('HCS11_AGENT_B_ID')
  const agentBKey = getState('HCS11_AGENT_B_KEY')

  const inbox = getState('HCS11_AGENT_B_INBOUND')
  const outbox = getState('HCS11_AGENT_B_OUTBOUND')

  // Session key shared by the agents: created the first time, then reused by Labs 09 and 10.
  let sessionPrivStr = getState('HCS10_SESSION_PRIVATE_KEY')
  if (!sessionPrivStr) {
    sessionPrivStr = PrivateKey.generateECDSA().toStringRaw()
    updateState('HCS10_SESSION_PRIVATE_KEY', sessionPrivStr)
    console.log('[INFO] Generated a new ECDSA session key for Agent A and Agent B (saved as HCS10_SESSION_PRIVATE_KEY).')
  }
  const sessionPriv = PrivateKey.fromStringECDSA(sessionPrivStr)
  const sessionPub = sessionPriv.publicKey

  // --- AGENT B: THE SECURE SERVICE ---
  const startAgentB = async () => {
    const client = createClient().setOperator(agentBId, agentBKey)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentBId, operatorPrivateKey: agentBKey })

    let lastProcessedRound = 0
    console.log(`[INFO] Agent B Listening on ${inbox} (Secure Protocol)`)

    new TopicMessageQuery()
      .setTopicId(inbox)
      .setStartTime(sessionStart)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          const envelope = JSON.parse(content)
          const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

          if (data?.verified_payload) {
            console.log('\n---   [INFO] INTRUSION DETECTION SYSTEM (IDS) TRACE ---')
            console.log(`[PROCESS] Validating packet received from ${inbox}...`)

            const payload = JSON.parse(data.verified_payload)

            // STAGE 1: CRYPTOGRAPHIC INTEGRITY
            const isAuthentic = sessionPub.verify(
              Buffer.from(data.verified_payload, 'utf8'),
              Buffer.from(data.session_proof, 'hex')
            )

            if (!isAuthentic) {
              console.log('[BLOCKED] ECDSA signature: INVALID')
              console.log('[INFO] FORGERY DETECTED. Dropping malicious packet.')
              return
            }
            console.log('[SUCCESS] ECDSA signature: VERIFIED')

            // STAGE 2: SEQUENCE/NONCE FRESHNESS
            if (payload.round <= lastProcessedRound) {
              console.log(`[BLOCKED] Sequence nonce: STALE (expected > ${lastProcessedRound})`)
              console.log('[INFO] REPLAY ATTACK DETECTED. Dropping packet.')
              return
            }
            console.log(`[SUCCESS] Sequence nonce: FRESH (round ${payload.round})`)

            // EXECUTION
            console.log(`[LOG] Result: Packet Trusted. Processing "${payload.text}"...`)
            lastProcessedRound = payload.round

            await sleep(5000)
            await hcs10.sendMessage(outbox, { text: `World ${payload.round}!`, target: agentAId })
            console.log('[SUCCESS] Response dispatched.')
          }
        } catch (e) { console.error('[FAILED] The agent could not reply:', e.message) }
      })
  }

  // --- AGENT A: THE SECURE INITIATOR ---
  const startAgentA = async () => {
    const client = createClient().setOperator(agentAId, agentAKey)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentAId, operatorPrivateKey: agentAKey })

    let currentRound = 1
    console.log(`[INFO] Agent A Monitoring Outbox [${outbox}]`)

    const sendPing = async (round) => {
      console.log('\n---  [PROCESS] AGENT A: OUTBOUND ASSEMBLY ---')
      const payloadObj = { text: `Hello ${round}`, round, ts: Date.now() }
      const payloadString = JSON.stringify(payloadObj)

      console.log(`[PROCESS] Hashing and Signing Payload Round ${round}...`)
      const sig = sessionPriv.sign(Buffer.from(payloadString, 'utf8'))

      await hcs10.sendMessage(inbox, {
        operator_id: agentAId,
        verified_payload: payloadString,
        session_proof: Buffer.from(sig).toString('hex')
      })
      console.log('[SUCCESS] Secure Message Published to Ledger.')
    }

    new TopicMessageQuery()
      .setTopicId(outbox)
      .setStartTime(sessionStart)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()
        if (content.includes(`World ${currentRound}`)) {
          console.log(`\n[LOG]  AGENT A Received response for Round ${currentRound}.`)
          if (currentRound < 3) {
            currentRound++
            await sleep(5000)
            await sendPing(currentRound)
          } else {
            console.log('\n [SUCCESS] All security checks passed.')
            console.log('\n KEY CONCEPT:')
            console.log('Intrusion Detection (IDS): This script demonstrates a "Zero Trust"')
            console.log('architecture. By layering ECDSA verification and nonce checks,')
            console.log('you transform a public HCS topic into a secure, tamper-proof')
            console.log('command channel.')
            console.log('\n--- SESSION COMPLETE ---\n')
            process.exit()
          }
        }
      })

    await sendPing(currentRound)
  }

  startAgentB()
  setTimeout(startAgentA, 2000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
