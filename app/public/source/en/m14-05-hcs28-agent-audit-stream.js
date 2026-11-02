/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: HCS-28 Verifiable AI Agent Audit Trail & Cognitive Provenance
 * [ CONCEPT ] Cryptographic Non-Repudiation for Autonomous Intelligence
 * ============================================================================
 * [ KEY CONCEPT ]
 * Cognitive Provenance & Liability: As autonomous AI agents execute financial
 * transactions, interact with real-world infrastructure, and negotiate contracts,
 * enterprises and regulators require complete auditability.
 * HCS-28 specifies an immutable consensus stream recording an agent's entire
 * cognitive lifecycle: prompt hashes, reasoning trace digests, tool parameters,
 * safety guardrail clearances, and cryptographic non-repudiation signatures.
 *
 * [ LEARNABLE MOMENT ]
 * When a self-driving car crashes or an autonomous trading bot incurs a deficit,
 * investigators need a tamper-proof flight data recorder ("black box").
 * HCS-28 turns Hedera into that immutable flight recorder for autonomous AI.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/
 * - https://hol.org/docs/standards/hcs-27/
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 04: HCS-27 Merkle Transparency Log Checkpoints
 * - Next:     M14 Lab 06: Encrypted AI Agent Swarm Chat (P2P Over HCS)
 *
 * [ SIMULATED ]
 * The agent prompt, reasoning and guardrails are canned text, not a live model. The audit stream on HCS is real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M14_Advanced_HCS_Standards_AI/05_hcs28_agent_audit_stream.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Builds an HCS-28 compliant agent audit payload.
 *
 * @param {object} params - Cognitive cycle parameters
 * @returns {object} Audit payload with cryptographic signature
 */
const buildHCS28AuditRecord = ({ agentWallet, sessionId, cycleIndex, userPrompt, reasoningTrace, toolInvocations, finalDecision, guardrailChecks }) => {
  const promptHash = ethers.keccak256(ethers.toUtf8Bytes(userPrompt))
  const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes(reasoningTrace))
  const decisionHash = ethers.keccak256(ethers.toUtf8Bytes(finalDecision))

  const auditCore = {
    standard: 'hcs-28',
    version: '1.0.0',
    sessionId,
    cycleIndex,
    agentAddress: agentWallet.address,
    timestamp: new Date().toISOString(),
    hashes: {
      prompt: promptHash,
      reasoning: reasoningHash,
      decision: decisionHash
    },
    toolCalls: toolInvocations.map(t => ({
      tool: t.tool,
      paramsHash: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(t.params))),
      status: t.status
    })),
    guardrails: {
      passed: guardrailChecks.every(g => g.status === 'PASS'),
      evaluations: guardrailChecks
    }
  }

  const recordHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(auditCore)))
  const agentSignature = agentWallet.signingKey.sign(recordHash).serialized

  return {
    ...auditCore,
    recordHash,
    agentSignature
  }
}

const main = async () => {
  console.log('--- SESSION START: HCS-28 Agent Transparency & Cognitive Audit Stream ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Create HCS-28 Audit Stream Topic
    console.log('[⚙️ PROCESS] Creating dedicated HCS-28 Cognitive Audit Topic...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-28:AGENT:COGNITIVE:AUDIT')
      .execute(client)

    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[✅ SUCCESS] HCS-28 Audit Topic Deployed: ${topicId}`)

    // 2. Synthesize Autonomous Reasoning Cycle for Financial Risk Agent
    console.log('\n[⚙️ PROCESS] Simulating autonomous reasoning cycle for Agent Atlas...')
    const agentWallet = ethers.Wallet.createRandom()

    const simulatedPrompt = 'Rebalance Hedera liquidity pool treasury: Swap 10,000 HBAR for USDC if volatility index exceeds 35%.'
    const simulatedReasoning = '1. Queried volatility oracle (index = 38.4%). 2. Slippage estimated at 0.12%. 3. Approved treasury reallocation under Rule #402-B.'
    const simulatedTools = [
      { tool: 'hedera_volatility_oracle', params: { metric: 'VIX_HBAR', window: '1h' }, status: 'SUCCESS' },
      { tool: 'hts_atomic_swap', params: { sellAmount: '10000', minBuyAmount: '500' }, status: 'READY' }
    ]
    const simulatedGuardrails = [
      { rule: 'MAX_SINGLE_TX_CEILING', limit: '25000 HBAR', actual: '10000 HBAR', status: 'PASS' },
      { rule: 'ORACLE_FRESHNESS_CHECK', maxAgeSeconds: 60, actualAgeSeconds: 4, status: 'PASS' }
    ]

    const auditRecord = buildHCS28AuditRecord({
      agentWallet,
      sessionId: 'sess_99a8b1c4',
      cycleIndex: 1,
      userPrompt: simulatedPrompt,
      reasoningTrace: simulatedReasoning,
      toolInvocations: simulatedTools,
      finalDecision: 'EXECUTE_ORDER',
      guardrailChecks: simulatedGuardrails
    })

    console.log('[📊 LOG] HCS-28 Cognitive Audit Record Generated:')
    console.log(`[📊 LOG] Session ID:     ${auditRecord.sessionId} (Cycle #${auditRecord.cycleIndex})`)
    console.log(`[📊 LOG] Agent Address:  ${auditRecord.agentAddress}`)
    console.log(`[📊 LOG] Prompt Hash:    ${auditRecord.hashes.prompt}`)
    console.log(`[📊 LOG] Reasoning Hash: ${auditRecord.hashes.reasoning}`)
    console.log(`[📊 LOG] Guardrails:     ${auditRecord.guardrails.passed ? 'ALL PASSED (COMPLIANT)' : 'VIOLATION'}`)
    console.log(`[📊 LOG] Record Hash:    ${auditRecord.recordHash}`)

    // 3. Commit Audit Record to HCS Consensus
    console.log('\n[⚙️ PROCESS] Anchoring immutable record to HCS consensus topic...')
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(auditRecord))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    const seq = submitReceipt.topicSequenceNumber.toString()
    console.log(`[✅ SUCCESS] Audit Record Sealed at Consensus Sequence #${seq}`)

    // 4. Verification of Agent Non-Repudiation Signature
    const recoveredAgent = ethers.recoverAddress(auditRecord.recordHash, auditRecord.agentSignature)
    const isAuthentic = recoveredAgent.toLowerCase() === agentWallet.address.toLowerCase()
    console.log(`\n[📊 AUDIT] Agent Non-Repudiation Check: ${isAuthentic ? 'AUTHENTIC (SIGNED BY AGENT)' : 'FORGERY'}`)

    // Persist state
    updateState('HCS28_TOPIC_ID', topicId)
    updateState('HCS28_SESSION_ID', auditRecord.sessionId)
    updateState('HCS28_RECORD_HASH', auditRecord.recordHash)
    updateState('HCS28_AGENT_ADDRESS', agentWallet.address)

    console.log('\n💡 KEY CONCEPT:')
    console.log('HCS-28 solves the accountability problem in artificial intelligence.')
    console.log('Because the audit record is cryptographically signed and sequenced on Hedera,')
    console.log('no developer or AI agent can alter history to conceal a financial loss or bug.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Enterprise AI governance does not require slowing down autonomous execution;')
    console.log('it requires immutable cryptographic auditability at consensus speed.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] HCS-28 Execution Failure:', error.message)
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
