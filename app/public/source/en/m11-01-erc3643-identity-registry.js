/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Permissioned RWA Transfers — Identity Registry + HTS KYC (ERC-3643 Concepts)
 * [CONCEPT] Ledger-Enforced Transfer Restrictions for Regulated Assets
 * ============================================================================
 * [ KEY CONCEPT ]
 * Regulated assets cannot move permissionlessly. ERC-3643 (T-REX) solves this on
 * EVM chains by checking an on-chain Identity Registry inside every transfer.
 * Hedera's native Token Service offers a ledger-level equivalent of the core rule:
 * a token created with a KYC key can only move between accounts whose KYC flag the
 * issuer granted. This lab:
 * 1. Creates a real HTS security token with KYC, freeze and wipe keys.
 * 2. Evaluates investor claims (KYC, jurisdiction, accreditation) in an issuer
 *    compliance agent and grants on-chain KYC only to eligible accounts.
 * 3. Sends real transfers: the eligible investor receives tokens; transfers to the
 *    unverified and sanctioned investors are REJECTED BY THE NETWORK
 *    (ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN), not by JavaScript.
 * 4. Anchors every compliance decision to an HCS audit topic.
 *
 * [ LEARNABLE MOMENT ]
 * HTS KYC gives you consensus-enforced allow-listing without any contract. Full
 * ERC-3643 (ONCHAINID claims, modular compliance, recovery, forced transfers) is
 * what Hedera's Asset Tokenization Studio (ATS) implements with smart contracts —
 * this lab does NOT deploy ERC-3643 or ATS; use ATS for production security tokens.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/enable-kyc-account-flag
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/define-a-token
 * - https://github.com/hashgraph/asset-tokenization-studio
 * - https://erc3643.org/
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 07: Live AI Streaming Proxy Gateway
 * - Next:     M11 Lab 02: Tranche Bonds on HTS (ERC-1400 Concepts)
 *
 * [SEQUENCE]
 * Issuer -> Hedera: Create security token with KYC key
 * Issuer -> Issuer: Compliance agent checks investor claims
 * Issuer -> Hedera: Grant KYC only to eligible investors
 * Issuer -> Hedera: Transfer to each investor
 * Note Hedera: Transfers to accounts without KYC fail at consensus
 * Issuer -> Hedera: Anchor decisions on HCS
 *
 * [SIMULATED]
 * The investor claims (country, accreditation) are local sample data and no ERC-3643/ATS contracts are deployed. The token, the KYC grants, the accepted and rejected transfers and the HCS audit trail are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (creates 3 throwaway investor accounts, a token and a topic).
 * - Cost: ~0.3 ℏ funded to throwaway accounts + ~2 ℏ in fees.
 *
 * [ HOW TO RUN ]
 * node English/M11_Hedera_Studios_RWA/01_erc3643_identity_registry.js
 * ============================================================================
 */

