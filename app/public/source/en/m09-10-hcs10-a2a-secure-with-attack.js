/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 10: Secure A2A Communication with Active Attack
 * [ CONCEPT ] Resiliency under Adversarial Conditions
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Hardened Network: In Lab 08, the adversary successfully hijacked the
 * conversation. In this lab, we re-run the attack but with the "Zero Trust"
 * security layer active. You will observe Agent B’s Intrusion Detection
 * System (IDS) in action, mathematically identifying and rejecting Agent C’s
 * forgeries and replay attempts in real-time, while maintaining a smooth,
 * authenticated session with Agent A.
 * *
 * [ LEARNABLE MOMENT ]
 * Active cryptographic defense in HCS-10 intercepts replay and forged messages in real time, proving that cryptographic provenance neutralizes man-in-the-middle attacks on public ledgers.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hashgraphonline.com/standards/hcs-10/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 09: HCS-10 A2A Secure
 * - Next:     M9 Lab 11: HCS-10 A2A Encrypted
 *
 * [ HOW TO RUN ]
 * node 10_hcs10_a2a_secure_with_attack.js
 * ============================================================================
 */

import { Client, PrivateKey, TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import dotenv from 'dotenv'
import { getState, sleep } from '../M99_Utilities/index.js'

dotenv.config()

const main = async () => {
  console.log('--- SESSION START: Hardened Security Audit vs Adversary ---\n')

  // --- CONFIGURATION ---
  const agentA_Id = getState('HCS11_AGENT_A_ID')
  const agentA_Key = getState('HCS11_AGENT_A_KEY')
  const agentB_Id = getState('HCS11_AGENT_B_ID')
  const agentB_Key = getState('HCS11_AGENT_B_KEY')
  const agentC_Id = getState('HCS11_AGENT_C_ID')
  const agentC_Key = getState('HCS11_AGENT_C_KEY')

  const inbox = getState('HCS11_AGENT_B_INBOUND')
  const outbox = getState('HCS11_AGENT_B_OUTBOUND')

  const sessionPrivStr = getState('HCS10_SESSION_PRIVATE_KEY')
  if (!sessionPrivStr) {
    console.error('[❌ FAILED] Missing HCS10_SESSION_PRIVATE_KEY in state.')
    return
  }
  const sessionPriv = PrivateKey.fromStringECDSA(sessionPrivStr)
  const sessionPub = sessionPriv.publicKey

  // --- AGENT B: THE SECURE SERVICE ---
  const startAgentB = async () => {
    const client = Client.forTestnet().setOperator(agentB_Id, agentB_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentB_Id, operatorPrivateKey: agentB_Key })

    let lastProcessedRound = 0
    console.log(`🛡️  [ℹ️ INFO] Agent B IDS active: Listening on ${inbox}`)

    new TopicMessageQuery()
      .setTopicId(inbox)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          const envelope = JSON.parse(content)
          const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

          if (data?.verified_payload) {
            console.log('\n--- 🛡️  [ℹ️ INFO] INTRUSION DETECTION SYSTEM (IDS) TRACE ---')
            const payload = JSON.parse(data.verified_payload)

            // STAGE 1: CRYPTOGRAPHIC INTEGRITY
            const isAuthentic = sessionPub.verify(
              Buffer.from(data.verified_payload, 'utf8'),
              Buffer.from(data.session_proof, 'hex')
            )

            if (!isAuthentic) {
              console.log('[✅ SUCCESS] Signature: ❌ INVALID')
              console.log('[ℹ️ INFO] FORGERY DETECTED. Packet from adversarial actor dropped.')
              return
            }
            console.log('[✅ SUCCESS] Signature: ✅ VERIFIED')

            // STAGE 2: SEQUENCE/NONCE FRESHNESS
            if (payload.round <= lastProcessedRound) {
              console.log(`[✅ SUCCESS] Sequence: ❌ STALE (Round ${payload.round} <= ${lastProcessedRound})`)
              console.log('[ℹ️ INFO] REPLAY ATTACK REJECTED. Packet dropped.')
              return
            }
            console.log(`[✅ SUCCESS] Sequence: ✅ FRESH (Round ${payload.round})`)

            // EXECUTION
            console.log(`[📊 LOG] Result: Trusted Packet. Responding to "${payload.text}"...`)
            lastProcessedRound = payload.round

            await sleep(5000)
            await hcs10.sendMessage(outbox, { text: `World ${payload.round}!`, target: agentA_Id })
          }
        } catch (e) { }
      })
  }

  // --- AGENT A: THE SECURE INITIATOR ---
  const startAgentA = async () => {
    const client = Client.forTestnet().setOperator(agentA_Id, agentA_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentA_Id, operatorPrivateKey: agentA_Key })

    let currentRound = 1
    console.log(`🤖 [ℹ️ INFO] Agent A Monitoring Outbox [${outbox}]`)

    const sendPing = async (round) => {
      console.log('\n--- 🤖 [⚙️ PROCESS] AGENT A: DISPATCHING SECURE COMMAND ---')
      const payloadObj = { text: `Hello ${round}`, round, ts: Date.now() }
      const payloadString = JSON.stringify(payloadObj)
      const sig = sessionPriv.sign(Buffer.from(payloadString, 'utf8'))

      await hcs10.sendMessage(inbox, {
        operator_id: agentA_Id,
        verified_payload: payloadString,
        session_proof: Buffer.from(sig).toString('hex')
      })
      console.log(`[✅ SUCCESS] Secure message published for Round ${round}.`)
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
            console.log('\n🏁 [✅ SUCCESS] Sequence complete. All security parameters maintained.')
            console.log('\n💡 KEY CONCEPT:')
            console.log('The Hardened Network: In this lab, we successfully defeated the attack.')
            console.log('By layering cryptographic session validation, we protected the conversation')
            console.log('from malicious actors, even on a public, permissionless ledger topic.')
            console.log('\n--- SESSION COMPLETE ---\n')
            process.exit(0)
          }
        }
      })

    await sendPing(currentRound)
  }

  // --- AGENT C: THE ADVERSARY ---
  const startAgentC = async () => {
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentC_Id, operatorPrivateKey: agentC_Key })

    for (let i = 0; i < 4; i++) {
      await sleep(Math.floor(Math.random() * 8000) + 7000)
      const isForgery = Math.random() > 0.5

      if (isForgery) {
        console.log('\n--- 😈 [⚙️ PROCESS] ADVERSARY: ATTEMPTING FORGERY ---')
        await hcs10.sendMessage(inbox, {
          operator_id: agentA_Id,
          verified_payload: JSON.stringify({ text: 'Malicious Command', round: 99 }),
          session_proof: 'c0de'.repeat(32)
        })
      } else {
        console.log('\n--- 😈 [⚙️ PROCESS] ADVERSARY: ATTEMPTING REPLAY ATTACK ---')
        const replay = JSON.stringify({ text: 'Hello 1', round: 1, ts: 1713723000 })
        const sig = sessionPriv.sign(Buffer.from(replay, 'utf8'))
        await hcs10.sendMessage(inbox, { verified_payload: replay, session_proof: Buffer.from(sig).toString('hex') })
      }
    }
  }

  startAgentB()
  setTimeout(startAgentA, 2000)
  setTimeout(startAgentC, 8000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch(err => {
    console.error('[❌ FAILED] Hardened Session Error:', err)
    process.exit(1)
  })
}
