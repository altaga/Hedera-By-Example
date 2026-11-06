/**
 * ============================================================================
 * Lab 02: HCS-25 AI Trust Score Methodology
 * [CONCEPT] Deterministic, Explainable Trust Scores for AI Agents
 * ============================================================================
 * [ KEY CONCEPT ]
 * HCS-25 (Hashgraph Online, Draft v1.0) defines HOW to compute an AI Trust Score,
 * not where to store it:
 * 1. Trust adapters turn signals into components in [0,100], each with a status
 *    (ok | missing | timeout | error | stale). Missing/timeout/error -> 0; stale is
 *    multiplied by m_stale.
 * 2. Adapter total = mean of its components.
 * 3. Contribution modes decide the denominator: `universal` and `scoped` always count
 *    when applicable (missing output -> defaultComponentKey = 0); `conditional` counts
 *    only when it produced components. Weight 0 = informational only.
 * 4. trustScores.total = round2( Σ w·total / Σ w ), plus trustScoreUpdatedAt and
 *    trustScoreConfigVersion.
 * This lab implements that algorithm, checks it against the spec's two test vectors
 * (57.5 and 63.33), scores an agent, and publishes the explainable result on HCS.
 *
 * [ LEARNABLE MOMENT ]
 * A score is only comparable with another score of the same trustScoreConfigVersion.
 * Publishing the breakdown and config version makes it reproducible by anyone.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-25
 * - https://hol.org/docs/standards/hcs-14
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 01: HCS-20 Auditable Points & Inscription Ledgers
 * - Next:     M14 Lab 03: HCS-26 Decentralized Agent Skills & Tool Manifest Registry
 *
 * [ SIMULATED ]
 * The agent's signal values are sample data. HCS-25 does not define a storage format, so the HCS record layout (and the evaluator signatures) are this lab's choice. The algorithm and the HCS publication are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M14_Advanced_HCS_Standards_AI/02_hcs25_ai_trust_score.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

const round2 = (x) => Math.round(x * 100) / 100
const clamp = (x) => Math.min(100, Math.max(0, x))

/**
 * HCS-25 composite score. `adapters`: [{ adapterId, weight=1, contributionMode='conditional',
 * applicable=true, defaultComponentKey, components: { key: { value, status } } }]
 */
const computeTrustScore = (adapters, { mStale = 1, configVersion = 1 } = {}) => {
  const breakdown = {}
  let num = 0
  let den = 0
  for (const a of adapters) {
    const weight = a.weight ?? 1
    const mode = a.contributionMode ?? 'conditional'
    if (a.applicable === false || weight === 0) continue
    const comps = {}
    for (const [key, c] of Object.entries(a.components || {})) {
      if (['missing', 'timeout', 'error'].includes(c.status) && c.nonScorableWhenUnavailable) continue
      comps[key] = c.status === 'ok' ? clamp(c.value) : c.status === 'stale' ? clamp(c.value * mStale) : 0
    }
    let keys = Object.keys(comps)
    if (!keys.length) {
      if (mode === 'conditional') continue
      comps[a.defaultComponentKey || `${a.adapterId}.score`] = 0
      keys = Object.keys(comps)
    }
    const total = round2(keys.reduce((s, k) => s + comps[k], 0) / keys.length)
    Object.assign(breakdown, comps)
    breakdown[`${a.adapterId}.total`] = total
    num += total * weight
    den += weight
  }
  return {
    trustScores: { total: den ? round2(num / den) : 0, ...breakdown },
    trustScoreUpdatedAt: new Date().toISOString(),
    trustScoreConfigVersion: configVersion
  }
}

// Spec test vectors (HCS-25 "Test Vectors")
const vectorAdapters = (reputationMode, reputationMissing) => [
  { adapterId: 'availability', weight: 1, contributionMode: 'scoped', components: { 'availability.uptime': { value: 90, status: 'ok' } } },
  { adapterId: 'simple_evals', weight: 2, contributionMode: 'scoped', components: { 'simple_evals.math': { value: 100, status: 'ok' }, 'simple_evals.science': { value: 0, status: 'missing' } } },
  { adapterId: 'reputation', weight: 1, contributionMode: reputationMode, components: reputationMissing ? {} : { 'reputation.stars': { value: 40, status: 'ok' } } }
]

