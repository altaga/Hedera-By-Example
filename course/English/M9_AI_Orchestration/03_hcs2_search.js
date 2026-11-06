/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: HCS-2 Registry Discovery
 * [CONCEPT] Building a Local Index from a Stream
 * ============================================================================
 * [ KEY CONCEPT ]
 * Discovery over Search: Distributed ledgers are append-only logs, not
 * searchable databases. To "search", we query a Mirror Node for all messages
 * in a topic, parse the HCS-2 JSON, and filter. This is how decentralized
 * apps work: your game client doesn't need an API key to find Anti-Cheat
 * rules—it simply reads the public registry stream and discovers
 * active Agents automatically.
 * *
 * [ LEARNABLE MOMENT ]
 * Autonomous agent discovery requires querying HCS-2 registries with semantic tags. Agents dynamically filter peer capabilities over consensus without exposing API keys or credentials.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-2/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 02: HCS-2 Registries
 * - Next:     M9 Lab 04: HCS-11 Profiles
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M9 Lab 02 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 03_hcs2_search.js
 * ============================================================================
 */

import { TopicMessageQuery } from '@hiero-ledger/sdk'
import { getClient, getState, exitIfStuck } from '../M99_Utilities/index.js'

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'subscription messages')
  console.log('--- SESSION START: HCS-2 Registry Discovery (MirroNode Query) ---\n')
  const { client } = getClient()

  // Grab the Registry Topic ID from our local state
  const registryTopicId = getState('HCS2_REGISTRY_TOPIC_ID')

  if (!registryTopicId) {
    console.error('[FAILED] Missing Registry Topic ID. Please run Lab 02 first.')
    process.exitCode = 1
    return
  }

  console.log(`[PROCESS] Scanning Registry (${registryTopicId}) for Game AI Agents...`)
  console.log('[INFO] Streaming history from Mirror Node...\n')

  let agentsFound = 0

  // Connect to a Mirror Node to read the historical stream
  new TopicMessageQuery()
    .setTopicId(registryTopicId)
    .setStartTime(0) // Look at the entire history of the registry
    .subscribe(
      client,
      (error) => {
        console.error(`\n[FAILED] Mirror Node Subscription Failed: ${error.message}`)
        process.exitCode = 1
      },
      (message) => {
        try {
          // 1. Decode the raw network bytes back into text
          const payloadString = Buffer.from(message.contents).toString('utf8')

          // 2. Parse the JSON
          const entry = JSON.parse(payloadString)

          // 3. FILTERING: This is how we "Search"
          if (entry.h === 'hcs-2' && entry.cat === 'ANTI_CHEAT_ORACLE') {
            agentsFound++

            console.log(`[LOG] MATCH FOUND: Verified Agent #${agentsFound}`)
            console.log(`Registry Name:   ${entry.r}`)
            console.log(`Agent Topic ID:  ${entry.tid} <-- (Linked to Lab 01)`)
            console.log(`Status:          ${entry.status}`)
            console.log(`Registered On:   ${new Date(entry.ts).toLocaleString()}`)
            console.log('--------------------------------------------------')

            // In a real application, you would now take `entry.tid` and pass it
            // into a script to download the actual rules!
          }
        } catch (parseError) {
          // Ignore non-JSON traffic
        }
      }
    )

  // For this lab, we wait 5 seconds then exit automatically.
  setTimeout(() => {
    console.log('\n[SUCCESS] History scan complete.')
    console.log('\n KEY CONCEPT:')
    console.log('This is how decentralized frontend applications work. A Web3 game client')
    console.log('doesn\'t need an API key to find the Anti-Cheat rules. It simply reads')
    console.log('the public registry stream and discovers the active Agents automatically.')
    console.log('\n--- SESSION COMPLETE ---')
    process.exit()
  }, 6000)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
