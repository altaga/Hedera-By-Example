/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: HCS-25 Portable AI Trust Score & Attestation Methodology
 * [CONCEPT] Decentralized Reputation & Trust Vector for Autonomous Agents
 * ============================================================================
 * [ KEY CONCEPT ]
 * Portable AI Reputation: As autonomous agents manage capital, execute trades,
 * and interact with APIs, protocols need a tamper-proof mechanism to evaluate
 * agent reliability. HCS-25 defines a multi-dimensional trust score computed
 * from: (1) Liveness & uptime proofs, (2) Consensus execution accuracy, and
 * (3) Cryptographically signed human/stakeholder feedback.
 * The resulting score is attested on HCS and portable across any blockchain or AI swarm.
 *
 * [ LEARNABLE MOMENT ]
 * Web2 AI reputation is stored in opaque databases (like closed app store reviews).
 * If a rogue agent hallucinates or defaults on a settlement, its HCS-25 score drops
 * permanently on the public ledger, protecting the entire ecosystem.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/
 * - https://hol.org/docs/standards/hcs-26/
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 01: HCS-20 Auditable Points
 * - Next:     M14 Lab 03: HCS-26 Agent Skills Registry
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M14_Advanced_HCS_Standards_AI/02_hcs25_ai_trust_score.js
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
 * Calculates deterministic HCS-25 composite trust score.
 *
 * @param {object} metrics - Vector components (0.00 to 1.00)
 * @returns {number} Score out of 100
 */
const calculateHCS25Score = ({ uptimeRatio, consensusAccuracy, humanFeedbackScore }) => {
  // Weighted methodology: 35% Uptime, 45% Consensus Accuracy, 20% Feedback
  const weighted = (uptimeRatio * 0.35) + (consensusAccuracy * 0.45) + (humanFeedbackScore * 0.20)
  return Math.round(weighted * 100 * 100) / 100 // 2 decimal precision
}

/**
 * Assembles an HCS-25 attestation payload with multi-evaluator cryptographic signatures.
 *
 * @param {object} params - Agent identity, metrics, and evaluator keys
 * @returns {object} Attestation document
 */
const createHCS25Attestation = ({ agentAccountId, epochNumber, metrics, evaluators }) => {
  const score = calculateHCS25Score(metrics)
  const timestamp = new Date().toISOString()

  const attestationCore = {
    standard: 'hcs-25',
    version: '1.0.0',
    agentId: agentAccountId,
    epoch: epochNumber,
    timestamp,
    metrics: {
      uptimeRatio: metrics.uptimeRatio,
      consensusAccuracy: metrics.consensusAccuracy,
      humanFeedbackScore: metrics.humanFeedbackScore
    },
    compositeScore: score,
    trustTier: score >= 90 ? 'TIER_1_SOVEREIGN' : score >= 75 ? 'TIER_2_VERIFIED' : 'TIER_3_PROBATIONARY'
  }

  const documentHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(attestationCore)))

  // Evaluators sign the score document
  const endorsements = evaluators.map(ev => {
    const wallet = new ethers.Wallet(ev.privateKey)
    return {
      evaluatorId: ev.evaluatorId,
      publicKey: wallet.address,
      signature: wallet.signingKey.sign(documentHash).serialized
    }
  })

  return {
    ...attestationCore,
    documentHash,
    endorsements
  }
}

const main = async () => {
  console.log('--- SESSION START: HCS-25 Portable AI Trust Score ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Create HCS-25 Registry Topic
    console.log('[PROCESS] Initializing on-chain HCS-25 Agent Reputation Topic...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-25:AI:TRUST:REGISTRY')
      .execute(client)

    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[SUCCESS] HCS-25 Trust Registry Topic Created: ${topicId}`)

    // 2. Define Autonomous Agent & Performance Metrics
    const targetAgentId = '0.0.8707881'
    const agentMetrics = {
      uptimeRatio: 0.994, // 99.4% uptime in observation window
      consensusAccuracy: 0.982, // 98.2% deterministic consensus adherence
      humanFeedbackScore: 0.940 // 94.0% positive customer satisfaction / review rating
    }

    console.log(`\n[PROCESS] Evaluating metrics for Target Agent (${targetAgentId}):`)
    console.log(`[LOG] Uptime Ratio:         ${(agentMetrics.uptimeRatio * 100).toFixed(2)}%`)
    console.log(`[LOG] Consensus Accuracy:   ${(agentMetrics.consensusAccuracy * 100).toFixed(2)}%`)
    console.log(`[LOG] Human Feedback Score: ${(agentMetrics.humanFeedbackScore * 100).toFixed(2)}%`)

    // 3. Evaluator Quorum Signs Attestation
    const evaluators = [
      { evaluatorId: 'auditor-alpha-sec', privateKey: '0x1111111111111111111111111111111111111111111111111111111111111111' },
      { evaluatorId: 'auditor-hashgraph-dao', privateKey: '0x2222222222222222222222222222222222222222222222222222222222222222' }
    ]

    console.log('\n[PROCESS] Compiling multi-signature HCS-25 attestation document...')
    const attestation = createHCS25Attestation({
      agentAccountId: targetAgentId,
      epochNumber: 42,
      metrics: agentMetrics,
      evaluators
    })

    console.log(`[SUCCESS] Composite Score Calculated: ${attestation.compositeScore} / 100`)
    console.log(`[LOG] Assigned Trust Tier: ${attestation.trustTier}`)
    console.log(`[LOG] Document Hash:       ${attestation.documentHash}`)
    console.log(`[LOG] Endorsement Count:   ${attestation.endorsements.length} independent signatures`)

    // 4. Anchor Attestation to Hedera Consensus Stream
    console.log('\n[PROCESS] Committing HCS-25 Attestation to Hedera Consensus...')
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(attestation))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    const seqNum = submitReceipt.topicSequenceNumber.toString()
    console.log(`[SUCCESS] Attestation Anchored! Consensus Sequence #${seqNum}`)

    // 5. Verification Check against Authorized Evaluator Roster
    const authorizedRoster = new Set(
      evaluators.map(ev => new ethers.Wallet(ev.privateKey).address.toLowerCase())
    )
    let validSigs = 0
    for (const end of attestation.endorsements) {
      const recovered = ethers.recoverAddress(attestation.documentHash, end.signature).toLowerCase()
      if (authorizedRoster.has(recovered) && recovered === end.publicKey.toLowerCase()) {
        validSigs++
      }
    }

    console.log(`\n[AUDIT] Cryptographic Verification: ${validSigs}/${attestation.endorsements.length} Signatures VALID`)

    // Persist state
    updateState('HCS25_TOPIC_ID', topicId)
    updateState('HCS25_AGENT_ID', targetAgentId)
    updateState('HCS25_COMPOSITE_SCORE', attestation.compositeScore)
    updateState('HCS25_TRUST_TIER', attestation.trustTier)

    console.log('\n KEY CONCEPT:')
    console.log('Under HCS-25, an agent\'s creditworthiness is a verifiable on-chain fact.')
    console.log('Lending protocols, automated markets, and other agents can query Topic')
    console.log(`${topicId} to set dynamic collateral ratios and rate limits automatically.`)

    console.log('\n LEARNABLE MOMENT:')
    console.log('Without a cryptographic reputation layer, the autonomous AI agent economy would')
    console.log('collapse under Sybil attacks. HCS acts as the impartial credit bureau of Web3.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] HCS-25 Execution Failure:', error.message)
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
