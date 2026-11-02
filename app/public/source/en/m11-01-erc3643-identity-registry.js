/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: ERC-3643 Identity Registry & Transfer Rules
 * [ CONCEPT ] Permissioned RWA Transfer Restrictions
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Regulatory Gate: Institutional assets cannot move permissionlessly.
 * The ERC-3643 standard (enforced by Hedera's Asset Tokenization Studio)
 * couples every token transfer with an Identity Registry check. If the
 * recipient lacks verified KYC, belongs to a sanctioned jurisdiction, or
 * exceeds investor caps, the transfer is mathematically rejected at the
 * ledger boundary before consensus settlement.
 * *
 * [ LEARNABLE MOMENT ]
 * Vanilla ERC-20 tokens fail regulatory compliance because anyone can transfer to anyone. ERC-3643 (T-REX) enforces that transfers occur exclusively between qualified, KYC-verified ONCHAINID investors.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://erc3643.org/
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 07: Live AI Streaming Proxy Gateway
 * - Next:     M11 Lab 02: ERC-1400 Security Bonds
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M11_Hedera_Studios_RWA/01_erc3643_identity_registry.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

class Erc3643ComplianceEngine {
  constructor () {
    this.identityRegistry = new Map()
    this.sanctionedCountries = new Set(['PRK', 'IRN', 'SYR'])
    this.approvedJurisdictions = new Set(['USA', 'CHE', 'SGP', 'IND', 'GBR'])
  }

  registerInvestor (investorId, claims) {
    this.identityRegistry.set(investorId, {
      did: `did:hedera:testnet:${investorId};onchainid`,
      isKycVerified: claims.isKycVerified || false,
      countryCode: claims.countryCode || 'UNKNOWN',
      isAccredited: claims.isAccredited || false,
      registeredAt: Date.now()
    })
  }

  canTransfer (senderId, recipientId, amount) {
    const sender = this.identityRegistry.get(senderId)
    const recipient = this.identityRegistry.get(recipientId)

    if (!sender || !sender.isKycVerified) {
      return { allowed: false, error: 'COMPLIANCE_ERR_SENDER_NOT_KYC_VERIFIED' }
    }

    if (!recipient) {
      return { allowed: false, error: 'COMPLIANCE_ERR_RECIPIENT_NOT_REGISTERED' }
    }

    if (!recipient.isKycVerified) {
      return { allowed: false, error: 'COMPLIANCE_ERR_RECIPIENT_KYC_MISSING' }
    }

    if (this.sanctionedCountries.has(recipient.countryCode)) {
      return { allowed: false, error: `COMPLIANCE_ERR_SANCTIONED_JURISDICTION_${recipient.countryCode}` }
    }

    if (!this.approvedJurisdictions.has(recipient.countryCode)) {
      return { allowed: false, error: `COMPLIANCE_ERR_UNAPPROVED_JURISDICTION_${recipient.countryCode}` }
    }

    if (!recipient.isAccredited && amount > 10000) {
      return { allowed: false, error: 'COMPLIANCE_ERR_RETAIL_INVESTOR_CAP_EXCEEDED' }
    }

    return { allowed: true, error: null }
  }
}

const main = async () => {
  console.log('--- SESSION START: ERC-3643 Identity Registry & Transfer Rules ---\n')
  const { client, operatorId, network } = getClient()

  try {
    const compliance = new Erc3643ComplianceEngine()

    // 1. Provision On-Chain Identity Records
    console.log('[⚙️ PROCESS] Registering Institutional & Retail Investors into Identity Registry...')

    const investorA = operatorId.toString()
    const investorB = '0.0.700101'
    const investorC = '0.0.700102'
    const investorD = '0.0.700103'

    compliance.registerInvestor(investorA, { isKycVerified: true, countryCode: 'USA', isAccredited: true })
    compliance.registerInvestor(investorB, { isKycVerified: true, countryCode: 'CHE', isAccredited: true })
    compliance.registerInvestor(investorC, { isKycVerified: false, countryCode: 'IND', isAccredited: false }) // Missing KYC
    compliance.registerInvestor(investorD, { isKycVerified: true, countryCode: 'PRK', isAccredited: false }) // Sanctioned

    console.log(`[📊 LOG] Investor A (${investorA}): USA | KYC: OK | Accredited: YES`)
    console.log(`[📊 LOG] Investor B (${investorB}): CHE | KYC: OK | Accredited: YES`)
    console.log(`[📊 LOG] Investor C (${investorC}): IND | KYC: NO | Accredited: NO`)
    console.log(`[📊 LOG] Investor D (${investorD}): PRK | KYC: OK | Accredited: NO\n`)

    // 2. Evaluate Transfer Scenarios
    console.log('--- VALIDATING TRANSFER 1: Investor A -> Investor B ($50,000 Equity) ---')
    const t1 = compliance.canTransfer(investorA, investorB, 50000)
    console.log(`[RESULT] Transfer Allowed: ${t1.allowed} | Reason: Institutional Compliance Satisfied`)

    console.log('\n--- VALIDATING TRANSFER 2: Investor A -> Investor C (Unverified Retail) ---')
    const t2 = compliance.canTransfer(investorA, investorC, 5000)
    console.log(`[RESULT] Transfer Allowed: ${t2.allowed} | Rejection Code: ${t2.error}`)

    console.log('\n--- VALIDATING TRANSFER 3: Investor A -> Investor D (Sanctioned Nation) ---')
    const t3 = compliance.canTransfer(investorA, investorD, 1000)
    console.log(`[RESULT] Transfer Allowed: ${t3.allowed} | Rejection Code: ${t3.error}`)

    // 3. Anchor Identity Registry Events to HCS for Compliance Audit
    console.log('\n[⚙️ PROCESS] Anchoring ERC-3643 Compliance Verification Event to HCS...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('erc3643:compliance_registry_v1')
      .freezeWith(client)
    const topicResponse = await topicTx.execute(client)
    const topicReceipt = await topicResponse.getReceipt(client)
    const complianceTopicId = topicReceipt.topicId.toString()

    const complianceAudit = JSON.stringify({
      standard: 'ERC-3643',
      action: 'TRANSFER_VALIDATION',
      sender: investorA,
      recipient: investorB,
      amount: 50000,
      status: 'APPROVED',
      timestamp: Date.now()
    })

    const msgTx = await new TopicMessageSubmitTransaction()
      .setTopicId(complianceTopicId)
      .setMessage(complianceAudit)
      .freezeWith(client)
    await msgTx.execute(client)

    console.log(`[✅ SUCCESS] Audit Event Recorded on HCS Topic: ${complianceTopicId}`)
    updateState('ATS_COMPLIANCE_TOPIC_ID', complianceTopicId)

    console.log('\n💡 KEY CONCEPT:')
    console.log('ERC-3643 turns compliance from an off-chain legal headache into an on-chain')
    console.log('cryptographic guarantee. The token contract never completes an illegal transfer,')
    console.log('protecting token issuers from regulatory enforcement penalties.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] ERC-3643 validation failed:', error.message)
    process.exit(1)
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
