/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 08: The Impersonation Attack (Security Gap)
 * [ CONCEPT ] Vulnerability of Public Streams
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Identity Gap: In previous labs, we processed messages based purely on
 * content. Because HCS topics are public, anyone with the Topic ID can
 * publish "Spam" or "Forgeries." This lab introduces an Adversary (Agent C)
 * who attempts to hijack the conversation by spoofing the logic. You will
 * see that without cryptographic session validation, our agents are
 * defenseless against malicious actors who know the protocol format.
 * *
 * [ LEARNABLE MOMENT ]
 * Public consensus topics allow anyone to broadcast messages. Simulating an impersonation attack demonstrates why unauthenticated agent communication is vulnerable to spoofing and unauthorized commands.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 07: HCS-10 A2A Public
 * - Next:     M9 Lab 09: HCS-10 A2A Secure
 *
 * [ SEQUENCE ]
 * Agent A -> Agent B Inbox: Legitimate message
 * Attacker -> Agent B Inbox: Message claiming to be Agent A
 * Note Agent B: Without signatures it cannot tell them apart
 * Agent B -> Agent A Inbox: Replies to both
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M9 Lab 04 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 08_hcs10_impersonation_attack.js
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
  console.log('--- SESSION START: Public Stream Vulnerability Audit ---\n')

  // --- CONFIGURATION ---
  const agentA_Id = getState('HCS11_AGENT_A_ID')
  const agentA_Key = getState('HCS11_AGENT_A_KEY')
  const agentB_Id = getState('HCS11_AGENT_B_ID')
  const agentB_Key = getState('HCS11_AGENT_B_KEY')
  const agentC_Id = getState('HCS11_AGENT_C_ID')
  const agentC_Key = getState('HCS11_AGENT_C_KEY')

  const inbox = getState('HCS11_AGENT_B_INBOUND')
  const outbox = getState('HCS11_AGENT_B_OUTBOUND')

  if (!agentA_Id || !agentB_Id || !agentC_Id) {
    console.error('[❌ FAILED] Missing Agent IDs in configuration.')
    process.exitCode = 1
    return
  }

  // --- AGENT B: THE VULNERABLE SERVICE ---
  const startAgentB = async () => {
    const client = createClient().setOperator(agentB_Id, agentB_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentB_Id, operatorPrivateKey: agentB_Key })

    console.log(`🛡️  [ℹ️ INFO] Agent B Listening on ${inbox} (Vulnerable Mode)`)

    // Subscribe through the Mirror Node: messages arrive in consensus order.
    new TopicMessageQuery()
      .setTopicId(inbox)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          const envelope = JSON.parse(content)
          const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

          if (data?.text?.includes('Hello')) {
            console.log('\n--- 📥 [📊 LOG] AGENT B: RECEIVED REQUEST ---')
            console.log(`[ℹ️ INFO] Content: "${data.text}"`)

            const roundMatch = data.text.match(/\d+/)
            const round = roundMatch ? roundMatch[0] : '99'

            console.log(`[⚙️ PROCESS] Agent B processing logic for Round ${round}...`)
            await sleep(4000)

            await hcs10.sendMessage(outbox, { text: `World ${round}!`, target: agentA_Id })
            console.log('[✅ SUCCESS] Response dispatched.')
          }
        } catch (e) { console.error('[❌ FAILED] The agent could not reply:', e.message) }
      })
  }

  // --- AGENT A: THE TARGET INITIATOR ---
  const startAgentA = async () => {
    const client = createClient().setOperator(agentA_Id, agentA_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentA_Id, operatorPrivateKey: agentA_Key })

    let currentRound = 1
    console.log(`🤖 [ℹ️ INFO] Agent A Monitoring Outbox [${outbox}]`)

    const sendPing = async (round) => {
      console.log(`\n--- 🤖 [⚙️ PROCESS] AGENT A: SENDING ROUND ${round} ---`)
      await hcs10.sendMessage(inbox, {
        operator_id: agentA_Id,
        text: `Hello ${round}`
      })
    }

    new TopicMessageQuery()
      .setTopicId(outbox)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()
        if (content.includes(`World ${currentRound}`)) {
          console.log(`\n[✅ SUCCESS] AGENT A: SUCCESS for Round ${currentRound}.`)
          if (currentRound < 3) {
            currentRound++
            await sleep(5000)
            await sendPing(currentRound)
          } else {
            console.log('\n🏁 [✅ SUCCESS] Interaction complete.')
            console.log('\n💡 KEY CONCEPT:')
            console.log('The Identity Gap: In this lab, you saw how easily Agent C spoofed')
            console.log('the conversation. Without cryptographic session validation,')
            console.log('our agents are defenseless against malicious actors who know')
            console.log('the protocol format.')
            console.log('\n--- SESSION COMPLETE ---\n')
            process.exit()
          }
        }
      })

    await sendPing(currentRound)
  }

  // --- AGENT C: THE ADVERSARY ---
  const startAgentC = async () => {
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentC_Id, operatorPrivateKey: agentC_Key })

    for (let i = 0; i < 3; i++) {
      await sleep(Math.floor(Math.random() * 8000) + 5000)
      console.log('\n--- 😈 [⚙️ PROCESS] ADVERSARY: INJECTING SPOOFED PACKET ---')
      await hcs10.sendMessage(inbox, {
        operator_id: agentA_Id,
        text: 'Hello 99 (MALICIOUS SPOOF)'
      })
      console.log('[ℹ️ INFO] Spoofed packet published to target topic.')
    }
  }

  startAgentB()
  setTimeout(startAgentA, 2000)
  setTimeout(startAgentC, 6000) // Adversary joins later
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
