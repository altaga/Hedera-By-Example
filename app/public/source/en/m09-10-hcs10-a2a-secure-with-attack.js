/**
 * ============================================================================
 * Lab 10: Secure A2A Communication with Active Attack
 * [CONCEPT] Resiliency under Adversarial Conditions
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Hardened Network: In Lab 08, the adversary successfully hijacked the
 * conversation. In this lab, we re-run the attack but with the "Zero Trust"
 * security layer active. You will observe Agent B’s Intrusion Detection
 * System (IDS) in action, mathematically identifying and rejecting Agent C’s
 * forgeries and replay attempts in real-time, while maintaining a smooth,
 * authenticated session with Agent A.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Active cryptographic defense in HCS-10 intercepts replay and forged messages in real time, showing that signatures plus round numbers stop forgery and replay on a public topic.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 09: Secure A2A Communication (HCS-10)
 * - Next:     M9 Lab 11: Encrypted A2A Communication (HCS-10)
 *
 * [ SEQUENCE ]
 * Agent A -> Agent B Inbox: Signed message (rounds 1 to 3)
 * Attacker -> Agent B Inbox: Forged message (bad signature)
 * Attacker -> Agent B Inbox: Copy of Agent A's round 1 message (replay)
 * Note Agent B: The signature check drops the forgery, the round check drops the replay
 * Agent B -> Agent A Inbox: Replies only to trusted, fresh messages
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M9 Lab 04 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M9_AI_Orchestration/10_hcs10_a2a_secure_with_attack.js
 * ============================================================================
 */

import { PrivateKey, TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getState, sleep, createClient, exitIfStuck, updateState, loadEnv, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

loadEnv() // reads course/.env (and the repository root .env)

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'subscription messages')
  const sessionStart = new Date(Date.now() - 10000) // only messages from this run (10 s look-back for Mirror Node propagation)
  let sessionDone = false // set when Agent A finishes, so the adversary stops too
  console.log('--- SESSION START: Hardened Security Audit vs Adversary ---\n')

  // --- CONFIGURATION ---
  const agentAId = getState('HCS11_AGENT_A_ID')
  const agentAKey = getState('HCS11_AGENT_A_KEY')
  const agentBId = getState('HCS11_AGENT_B_ID')
  const agentBKey = getState('HCS11_AGENT_B_KEY')
  const agentCId = getState('HCS11_AGENT_C_ID')
  const agentCKey = getState('HCS11_AGENT_C_KEY')

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
    console.log(`[INFO] Agent B IDS active: Listening on ${inbox}`)

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
            const payload = JSON.parse(data.verified_payload)

            // STAGE 1: CRYPTOGRAPHIC INTEGRITY
            const isAuthentic = sessionPub.verify(
              Buffer.from(data.verified_payload, 'utf8'),
              Buffer.from(data.session_proof, 'hex')
            )

            if (!isAuthentic) {
              console.log('[BLOCKED] Signature: INVALID')
              console.log('[INFO] FORGERY DETECTED. Packet from adversarial actor dropped.')
              return
            }
            console.log('[SUCCESS] Signature: VERIFIED')

            // STAGE 2: SEQUENCE/NONCE FRESHNESS
            if (payload.round <= lastProcessedRound) {
              console.log(`[BLOCKED] Sequence: STALE (round ${payload.round} <= ${lastProcessedRound})`)
              console.log('[INFO] REPLAY ATTACK REJECTED. Packet dropped.')
              return
            }
            console.log(`[SUCCESS] Sequence: FRESH (round ${payload.round})`)

            // EXECUTION
            console.log(`[LOG] Result: Trusted Packet. Responding to "${payload.text}"...`)
            lastProcessedRound = payload.round

            await sleep(5000)
            await hcs10.sendMessage(outbox, { text: `World ${payload.round}!`, target: agentAId })
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
      console.log('\n---  [PROCESS] AGENT A: DISPATCHING SECURE COMMAND ---')
      const payloadObj = { text: `Hello ${round}`, round, ts: Date.now() }
      const payloadString = JSON.stringify(payloadObj)
      const sig = sessionPriv.sign(Buffer.from(payloadString, 'utf8'))

      await hcs10.sendMessage(inbox, {
        operator_id: agentAId,
        verified_payload: payloadString,
        session_proof: Buffer.from(sig).toString('hex')
      })
      console.log(`[SUCCESS] Secure message published for Round ${round}.`)
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
            console.log('\n [SUCCESS] Sequence complete. All security parameters maintained.')
            console.log('\n KEY CONCEPT:')
            console.log('The Hardened Network: In this lab, we successfully defeated the attack.')
            console.log('By layering cryptographic session validation, we protected the conversation')
            console.log('from malicious actors, even on a public, permissionless ledger topic.')
            console.log('\n--- SESSION COMPLETE ---\n')
            sessionDone = true
            process.exit()
          }
        }
      })

    await sendPing(currentRound)
  }

  // --- AGENT C: THE ADVERSARY ---
  // Reads the public inbox on the Mirror Node and returns Agent A's signed round 1 message.
  const captureRound1 = async () => {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/topics/${inbox}/messages?order=desc&limit=50`)
    const { messages = [] } = res.ok ? await res.json() : {}
    for (const m of messages) {
      try {
        const envelope = JSON.parse(Buffer.from(m.message, 'base64').toString('utf8'))
        const data = Array.isArray(envelope) ? envelope[0].data : envelope.data
        if (data?.verified_payload && JSON.parse(data.verified_payload).round === 1) {
          return { operator_id: data.operator_id, verified_payload: data.verified_payload, session_proof: data.session_proof }
        }
      } catch (_) {}
    }
    return null
  }

  const startAgentC = async () => {
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentCId, operatorPrivateKey: agentCKey })

    for (let i = 0; i < 4; i++) {
      await sleep(Math.floor(Math.random() * 8000) + 7000)
      if (sessionDone) return
      const isForgery = i % 2 === 0 // alternate: forgery, replay, forgery, replay

      if (isForgery) {
        console.log('\n---  [PROCESS] ADVERSARY: ATTEMPTING FORGERY ---')
        await hcs10.sendMessage(inbox, {
          operator_id: agentAId,
          verified_payload: JSON.stringify({ text: 'Malicious Command', round: 99 }),
          session_proof: 'c0de'.repeat(32)
        })
      } else {
        // Replay: the adversary cannot sign, but the topic is public, so it copies
        // Agent A's genuine round 1 message (payload and signature) and sends it again.
        console.log('\n---  [PROCESS] ADVERSARY: ATTEMPTING REPLAY ATTACK ---')
        const captured = await captureRound1()
        if (!captured) { console.log('[INFO] Adversary found no round 1 message to copy yet.'); continue }
        await hcs10.sendMessage(inbox, captured)
        console.log('[INFO] Adversary re-sent the captured round 1 message, signature included.')
      }
    }
  }

  startAgentB()
  setTimeout(startAgentA, 2000)
  setTimeout(startAgentC, 8000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
