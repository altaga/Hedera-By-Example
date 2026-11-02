/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 07: Autonomous Agent Orchestration
 * [ CONCEPT ] Stateful Parallel Communication
 * ============================================================================
 * [ KEY CONCEPT ]
 * Cooperative Autonomy: This lab demonstrates fundamental orchestration where
 * two agents act as a "Swarm." Agent A initiates a work item, and Agent B
 * reacts, processes the data, and replies. This establishes a reactive loop
 * where agents monitor specific topics and respond based on internal state.
 * By decoupling the agents and using the ledger as a coordination layer,
 * you create a system that is fault-tolerant and easily auditable.
 * *
 * [ LEARNABLE MOMENT ]
 * Agent-to-Agent (A2A) orchestration over open consensus topics enables decentralized machine collaboration, where autonomous models negotiate and divide tasks openly without centralized message queues.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hashgraphonline.com/standards/hcs-10/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 06: HCS-10 U2A Public
 * - Next:     M9 Lab 08: Impersonation Attack
 *
 * [ HOW TO RUN ]
 * node 07_hcs10_a2a_public.js
 * ============================================================================
 */

import { Client, TopicMessageQuery } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import dotenv from 'dotenv'
import { getState, sleep, getClient, createClient, exitIfStuck } from '../M99_Utilities/index.js'

dotenv.config()

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'subscription messages')
  const sessionStart = new Date(Date.now() - 10000) // 10s look-back for Mirror Node propagation
  console.log('--- SESSION START: Autonomous Orchestration Simulation ---\n')

  // --- CONFIGURATION ---
  const agentA_Id = getState('HCS11_AGENT_A_ID')
  const agentA_Key = getState('HCS11_AGENT_A_KEY')
  const agentB_Id = getState('HCS11_AGENT_B_ID')
  const agentB_Key = getState('HCS11_AGENT_B_KEY')

  const inbox = getState('HCS11_AGENT_B_INBOUND')
  const outbox = getState('HCS11_AGENT_B_OUTBOUND')

  if (!agentA_Id || !agentB_Id || !inbox || !outbox) {
    console.error('[❌ FAILED] Missing Agent IDs or Topic configurations in state.')
    process.exitCode = 1
    return
  }

  // --- AGENT B: THE REACTIVE SERVICE ---
  const startAgentB = async () => {
    const client = createClient().setOperator(agentB_Id, agentB_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentB_Id, operatorPrivateKey: agentB_Key })
    const processedMessages = new Set()

    console.log(`📡 [ℹ️ INFO] Agent B monitoring Inbox [${inbox}]...`)

    new TopicMessageQuery()
      .setTopicId(inbox)
      .setStartTime(sessionStart)
      .subscribe(client, null, async (msg) => {
        const tsString = msg.consensusTimestamp.toString()
        if (processedMessages.has(tsString)) return
        processedMessages.add(tsString)

        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          const envelope = JSON.parse(content)
          const data = Array.isArray(envelope) ? envelope[0].data : envelope.data

          if (data?.text?.includes('Hello')) {
            console.log('\n--- 📥 [📊 LOG] AGENT B: EVENT RECEIVED ---')
            console.log(`[ℹ️ INFO] Observed message on topic: ${inbox}`)
            console.log(`[📊 LOG] Content: "${data.text}"`)

            const roundMatch = data.text.match(/\d+/)
            const round = roundMatch ? roundMatch[0] : 'unknown'

            console.log(`[⚙️ PROCESS] Agent B processing logic for Round ${round}...`)
            await sleep(5000)

            console.log('[✅ SUCCESS] Sending response to Outbox...')
            await hcs10.sendMessage(outbox, {
              text: `World ${round}!`,
              target: agentA_Id
            })
          }
        } catch (e) { }
      })
  }

  // --- AGENT A: THE SEQUENCE INITIATOR ---
  const startAgentA = async () => {
    const client = createClient().setOperator(agentA_Id, agentA_Key)
    const hcs10 = new HCS10Client({ network: 'testnet', operatorId: agentA_Id, operatorPrivateKey: agentA_Key })
    const processedMessages = new Set()

    let currentRound = 1
    const maxRounds = 3

    console.log(`🤖 [ℹ️ INFO] Agent A monitoring Outbox [${outbox}]...`)

    const sendPing = async (round) => {
      console.log('\n--- 🤖 [⚙️ PROCESS] AGENT A: STATE UPDATE ---')
      console.log(`[⚙️ PROCESS] Initiating Round ${round}...`)

      await hcs10.sendMessage(inbox, {
        operator_id: agentA_Id,
        text: `Hello ${round}`
      })
      console.log(`[✅ SUCCESS] Published "Hello ${round}" to Inbox.`)
    }

    new TopicMessageQuery()
      .setTopicId(outbox)
      .setStartTime(sessionStart)
      .subscribe(client, null, async (msg) => {
        const tsString = msg.consensusTimestamp.toString()
        if (processedMessages.has(tsString)) return
        processedMessages.add(tsString)

        const content = Buffer.from(msg.contents, 'utf8').toString()

        try {
          if (content.includes(`World ${currentRound}`)) {
            console.log('\n--- 📥 [📊 LOG] AGENT A: RESPONSE CONFIRMED ---')
            console.log(`[✅ SUCCESS] Received valid reply for Round ${currentRound}.`)

            if (currentRound < maxRounds) {
              currentRound++
              await sleep(5000)
              await sendPing(currentRound)
            } else {
              console.log('\n🏁 [✅ SUCCESS] Communication sequence complete.')
              console.log('\n💡 KEY CONCEPT:')
              console.log('Cooperative Autonomy: This lab demonstrates fundamental orchestration')
              console.log('where two agents act as a "Swarm." By decoupling the agents and using')
              console.log('the ledger as a coordination layer, you create a system that is')
              console.log('fault-tolerant and easily auditable.')
              console.log('\n--- SESSION COMPLETE ---\n')
              process.exit()
            }
          }
        } catch (e) {
          console.error('\n[❌ FAILED] Reactor failure:', e.message)
          process.exitCode = 1
        }
      })

    await sendPing(currentRound)
  }

  startAgentB()
  setTimeout(startAgentA, 3000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
