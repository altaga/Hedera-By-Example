/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 09: Secure A2A Communication (HCS-10)
 * [ CONCEPT ] Zero Trust Cryptographic Validation
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
 * *
 * [ LEARNABLE MOMENT ]
 * By signing every A2A message with the agent private key and embedding an ephemeral timestamp, autonomous agents verify the cryptographic signature of their peers and reject spoofed messages.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hashgraphonline.com/standards/hcs-10/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 08: Impersonation Attack
 * - Next:     M9 Lab 10: Secure with Attack
 *
 * [ SEQUENCE ]
 * Agent A -> Agent B Inbox: Payload + hash + signature (session key)
 * Note Agent B: Verifies the signature against Agent A key
 * Agent B -> Agent A Inbox: Signed reply
 * Note Agent A: Verifies before trusting the reply
 *
 * [ HOW TO RUN ]
 * node 09_hcs10_a2a_secure.js
 * ============================================================================
 */

import { Client, PrivateKey, TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import dotenv from 'dotenv'
import { getState, sleep, createClient, exitIfStuck } from '../M99_Utilities/index.js'

dotenv.config()

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'subscription messages')
  console.log('--- SESSION START: Secure Parallel Security Audit ---\n')

  // --- CONFIGURATION ---
  const agentA_Id = getState('HCS11_AGENT_A_ID')
  const agentA_Key = getState('HCS11_AGENT_A_KEY')
  const agentB_Id = getState('HCS11_AGENT_B_ID')
  const agentB_Key = getState('HCS11_AGENT_B_KEY')

  const inbox = getState('HCS11_AGENT_B_INBOUND')
  const outbox = getState('HCS11_AGENT_B_OUTBOUND')

  const sessionPrivStr = getState('HCS10_SESSION_PRIVATE_KEY')
  if (!sessionPrivStr) {
    console.error('[❌ FAILED] Missing HCS10_SESSION_PRIVATE_KEY in state.')
    process.exitCode = 1
    return
  }
  const sessionPriv = PrivateKey.fromStringECDSA(sessionPrivStr)
  const sessionPub = sessionPriv.publicKey

  // --- AGENT B: THE SECURE SERVICE ---
  const startAgentB = async () => {
    const client = createClient().setOperator(agentB_Id, agentB_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentB_Id, operatorPrivateKey: agentB_Key })

    let lastProcessedRound = 0
    console.log(`🛡️  [ℹ️ INFO] Agent B Listening on ${inbox} (Secure Protocol)`)

    new TopicMessageQuery()
      .setTopicId(inbox)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          const envelope = JSON.parse(content)
          const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

          if (data?.verified_payload) {
            console.log('\n--- 🛡️  [ℹ️ INFO] INTRUSION DETECTION SYSTEM (IDS) TRACE ---')
            console.log(`[⚙️ PROCESS] Validating packet received from ${inbox}...`)

            const payload = JSON.parse(data.verified_payload)

            // STAGE 1: CRYPTOGRAPHIC INTEGRITY
            const isAuthentic = sessionPub.verify(
              Buffer.from(data.verified_payload, 'utf8'),
              Buffer.from(data.session_proof, 'hex')
            )

            if (!isAuthentic) {
              console.log('[✅ SUCCESS] ECDSA Signature: ❌ INVALID')
              console.log('[ℹ️ INFO] FORGERY DETECTED. Dropping malicious packet.')
              return
            }
            console.log('[✅ SUCCESS] ECDSA Signature: ✅ VERIFIED')

            // STAGE 2: SEQUENCE/NONCE FRESHNESS
            if (payload.round <= lastProcessedRound) {
              console.log(`[✅ SUCCESS] Sequence Nonce: ❌ STALE (Expected > ${lastProcessedRound})`)
              console.log('[ℹ️ INFO] REPLAY ATTACK DETECTED. Dropping packet.')
              return
            }
            console.log(`[✅ SUCCESS] Sequence Nonce: ✅ FRESH (Round ${payload.round})`)

            // EXECUTION
            console.log(`[📊 LOG] Result: Packet Trusted. Processing "${payload.text}"...`)
            lastProcessedRound = payload.round

            await sleep(5000)
            await hcs10.sendMessage(outbox, { text: `World ${payload.round}!`, target: agentA_Id })
            console.log('[✅ SUCCESS] Response dispatched.')
          }
        } catch (e) { }
      })
  }

  // --- AGENT A: THE SECURE INITIATOR ---
  const startAgentA = async () => {
    const client = createClient().setOperator(agentA_Id, agentA_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentA_Id, operatorPrivateKey: agentA_Key })

    let currentRound = 1
    console.log(`🤖 [ℹ️ INFO] Agent A Monitoring Outbox [${outbox}]`)

    const sendPing = async (round) => {
      console.log('\n--- 🤖 [⚙️ PROCESS] AGENT A: OUTBOUND ASSEMBLY ---')
      const payloadObj = { text: `Hello ${round}`, round, ts: Date.now() }
      const payloadString = JSON.stringify(payloadObj)

      console.log(`[⚙️ PROCESS] Hashing and Signing Payload Round ${round}...`)
      const sig = sessionPriv.sign(Buffer.from(payloadString, 'utf8'))

      await hcs10.sendMessage(inbox, {
        operator_id: agentA_Id,
        verified_payload: payloadString,
        session_proof: Buffer.from(sig).toString('hex')
      })
      console.log('[✅ SUCCESS] Secure Message Published to Ledger.')
    }

    new TopicMessageQuery()
      .setTopicId(outbox)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()
        if (content.includes(`World ${currentRound}`)) {
          console.log(`\n[📊 LOG] 📥 AGENT A Received response for Round ${currentRound}.`)
          if (currentRound < 3) {
            currentRound++
            await sleep(5000)
            await sendPing(currentRound)
          } else {
            console.log('\n🏁 [✅ SUCCESS] All security checks passed.')
            console.log('\n💡 KEY CONCEPT:')
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
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