import {
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenGrantKycTransaction,
  TokenSupplyType,
  TokenType,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { createLabAccount, getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

class Erc3643ComplianceEngine {
  constructor () {
    this.identityRegistry = new Map()
    this.sanctionedCountries = new Set(['PRK', 'IRN', 'SYR'])
    this.approvedJurisdictions = new Set(['USA', 'CHE', 'SGP', 'IND', 'GBR'])
  }

  registerInvestor (investorId, claims) {
    this.identityRegistry.set(investorId, {
      did: `did:hedera:testnet:${investorId}`,
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
  console.log('--- SESSION START: Permissioned RWA Transfers (Identity Registry + HTS KYC) ---\n')
  const { client, operatorId, operatorKey } = getClient()

  try {
    const compliance = new Erc3643ComplianceEngine()
    const issuerKey = client.operatorPublicKey

    // 1. Real investor accounts
    console.log('[PROCESS] Step 1: Creating 3 throwaway investor accounts...')
    const investors = {
      B: { ...(await createLabAccount(client, { hbar: 0.1, autoAssociations: 0 })), claims: { isKycVerified: true, countryCode: 'CHE', isAccredited: true } },
      C: { ...(await createLabAccount(client, { hbar: 0.1, autoAssociations: 0 })), claims: { isKycVerified: false, countryCode: 'IND', isAccredited: false } },
      D: { ...(await createLabAccount(client, { hbar: 0.1, autoAssociations: 0 })), claims: { isKycVerified: true, countryCode: 'PRK', isAccredited: false } }
    }
    compliance.registerInvestor(operatorId.toString(), { isKycVerified: true, countryCode: 'USA', isAccredited: true })
    for (const [name, inv] of Object.entries(investors)) {
      compliance.registerInvestor(inv.accountId.toString(), inv.claims)
      console.log(`[LOG] Investor ${name} ${inv.accountId}: ${inv.claims.countryCode} | KYC claim: ${inv.claims.isKycVerified} | Accredited: ${inv.claims.isAccredited}`)
    }

    // 2. Real security token with a KYC key
    console.log('\n[PROCESS] Step 2: Creating a permissioned HTS security token (KYC + freeze + wipe keys)...')
    const tokenReceipt = await (await new TokenCreateTransaction()
      .setTokenName('HBE Permissioned Equity')
      .setTokenSymbol('HBEQ')
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(0)
      .setInitialSupply(100000)
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(100000)
      .setTreasuryAccountId(operatorId)
      .setAdminKey(issuerKey)
      .setKycKey(issuerKey)
      .setFreezeKey(issuerKey)
      .setWipeKey(issuerKey)
      .execute(client)).getReceipt(client)
    const tokenId = tokenReceipt.tokenId
    console.log(`[SUCCESS] Token ${tokenId} created (treasury KYC is implicit)`)

    // Investors associate the token (each signs its own association)
    for (const inv of Object.values(investors)) {
      const tx = await new TokenAssociateTransaction().setAccountId(inv.accountId).setTokenIds([tokenId]).freezeWith(client).sign(inv.privateKey)
      await (await tx.execute(client)).getReceipt(client)
    }

    // 3. Compliance agent decides; KYC is granted on-chain only to eligible investors
    console.log('\n[PROCESS] Step 3: Compliance agent evaluates claims and grants on-chain KYC...')
    const decisions = []
    for (const [name, inv] of Object.entries(investors)) {
      const check = compliance.canTransfer(operatorId.toString(), inv.accountId.toString(), 5000)
      if (check.allowed) {
        const grant = await new TokenGrantKycTransaction().setAccountId(inv.accountId).setTokenId(tokenId).execute(client)
        await grant.getReceipt(client)
        console.log(`[KYC GRANTED] Investor ${name} ${inv.accountId} — ${grant.transactionId}`)
      } else {
        console.log(`[KYC DENIED]  Investor ${name} ${inv.accountId} — ${check.error}`)
      }
      decisions.push({ investor: inv.accountId.toString(), kyc: check.allowed, reason: check.error })
    }

    // 4. Real transfers: the ledger enforces the KYC flag
    console.log('\n[PROCESS] Step 4: Sending 5,000 units to each investor (the network enforces KYC)...')
    const results = []
    for (const [name, inv] of Object.entries(investors)) {
      let status
      try {
        const res = await new TransferTransaction()
          .addTokenTransfer(tokenId, operatorId, -5000)
          .addTokenTransfer(tokenId, inv.accountId, 5000)
          .execute(client)
        status = (await res.getReceipt(client)).status.toString()
        console.log(`[ACCEPTED] -> ${name} ${inv.accountId}: ${status} | ${getHashscanUrl(res)}`)
      } catch (err) {
        status = err.status ? err.status.toString() : err.message
        console.log(`[REJECTED BY NETWORK] -> ${name} ${inv.accountId}: ${status}`)
      }
      results.push({ investor: inv.accountId.toString(), status })
    }
    if (!results.some((r) => r.status === 'SUCCESS') || !results.some((r) => r.status.includes('KYC_NOT_GRANTED'))) {
      throw new Error('Expected one accepted transfer and KYC rejections from the network')
    }

    // 5. Anchor the compliance trail to HCS
    console.log('\n[PROCESS] Step 5: Anchoring the compliance decisions to an HCS audit topic...')
    const topicReceipt = await (await new TopicCreateTransaction().setTopicMemo('hbe:rwa-compliance-audit').execute(client)).getReceipt(client)
    const complianceTopicId = topicReceipt.topicId.toString()
    await (await new TopicMessageSubmitTransaction()
      .setTopicId(complianceTopicId)
      .setMessage(JSON.stringify({ type: 'rwa-compliance-audit', token: tokenId.toString(), decisions, results, timestamp: new Date().toISOString() }))
      .execute(client)).getReceipt(client)
    console.log(`[SUCCESS] Audit trail on HCS topic ${complianceTopicId}`)

    updateState('ATS_COMPLIANCE_TOPIC_ID', complianceTopicId)
    updateState('RWA_PERMISSIONED_TOKEN_ID', tokenId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('The rejected transfers were refused by consensus because the recipients had no')
    console.log('KYC grant for this token — compliance enforced by the ledger, not by app code.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Permissioned transfer lab failed:', error.message)
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
