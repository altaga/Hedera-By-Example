/**
 * ============================================================================
 * Lab 05: Agent Audit Trail on HCS (HCS-28 Concepts)
 * [CONCEPT] HCS-2 Agent Directory + Per-Agent Change Topics with Signed Records
 * ============================================================================
 * [ KEY CONCEPT ]
 * HCS-28 (Hashgraph Online, Draft) is the ANS Agent Transparency Registry: an HCS-2
 * directory topic of published agents, one HCS-2 change topic per agent (`t_id`), and
 * publication rules for agent changes, used together with HCS-27 Merkle checkpoints.
 * This lab builds that topology for real on testnet:
 * 1. An indexed HCS-2 directory topic (memo `hcs-2:0:86400`).
 * 2. A per-agent change topic, registered in the directory with an HCS-2 `register`
 *    message (`{"p":"hcs-2","op":"register","t_id":...}`, tx memo `hcs-2:op:0:0`).
 * 3. A signed audit record of one agent decision cycle (prompt/reasoning/tool hashes,
 *    guardrail results) appended to the agent's change topic.
 *
 * [ LEARNABLE MOMENT ]
 * Investigators need a tamper-proof "black box". Hashes + signatures on HCS give
 * ordering, timestamps and non-repudiation without publishing the raw prompt.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-2
 * - https://hol.org/docs/standards/hcs-27/
 * - https://hol.org/standards
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 04: HCS-27 Transparency Log Checkpoints & Cryptographic Merkle Proofs
 * - Next:     M14 Lab 06: Encrypted Autonomous Agent Swarm Chat (ECDH + AES-256-GCM over HCS)
 *
 * [ SIMULATED ]
 * The agent prompt, reasoning and guardrails are canned text, not a live model. The audit-record layout is this lab's own: HCS-28's JWT/hash-input publication rules are not reproduced. The HCS-2 directory, change topic, registration and audit stream on HCS are real.
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
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Builds this lab's agent audit record (its own layout, modelled on HCS-28 concepts).
 *
 * @param {object} params - Cognitive cycle parameters
 * @returns {object} Audit payload with cryptographic signature
 */
const buildHCS28AuditRecord = ({ agentWallet, sessionId, cycleIndex, userPrompt, reasoningTrace, toolInvocations, finalDecision, guardrailChecks }) => {
  const promptHash = ethers.keccak256(ethers.toUtf8Bytes(userPrompt))
  const reasoningHash = ethers.keccak256(ethers.toUtf8Bytes(reasoningTrace))
  const decisionHash = ethers.keccak256(ethers.toUtf8Bytes(finalDecision))

  const auditCore = {
    type: 'agent-audit-record',
    version: '1.0.0',
    concept: 'hcs-28',
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
  const { client } = getClient()

  try {
    // 1. Create HCS-28 Audit Stream Topic
    console.log('[PROCESS] Creating dedicated HCS-28 Cognitive Audit Topic...')
    // Create the topic: an ordered, timestamped message log; a submit key would restrict who can write.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('hcs-2:0:86400')
      .execute(client)

    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    // HCS-2 directory of agents (indexed) + registration of this agent's change topic
    const directoryId = (await (await new TopicCreateTransaction().setTopicMemo('hcs-2:0:86400').execute(client)).getReceipt(client)).topicId.toString()
    const regRes = await new TopicMessageSubmitTransaction().setTopicId(directoryId)
      .setMessage(JSON.stringify({ p: 'hcs-2', op: 'register', t_id: topicId, m: 'agent atlas change topic' }))
      .setTransactionMemo('hcs-2:op:0:0').execute(client)
    await regRes.getReceipt(client)
    console.log(`[SUCCESS] HCS-2 directory ${directoryId}: registered change topic ${topicId} (tx ${regRes.transactionId})`)
    console.log(`[SUCCESS] HCS-28 Audit Topic Deployed: ${topicId}`)

    // 2. Synthesize Autonomous Reasoning Cycle for Financial Risk Agent
    console.log('\n[PROCESS] Simulating autonomous reasoning cycle for Agent Atlas...')
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

    console.log('[LOG] HCS-28 Cognitive Audit Record Generated:')
    console.log(`[LOG] Session ID:     ${auditRecord.sessionId} (Cycle #${auditRecord.cycleIndex})`)
    console.log(`[LOG] Agent Address:  ${auditRecord.agentAddress}`)
    console.log(`[LOG] Prompt Hash:    ${auditRecord.hashes.prompt}`)
    console.log(`[LOG] Reasoning Hash: ${auditRecord.hashes.reasoning}`)
    console.log(`[LOG] Guardrails:     ${auditRecord.guardrails.passed ? 'ALL PASSED (COMPLIANT)' : 'VIOLATION'}`)
    console.log(`[LOG] Record Hash:    ${auditRecord.recordHash}`)

    // 3. Commit Audit Record to HCS Consensus
    console.log('\n[PROCESS] Anchoring immutable record to HCS consensus topic...')
    // Publish: consensus gives the message a sequence number and a timestamp everyone agrees on.
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(auditRecord))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    const seq = submitReceipt.topicSequenceNumber.toString()
    console.log(`[SUCCESS] Audit Record Sealed at Consensus Sequence #${seq}`)

    // 4. Verification of Agent Non-Repudiation Signature
    const recoveredAgent = ethers.recoverAddress(auditRecord.recordHash, auditRecord.agentSignature)
    const isAuthentic = recoveredAgent.toLowerCase() === agentWallet.address.toLowerCase()
    console.log(`\n[AUDIT] Agent Non-Repudiation Check: ${isAuthentic ? 'AUTHENTIC (SIGNED BY AGENT)' : 'FORGERY'}`)

    // Persist state
    updateState('HCS28_TOPIC_ID', topicId)
    updateState('HCS28_DIRECTORY_TOPIC_ID', directoryId)
    updateState('HCS28_SESSION_ID', auditRecord.sessionId)
    updateState('HCS28_RECORD_HASH', auditRecord.recordHash)
    updateState('HCS28_AGENT_ADDRESS', agentWallet.address)

    console.log('\n KEY CONCEPT:')
    console.log('HCS-28 solves the accountability problem in artificial intelligence.')
    console.log('Because the audit record is cryptographically signed and sequenced on Hedera,')
    console.log('no developer or AI agent can alter history to conceal a financial loss or bug.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Enterprise AI governance does not require slowing down autonomous execution;')
    console.log('it requires immutable cryptographic auditability at consensus speed.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] HCS-28 Execution Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
