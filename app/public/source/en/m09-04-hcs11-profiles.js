/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: HCS-11 AI Profiles (Spoofer Agent Provisioning)
 * [ CONCEPT ] Scaling Structured Identities and Audit
 * ============================================================================
 * [ KEY CONCEPT ]
 * Specialized Agents: Provisioning agents with HCS-11 profiles allows for
 * "Check and Balance" architectures. One agent can be optimized for log
 * auditing, while another (like this "Spoofer Agent") is designed to
 * simulate malicious traffic or impersonation attacks. Having structured
 * and verifiable identities on the ledger is the first step toward building
 * a resilient AI infrastructure capable of defending against data
 * manipulation in highly competitive environments.
 * *
 * [ LEARNABLE MOMENT ]
 * HCS-11 establishes verifiable agent identity profiles. Without verifiable on-chain metadata, rogue actors can easily impersonate autonomous trading agents and deceive decentralized counterparties.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hashgraphonline.com/standards/hcs-11/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 03: HCS-2 Search and Resolution
 * - Next:     M9 Lab 05: Universal Agent Identifier (HCS-14)
 *
 * [ HOW TO RUN ]
 * node 04_hcs11_profiles.js
 * ============================================================================
 */

import { PrivateKey } from '@hiero-ledger/sdk'
import {
  AgentBuilder,
  AIAgentCapability,
  HCS10Client,
  InboundTopicType
} from '@hashgraphonline/standards-sdk'
import { getClient, updateState, exitIfStuck } from '../M99_Utilities/index.js'

getClient()

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'subscription messages')
  console.log('--- SESSION START: Specialized Agent Provisioning Audit (HCS-11) ---\n')

  const accountId = process.env.ACCOUNT_1_ID
  const privateKeyDer = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!accountId || !privateKeyDer) {
    console.error('[❌ FAILED] Missing ACCOUNT_1_ID or its private key. Check Lab 00.')
    process.exitCode = 1
    return
  }

  const PRIVATE_KEY_DER = PrivateKey.fromString(privateKeyDer)

  // Agent configuration (Synchronized with the overall curriculum)
  const agentsToCreate = [
    {
      prefix: 'AGENT_A',
      name: 'Esports Anti-Cheat Judge v2',
      bio: 'Autonomous referee for the $1 million Grand Finals.',
      alias: 'fairplay-judge'
    },
    {
      prefix: 'AGENT_B',
      name: 'Fair Play Sentinel v1',
      bio: 'Secondary auditor monitoring game telemetry in real-time.',
      alias: 'integrity-sentinel'
    },
    {
      prefix: 'AGENT_C',
      name: 'Esports Spoofer Agent',
      bio: 'Specialized agent used to simulate adversarial telemetry in security audits.',
      alias: 'spoofer'
    }
  ]

  try {
    const client = new HCS10Client({
      network: 'testnet',
      operatorId: accountId,
      operatorPrivateKey: PRIVATE_KEY_DER.toStringRaw()
    })

    for (const config of agentsToCreate) {
      console.log(`\n[⚙️ PROCESS] Starting provisioning for: ${config.name}...`)

      const agentBuilder = new AgentBuilder()
        .setName(config.name)
        .setBio(config.bio)
        .setCapabilities([
          AIAgentCapability.DATA_INTEGRATION,
          AIAgentCapability.TEXT_GENERATION
        ])
        .setType('autonomous')
        .addProperty('alias', config.alias)
        .setNetwork('testnet')
        .setInboundTopicType(InboundTopicType.PUBLIC)

      const agent = await client.createAndRegisterAgent(agentBuilder, {
        initialBalance: 15, // Funds for operational autonomy
        progressCallback: (event) => console.log(`   ⏳ [ℹ️ INFO] ${config.alias}: ${event.message}`)
      })

      if (agent.success) {
        console.log(`\n[✅ SUCCESS] ${config.name.toUpperCase()} PROVISIONED`)
        console.log(`[📊 LOG] Account ID: ${agent.metadata.accountId}`)
        console.log(`[📊 LOG] Inbox ID:   ${agent.metadata.inboundTopicId}`)

        // Dynamic state persistence
        updateState(`HCS11_${config.prefix}_ID`, agent.metadata.accountId)
        updateState(`HCS11_${config.prefix}_KEY`, agent.metadata.privateKey)
        updateState(`HCS11_${config.prefix}_INBOUND`, agent.metadata.inboundTopicId)
        updateState(`HCS11_${config.prefix}_OUTBOUND`, agent.metadata.outboundTopicId)
      }

      // Network cooldown
      await new Promise(r => setTimeout(r, 2000))
    }

    console.log('\n💡 KEY CONCEPT:')
    console.log('You have provisioned a specialized agent for security testing.')
    console.log('In future labs, this "Agent C" will attempt to perform')
    console.log('impersonation attacks, allowing you to verify the robustness of')
    console.log('your defenses under the HCS-10 standard.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] HCS-11 agent provisioning failed:', error.message)
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
