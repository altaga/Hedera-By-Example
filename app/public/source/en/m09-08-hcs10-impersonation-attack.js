/**
 * ============================================================================
 * Lab 08: The Impersonation Attack (Security Gap)
 * [CONCEPT] Vulnerability of Public Streams
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Identity Gap: In previous labs, we processed messages based purely on
 * content. Because HCS topics are public, anyone with the Topic ID can
 * publish "Spam" or "Forgeries". This lab introduces an Adversary (Agent C)
 * who attempts to hijack the conversation by spoofing the logic. You will
 * see that without cryptographic session validation, our agents are
 * defenseless against malicious actors who know the protocol format.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Public consensus topics allow anyone to broadcast messages. Simulating an impersonation attack demonstrates why unauthenticated agent communication is vulnerable to spoofing and unauthorized commands.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-10/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 07: Autonomous Agent Orchestration
 * - Next:     M9 Lab 09: Secure A2A Communication (HCS-10)
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
 * node English/M9_AI_Orchestration/08_hcs10_impersonation_attack.js
 * ============================================================================
 */

import { TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import { getState, sleep, createClient, exitIfStuck, loadEnv } from '../M99_Utilities/index.js'

loadEnv() // reads course/.env (and the repository root .env)

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'subscription messages')
  const sessionStart = new Date(Date.now() - 10000) // only messages from this run (10 s look-back for Mirror Node propagation)
  let sessionDone = false // set when Agent A finishes, so the adversary stops too
  console.log('--- SESSION START: Public Stream Vulnerability Audit ---\n')

  // --- CONFIGURATION ---
  const agentAId = getState('HCS11_AGENT_A_ID')
  const agentAKey = getState('HCS11_AGENT_A_KEY')
  const agentBId = getState('HCS11_AGENT_B_ID')
  const agentBKey = getState('HCS11_AGENT_B_KEY')
  const agentCId = getState('HCS11_AGENT_C_ID')
  const agentCKey = getState('HCS11_AGENT_C_KEY')

  const inbox = getState('HCS11_AGENT_B_INBOUND')
  const outbox = getState('HCS11_AGENT_B_OUTBOUND')

  if (!agentAId || !agentBId || !agentCId) {
    console.error('[FAILED] Missing the agents and their topics. Run M9 Lab 04 first.')
    process.exitCode = 1
    return
  }

  // --- AGENT B: THE VULNERABLE SERVICE ---
  const startAgentB = async () => {
    const client = createClient().setOperator(agentBId, agentBKey)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentBId, operatorPrivateKey: agentBKey })

    console.log(`[INFO] Agent B Listening on ${inbox} (Vulnerable Mode)`)

    // Subscribe through the Mirror Node: messages arrive in consensus order.
    new TopicMessageQuery()
      .setTopicId(inbox)
      .setStartTime(sessionStart)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          const envelope = JSON.parse(content)
          const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

          if (data?.text?.includes('Hello')) {
            console.log('\n---  [LOG] AGENT B: RECEIVED REQUEST ---')
            console.log(`[INFO] Content: "${data.text}"`)

            const roundMatch = data.text.match(/\d+/)
            const round = roundMatch ? roundMatch[0] : '99'

            console.log(`[PROCESS] Agent B processing logic for Round ${round}...`)
            await sleep(4000)

            await hcs10.sendMessage(outbox, { text: `World ${round}!`, target: agentAId })
            console.log('[SUCCESS] Response dispatched.')
          }
        } catch (e) { console.error('[FAILED] The agent could not reply:', e.message) }
      })
  }

  // --- AGENT A: THE TARGET INITIATOR ---
  const startAgentA = async () => {
    const client = createClient().setOperator(agentAId, agentAKey)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentAId, operatorPrivateKey: agentAKey })

    let currentRound = 1
    console.log(`[INFO] Agent A Monitoring Outbox [${outbox}]`)

    const sendPing = async (round) => {
      console.log(`\n---  [PROCESS] AGENT A: SENDING ROUND ${round} ---`)
      await hcs10.sendMessage(inbox, {
        operator_id: agentAId,
        text: `Hello ${round}`
      })
    }

    new TopicMessageQuery()
      .setTopicId(outbox)
      .setStartTime(sessionStart)
      .subscribe(client, null, async (msg) => {
        const content = Buffer.from(msg.contents, 'utf8').toString()
        if (content.includes(`World ${currentRound}`)) {
          console.log(`\n[SUCCESS] AGENT A: SUCCESS for Round ${currentRound}.`)
          if (currentRound < 3) {
            currentRound++
            await sleep(5000)
            await sendPing(currentRound)
          } else {
            console.log('\n [SUCCESS] Interaction complete.')
            console.log('\n KEY CONCEPT:')
            console.log('The Identity Gap: In this lab, you saw how easily Agent C spoofed')
            console.log('the conversation. Without cryptographic session validation,')
            console.log('our agents are defenseless against malicious actors who know')
            console.log('the protocol format.')
            console.log('\n--- SESSION COMPLETE ---\n')
            sessionDone = true
            process.exit()
          }
        }
      })

    await sendPing(currentRound)
  }

  // --- AGENT C: THE ADVERSARY ---
  const startAgentC = async () => {
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentCId, operatorPrivateKey: agentCKey })

    for (let i = 0; i < 3; i++) {
      await sleep(Math.floor(Math.random() * 8000) + 5000)
      if (sessionDone) return
      console.log('\n---  [PROCESS] ADVERSARY: INJECTING SPOOFED PACKET ---')
      await hcs10.sendMessage(inbox, {
        operator_id: agentAId,
        text: 'Hello 99 (MALICIOUS SPOOF)'
      })
      console.log('[INFO] Spoofed packet published to target topic.')
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
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
