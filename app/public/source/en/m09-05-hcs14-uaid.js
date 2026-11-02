/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: HCS-14 Universal Agent ID (UAID)
 * [ CONCEPT ] Deterministic Offline Identifiers
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Mathematical Alias: A UAID is a deterministic, collision-resistant
 * identifier derived from canonical agent data. Generating a UAID requires
 * NO on-chain transactions! It is generated entirely offline using the
 * HCS14Client. Because it uses the Deterministic AID method, the SDK
 * generates this globally unique identifier locally. Any system in the
 * world with the same canonical data will derive the exact same UAID.
 * *
 * [ LEARNABLE MOMENT ]
 * The Universal Agent ID (HCS-14) provides a cryptographically anchored URI for artificial intelligence entities, resolving an agent public key, consensus topic endpoints, and verified skills across swarms.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hashgraphonline.com/standards/hcs-14/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 04: HCS-11 Profiles
 * - Next:     M9 Lab 06: HCS-10 U2A Public
 *
 * [ HOW TO RUN ]
 * node 05_hcs14_uaid.js
 * ============================================================================
 */

import { HCS14Client } from '@hashgraphonline/standards-sdk'
import { getState, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HCS-14 Universal Agent Identity ---\n')

  // Retrieve the Agent ID created in previous labs
  const agentId = getState('HCS11_AGENT_A_ID')

  if (!agentId) {
    console.error('[❌ FAILED] HCS11_AGENT_ID not found. Run previous labs first.')
    process.exitCode = 1
    return
  }

  try {
    const hcs14 = new HCS14Client()

    console.log(`[⚙️ PROCESS] Generating Deterministic UAID for Agent: ${agentId}...`)

    // Create the UAID (AID format) based on the documentation
    const uaid = await hcs14.createUaid(
      {
        registry: 'esports-tournament',
        name: 'Anti-Cheat Judge',
        version: '2.0.0',
        protocol: 'hcs-10',
        nativeId: `hedera:testnet:${agentId}`,
        skills: [0]
      },
      { uid: 'fairplay-sentinel' }
    )

    console.log('\n[✅ SUCCESS] UNIVERSAL AGENT ID (UAID) GENERATED')
    console.log('--------------------------------------------------')
    console.log(`[📊 LOG] Local ID (Hedera):  ${agentId}`)
    console.log(`[📊 LOG] Global UAID (HCS):  ${uaid}`)
    console.log('--------------------------------------------------')

    // Save it for future reference
    console.log('[ℹ️ INFO] Synchronizing state.json with UAID fingerprint...')
    updateState('HCS14_UAID', uaid)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Notice how fast that was? There were no TopicCreateTransaction calls.')
    console.log('Because you used the Deterministic AID method, the SDK generated this')
    console.log('globally unique identifier locally. Any system in the world with the')
    console.log('same canonical data will derive the exact same UAID.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] UAID Generation Failed:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
