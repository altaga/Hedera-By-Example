/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: User to Agent Communication (Parallel Orchestration)
 * [ CONCEPT ] Stateful Event-Driven Duplex Communication
 * ============================================================================
 * [ KEY CONCEPT ]
 * Stateful Callbacks: True Agentic workflows rely on reactive parallel
 * communication. Instead of "polling" an API to see if a job is done, both
 * the User and the Agent monitor the ledger in real-time. The client
 * reacts to "Pongs" published by the agent, and the agent reacts to
 * "Pings" published by the user. This ensures that every interaction is
 * chronologically ordered and verifiable by the consensus nodes.
 * *
 * [ LEARNABLE MOMENT ]
 * User-to-Agent (U2A) consensus messaging creates an immutable audit trail of human prompts and instructions, ensuring legal accountability when autonomous agents execute financial actions.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hashgraphonline.com/standards/hcs-10/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 05: HCS-14 UAID
 * - Next:     M9 Lab 07: HCS-10 A2A Public
 *
 * [ SEQUENCE ]
 * User -> Agent Inbox: Request message (HCS-10)
 * Agent -> Agent Inbox: Subscribe and read request
 * Note Agent: Processes the request
 * Agent -> User Inbox: Response message
 * User -> User Inbox: Read response
 *
 * [ HOW TO RUN ]
 * node 06_hcs10_u2a_public.js
 * ============================================================================
 */

import { Client, PrivateKey, TopicMessageQuery, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { HCS10Client } from '@hashgraphonline/standards-sdk'
import dotenv from 'dotenv'
import { getClient, getState, sleep, createClient, exitIfStuck } from '../M99_Utilities/index.js'

dotenv.config()

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'subscription messages')
  const sessionStart = new Date(Date.now() - 10000) // 10s look-back for Mirror Node propagation
  console.log('--- SESSION START: Real-Time U2A Orchestration ---\n')

  const agentId = getState('HCS11_AGENT_A_ID')
  const agentKeyRaw = getState('HCS11_AGENT_A_KEY')
  const agentInbox = getState('HCS11_AGENT_A_INBOUND')
  const agentOutbox = getState('HCS11_AGENT_A_OUTBOUND')

  const operatorId = process.env.ACCOUNT_1_ID
  const operatorKeyRaw = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!agentId || !operatorId) {
    console.error('[❌ FAILED] Missing Agent A or Account 1 data in configuration.')
    process.exitCode = 1
    return
  }

  // --- AGENT SERVER: REACTIVE SERVICE ---
  const startAgent = async () => {
    const hederaClient = createClient().setOperator(agentId, agentKeyRaw)
    const hcs10Agent = new HCS10Client({
      network: 'testnet',
      operatorId: agentId,
      operatorPrivateKey: PrivateKey.fromString(agentKeyRaw).toStringRaw()
    })

    const processedMessages = new Set()
    console.log(`📡 [ℹ️ INFO] Agent A live: Listening on Inbox [${agentInbox}]`)

    new TopicMessageQuery()
      .setTopicId(agentInbox)
      .setStartTime(0)
      .subscribe(
        hederaClient,
        (err) => { console.error(`\n[❌ FAILED] AGENT MIRROR ERROR: ${err.message}`); process.exit(1) },
        async (message) => {
          const tsString = message.consensusTimestamp.toString()
          if (processedMessages.has(tsString)) return
          processedMessages.add(tsString)

          if (message.consensusTimestamp.toDate() < sessionStart) return

          try {
            const content = Buffer.from(message.contents, 'utf8').toString()
            const rawJson = JSON.parse(content)
            const parsed = Array.isArray(rawJson) ? rawJson[0] : rawJson

            if (parsed?.data?.toLowerCase().includes('hello')) {
              console.log('\n--- 📥 [📊 LOG] AGENT A: REQUEST RECEIVED ---')
              const num = parsed.data.match(/\d+/) ? parsed.data.match(/\d+/)[0] : ''

              console.log('[⚙️ PROCESS] Agent "thinking" to process request...')
              await sleep(4000)

              await hcs10Agent.sendMessage(agentOutbox, {
                text: `World ${num}!`.trim(),
                target: parsed.operator_id
              })
              console.log('[✅ SUCCESS] Response dispatched to ledger.')
            }
          } catch (e) { console.error('[❌ FAILED] The agent could not reply:', e.message) }
        })
  }

  // --- HUMAN USER CLIENT: REACTIVE HANDLER ---
  const startClient = async () => {
    const hederaClient = createClient().setOperator(operatorId, operatorKeyRaw)
    const processedMessages = new Set()

    console.log(`👤 [ℹ️ INFO] User live: Monitoring Outbox [${agentOutbox}]`)

    let currentRound = 1
    const maxRounds = 3

    const sendPing = async (round) => {
      console.log(`\n--- 📤 [⚙️ PROCESS] USER: INITIATING ROUND ${round} ---`)
      const rawPayload = JSON.stringify({ operator_id: operatorId, data: `Hello ${round}` })
      const tx = await new TopicMessageSubmitTransaction()
        .setTopicId(agentInbox)
        .setMessage(rawPayload)
        .execute(hederaClient)

      await tx.getReceipt(hederaClient)
      console.log(`[✅ SUCCESS] Published "Hello ${round}". Waiting for Pong...`)
    }

    new TopicMessageQuery()
      .setTopicId(agentOutbox)
      .setStartTime(0)
      .subscribe(
        hederaClient,
        (err) => { console.error(`\n[❌ FAILED] CLIENT MIRROR ERROR: ${err.message}`); process.exit(1) },
        async (message) => {
          const tsString = message.consensusTimestamp.toString()
          if (processedMessages.has(tsString)) return
          processedMessages.add(tsString)

          if (message.consensusTimestamp.toDate() < sessionStart) return

          try {
            const content = Buffer.from(message.contents, 'utf8').toString()
            const rawJson = JSON.parse(content)
            const parsed = Array.isArray(rawJson) ? rawJson[0] : rawJson

            const targetId = parsed?.data?.target ? String(parsed.data.target).trim() : 'none'
            const myId = String(operatorId).trim()

            if (targetId.includes(myId)) {
              const replyText = parsed.data.text || ''
              if (replyText.includes(`World ${currentRound}`)) {
                console.log('\n--- 📥 [📊 LOG] USER: CALLBACK DETECTED ---')
                console.log(`[✅ SUCCESS] Agent responded with: "${replyText}"`)

                if (currentRound < maxRounds) {
                  currentRound++
                  console.log('[⚙️ PROCESS] Reading response...')
                  await sleep(5000)
                  await sendPing(currentRound)
                } else {
                  console.log('\n🏁 [✅ SUCCESS] Interaction sequence complete.')
                  console.log('\n💡 KEY CONCEPT:')
                  console.log('Stateful Callbacks: True Agentic workflows rely on reactive parallel')
                  console.log('communication. Instead of "polling" an API, both sides listen to')
                  console.log('the public ledger and only progress when specific criteria is met.')
                  console.log('\n--- SESSION COMPLETE ---\n')
                  process.exit()
                }
              }
            }
          } catch (e) {
            console.error('\n[❌ FAILED] Malformed callback packet:', e.message)
            process.exitCode = 1
          }
        })

    await sleep(2000)
    await sendPing(currentRound)
  }

  startAgent()
  startClient()
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
