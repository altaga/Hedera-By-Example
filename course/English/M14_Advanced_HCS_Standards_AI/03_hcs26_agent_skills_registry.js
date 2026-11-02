/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: HCS-26 Decentralized Agent Skills & Tool Manifest Registry
 * [ CONCEPT ] Permissionless Discovery of AI Capabilities & MCP Tools
 * ============================================================================
 * [ KEY CONCEPT ]
 * Decentralized Capability Discovery: Instead of relying on centralized app stores
 * or proprietary AI plugin directories, HCS-26 provides an open, immutable registry
 * for AI agent tools and skills over Hedera Consensus Service.
 * Agents publish standardized manifests declaring their Model Context Protocol (MCP)
 * tools, JSON parameter schemas, pricing models, and service endpoints.
 * Other agents discover, validate, and invoke these tools peer-to-peer.
 *
 * [ LEARNABLE MOMENT ]
 * If agent capabilities are locked behind proprietary databases, a central company
 * can deplatform, censor, or alter tool behavior without warning. HCS-26 ensures that
 * tool definitions and versions are permanently anchored to consensus time.
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 02: HCS-25 Portable AI Trust Score
 * - Next:     M14 Lab 04: HCS-27 Merkle Transparency Log Checkpoints
 *
 * [ HOW TO RUN ]
 * node English/M14_Advanced_HCS_Standards_AI/03_hcs26_agent_skills_registry.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { HCS26_PROTOCOL } from '@hashgraphonline/standards-sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Builds a standardized HCS-26 Skill Manifest.
 *
 * @param {object} params - Skill descriptors and schema
 * @returns {object} Standardized manifest
 */
const buildHCS26Manifest = ({ skillId, name, version, providerId, description, tags, pricing, mcpTools }) => ({
  protocol: HCS26_PROTOCOL,
  version: '1.0.0',
  skillId,
  name,
  semver: version,
  provider: providerId,
  description,
  tags,
  pricing: {
    model: pricing.model || 'pay-per-call',
    cost: pricing.cost || '0.1',
    asset: pricing.asset || 'HBAR'
  },
  mcpTools,
  registeredAt: new Date().toISOString()
})

const main = async () => {
  console.log('--- SESSION START: HCS-26 Decentralized Agent Skills Registry ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Create HCS-26 Registry Topic
    console.log('[⚙️ PROCESS] Initializing HCS-26 Decentralized Agent Skills Registry Topic...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-26:AGENT:SKILLS:REGISTRY')
      .execute(client)

    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[✅ SUCCESS] HCS-26 Skills Registry Topic Created: ${topicId}`)

    // 2. Define an Advanced Autonomous Skill Manifest (Real Estate / RWA Valuation Engine)
    console.log('\n[⚙️ PROCESS] Authoring HCS-26 Skill Manifest with Model Context Protocol (MCP) Tooling...')
    const skillManifest = buildHCS26Manifest({
      skillId: 'hedera-rwa-appraiser-v2',
      name: 'Hedera RWA Automated Appraisal & NAV Estimator',
      version: '2.1.0',
      providerId: operatorId.toString(),
      description: 'Provides real-time machine-learning automated net asset valuations (NAV) for tokenized commercial real estate.',
      tags: ['rwa', 'valuation', 'real-estate', 'oracle', 'defi'],
      pricing: { model: 'pay-per-call', cost: '0.25', asset: 'HBAR' },
      mcpTools: [
        {
          name: 'get_property_nav',
          description: 'Calculates the net asset value of a tokenized property given its Hedera Token ID.',
          parameters: {
            type: 'object',
            properties: {
              tokenId: { type: 'string', description: 'Hedera HTS token ID (e.g. 0.0.12345)' },
              includeCapRate: { type: 'boolean', description: 'Whether to return current local capitalization rate' }
            },
            required: ['tokenId']
          }
        },
        {
          name: 'verify_title_attestation',
          description: 'Verifies the cryptographic deed and title registry hash on HCS.',
          parameters: {
            type: 'object',
            properties: {
              deedHash: { type: 'string', description: 'SHA-256 hash of municipal title document' }
            },
            required: ['deedHash']
          }
        }
      ]
    })

    console.log('[📊 LOG] Skill Manifest Assembled:')
    console.log(`[📊 LOG] Skill ID:     ${skillManifest.skillId} (v${skillManifest.semver})`)
    console.log(`[📊 LOG] Provider:     ${skillManifest.provider}`)
    console.log(`[📊 LOG] MCP Tools:    ${skillManifest.mcpTools.map(t => t.name).join(', ')}`)
    console.log(`[📊 LOG] Unit Pricing: ${skillManifest.pricing.cost} ${skillManifest.pricing.asset} per query`)

    // 3. Register Manifest on Consensus Topic
    console.log('\n[⚙️ PROCESS] Broadcast-registering skill to HCS-26 registry topic...')
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(skillManifest))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    const seq = submitReceipt.topicSequenceNumber.toString()
    console.log(`[✅ SUCCESS] Skill Registered! Consensus Sequence #${seq}`)

    // 4. Client Agent Discovery & Validation Simulation
    console.log('\n[⚙️ PROCESS] Simulating peer AI Agent performing semantic discovery...')
    const searchFilterTag = 'rwa'
    const isTagMatched = skillManifest.tags.includes(searchFilterTag)
    console.log(`[🔍 DISCOVERY] Querying skills matching tag: '${searchFilterTag}' ➔ ${isTagMatched ? 'MATCH FOUND' : 'NO MATCH'}`)

    if (isTagMatched) {
      console.log(`[✅ DISCOVERED] Found Skill: ${skillManifest.name}`)
      console.log(`[📋 SCHEMA] Available Tool: ${skillManifest.mcpTools[0].name}`)
      console.log(`[📋 SCHEMA] Parameters Required: ${JSON.stringify(skillManifest.mcpTools[0].parameters.required)}`)
      console.log(`[💳 PRICING] Execution Fee: ${skillManifest.pricing.cost} ${skillManifest.pricing.asset}`)
    }

    // Persist state
    updateState('HCS26_REGISTRY_TOPIC_ID', topicId)
    updateState('HCS26_SKILL_ID', skillManifest.skillId)
    updateState('HCS26_TOOL_COUNT', skillManifest.mcpTools.length)

    console.log('\n💡 KEY CONCEPT:')
    console.log('HCS-26 allows any autonomous agent in the world to announce its tools and')
    console.log('price lists to an immutable bulletin board. Swarms can form, discover peers,')
    console.log('and negotiate multi-agent pipelines without a human engineer writing API bindings.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('By standardizing skill manifests under the Model Context Protocol (MCP) on Hedera,')
    console.log('any LLM (Claude, GPT, DeepSeek, Gemini) can natively discover and invoke Web3 tools.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] HCS-26 Execution Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