const main = async () => {
  console.log('--- SESSION START: HCS-25 AI Trust Score Methodology ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Conformance against the spec test vectors
    console.log('[PROCESS] Step 1: Checking the implementation against the HCS-25 test vectors...')
    const tv1 = computeTrustScore(vectorAdapters('scoped', false)).trustScores.total
    const tv2 = computeTrustScore(vectorAdapters('conditional', true)).trustScores.total
    console.log(`[VERIFY] Test Vector 1 (scoped, missingness penalized): ${tv1} (expected 57.5) -> ${tv1 === 57.5 ? 'PASS' : 'FAIL'}`)
    console.log(`[VERIFY] Test Vector 2 (conditional, sparse ignored):  ${tv2} (expected 63.33) -> ${tv2 === 63.33 ? 'PASS' : 'FAIL'}`)
    if (tv1 !== 57.5 || tv2 !== 63.33) throw new Error('HCS-25 test vectors failed')

    // 2. Score an agent (sample signals)
    console.log('\n[PROCESS] Step 2: Scoring an agent from a signal snapshot...')
    const subject = { uaid: `hedera:testnet:${operatorId}`, registry: 'hashgraph-online', protocol: 'hcs-10' }
    const result = computeTrustScore([
      { adapterId: 'availability', weight: 1, contributionMode: 'universal', components: { 'availability.uptime': { value: 99.4, status: 'ok' }, 'availability.latency': { value: 87, status: 'stale' } } },
      { adapterId: 'simple-math', weight: 0.5, contributionMode: 'scoped', components: { 'simple-math.score': { value: 96, status: 'ok' } } },
      { adapterId: 'x402', weight: 1, contributionMode: 'scoped', components: { 'x402.volume': { value: 0, status: 'timeout' } } },
      { adapterId: 'oss-popularity', weight: 0.7, contributionMode: 'conditional', components: {} },
      { adapterId: 'erc8004-feedback', weight: 1, contributionMode: 'scoped', applicable: false }
    ], { mStale: 0.8, configVersion: 3 })
    for (const [k, v] of Object.entries(result.trustScores)) console.log(`[LOG] ${k.padEnd(24)} ${v}`)

    // 3. Evaluators sign the record (lab choice; HCS-25 leaves transport/storage open)
    const record = { p: 'hcs-25', subject, ...result }
    const digest = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(record)))
    const evaluators = [ethers.Wallet.createRandom(), ethers.Wallet.createRandom()]
    const endorsements = evaluators.map(w => ({ evaluator: w.address, signature: w.signingKey.sign(digest).serialized }))
    const valid = endorsements.filter(e => ethers.recoverAddress(digest, e.signature) === e.evaluator).length
    console.log(`\n[VERIFY] Evaluator signatures valid: ${valid}/${endorsements.length}`)

    // 4. Publish on HCS
    console.log('\n[PROCESS] Step 4: Publishing the explainable score record on HCS...')
    const topicId = (await (await new TopicCreateTransaction().setTopicMemo('hbe:hcs-25-trust-scores').execute(client)).getReceipt(client)).topicId
    const res = await new TopicMessageSubmitTransaction().setTopicId(topicId)
      .setMessage(JSON.stringify({ ...record, digest, endorsements })).execute(client)
    const receipt = await res.getReceipt(client)
    console.log(`[SUCCESS] Topic ${topicId} seq #${receipt.topicSequenceNumber} — ${getHashscanUrl(res)}`)

    updateState('HCS25_TOPIC_ID', topicId.toString())
    updateState('HCS25_COMPOSITE_SCORE', result.trustScores.total)

    console.log('\n KEY CONCEPT:')
    console.log('Same snapshot + same config version = same score, with a full breakdown anyone can check.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] HCS-25 Execution Failure:', error.message)
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
