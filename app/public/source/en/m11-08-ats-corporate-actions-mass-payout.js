/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 08: Asset Tokenization Studio — Corporate Actions & Mass Payout Engine
 * [ CONCEPT ] Cap Table Consensus Snapshots, Dividend Engines & Batch Settlement
 * ============================================================================
 * [ KEY CONCEPT ]
 * In the official Hedera Asset Tokenization Studio (ATS) architecture
 * (packages/mass-payout & packages/ats/contracts), security tokens and real-world
 * assets (RWAs) are not static instruments. Throughout their lifecycle, issuers
 * must execute regulated Corporate Actions:
 * 1. Dividend Distributions (Equity & Fund units)
 * 2. Coupon Payments (Debt & Bond tranches)
 * 3. Cap Table Snapshotting at an immutable Hedera consensus timestamp.
 *
 * Traditional finance incurs days of settlement delays and millions in intermediary
 * fees to reconcile dividend payments across custodian banks.
 *
 * ATS solves this with an atomic, auditable Mass Payout pipeline:
 * - Consensus Timestamp Snapshot: Freezes cap table balances at an exact point in time.
 * - Prorated Dividend Engine: Calculates pro-rata entitlements and withholding logic.
 * - Atomic Multi-Party Settlement: Executes a single batch transfer transaction where
 *   all investor payouts settle simultaneously with sub-second finality.
 * - HCS Regulatory Certification: Anchors an immutable audit trail to Hedera Consensus
 *   Service for SEC, FINRA, or MiCA regulatory examination.
 *
 * [ LEARNABLE MOMENT ]
 * Never disperse institutional dividends using looping individual transfers. A network
 * failure or timeout halfway through a loop creates partial settlement insolvency.
 * On Hedera, batch transfers inside an atomic `TransferTransaction` guarantee that
 * either ALL investors are paid simultaneously, or none are.
 *
 * [ LEARNING PATH ]
 * - Previous: M11 Lab 07: Institutional ERP Invoicing Bridge
 * - Next:     M12 Lab 01: Modern EVM Tooling with Viem & Foundry
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Run first: M11 Lab 01 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M11_Hedera_Studios_RWA/08_ats_corporate_actions_mass_payout.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  AccountId,
  Hbar,
  Timestamp,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import {
  getClient,
  getHashscanUrl,
  getState,
  updateState
} from '../M99_Utilities/index.js'

/**
 * 1. ATS Cap Table Snapshot Engine
 * Captures token ownership across investor wallets at consensus timestamp.
 */
class AtsCapTableSnapshotEngine {
  constructor (securityTokenSymbol, recordTimestamp) {
    this.securityTokenSymbol = securityTokenSymbol
    this.recordTimestamp = recordTimestamp
    this.investors = []
  }

  registerShareholder (accountId, name, tranche, sharesHeld, jurisdiction) {
    this.investors.push({
      accountId: accountId.toString(),
      name,
      tranche, // Senior Tranche, Mezzanine, or Common Equity
      sharesHeld: BigInt(sharesHeld),
      jurisdiction
    })
  }

  generateSnapshot () {
    const totalShares = this.investors.reduce((sum, inv) => sum + inv.sharesHeld, 0n)

    const capTable = this.investors.map((inv) => {
      const ownershipRatio = Number(inv.sharesHeld) / Number(totalShares)
      return {
        ...inv,
        ownershipPercentage: (ownershipRatio * 100).toFixed(2) + '%',
        ownershipRatio
      }
    })

    return {
      recordTimestamp: this.recordTimestamp,
      securityToken: this.securityTokenSymbol,
      totalShares: totalShares.toString(),
      totalHolders: capTable.length,
      capTable
    }
  }
}

/**
 * 2. Prorated Corporate Action Calculation Engine
 * Calculates net dividend/coupon entitlements per shareholder.
 */
class AtsDividendCalculationEngine {
  constructor (totalDividendBudgetTinybars, currencySymbol = 'HBAR') {
    this.totalDividendBudget = BigInt(totalDividendBudgetTinybars)
    this.currencySymbol = currencySymbol
  }

  computePayouts (snapshot) {
    const totalShares = BigInt(snapshot.totalShares)
    let totalAllocated = 0n

    const payouts = snapshot.capTable.map((holder) => {
      // Pro-rata entitlement: (holderShares * totalBudget) / totalShares
      const grossEntitlement = (holder.sharesHeld * this.totalDividendBudget) / totalShares

      // ATS Compliance Rule: Apply withholding tax for international non-domestic tranches
      let withholdingRate = 0.0
      if (holder.jurisdiction !== 'US' && holder.jurisdiction !== 'DOMESTIC') {
        withholdingRate = 0.15 // 15% cross-border withholding tax
      }

      const withholdingAmount = BigInt(Math.floor(Number(grossEntitlement) * withholdingRate))
      const netPayout = grossEntitlement - withholdingAmount
      totalAllocated += netPayout

      return {
        accountId: holder.accountId,
        name: holder.name,
        tranche: holder.tranche,
        sharesHeld: holder.sharesHeld.toString(),
        grossEntitlementTinybars: grossEntitlement.toString(),
        withholdingRate: (withholdingRate * 100).toFixed(1) + '%',
        withholdingTinybars: withholdingAmount.toString(),
        netPayoutTinybars: netPayout.toString(),
        netPayoutHbar: (Number(netPayout) / 100000000).toFixed(6)
      }
    })

    return {
      totalBudgetTinybars: this.totalDividendBudget.toString(),
      totalNetDispersedTinybars: totalAllocated.toString(),
      payouts
    }
  }
}

const main = async () => {
  console.log('====================================================================')
  console.log('🏛️ ASSET TOKENIZATION STUDIO: CORPORATE ACTIONS & MASS PAYOUT ENGINE')
  console.log('====================================================================\n')

  const { client, operatorId, operatorKey } = getClient()

  // 1. Configure the ATS Security Asset & Investor Cap Table
  const securityTokenSymbol = 'ATS-TREX-BOND-2027'
  const recordTimestamp = Timestamp.fromDate(new Date()).toString()

  console.log('[1/4] 📸 Generating Consensus Cap Table Snapshot for Corporate Action...')
  const snapshotEngine = new AtsCapTableSnapshotEngine(securityTokenSymbol, recordTimestamp)

  // Register institutional investor accounts
  const investor1 = process.env.ACCOUNT_1_ID || '0.0.11226623'
  const investor2 = process.env.ACCOUNT_2_ID || '0.0.8707881'

  snapshotEngine.registerShareholder(investor1, 'Acme Institutional Fund LP', 'Senior Debt Tranche A', 600000, 'US')
  snapshotEngine.registerShareholder(investor2, 'Zurich Global Wealth AG', 'Senior Debt Tranche A', 400000, 'CH')

  const snapshot = snapshotEngine.generateSnapshot()
  console.log(`   Security Token:    ${snapshot.securityToken}`)
  console.log(`   Record Timestamp:  ${snapshot.recordTimestamp}`)
  console.log(`   Total Shares:      ${snapshot.totalShares}`)
  console.log(`   Registered Holders:${snapshot.totalHolders}`)
  snapshot.capTable.forEach((h) => {
    console.log(`     • ${h.name} (${h.accountId}): ${h.sharesHeld} shares (${h.ownershipPercentage}) [${h.jurisdiction}]`)
  })
  console.log()

  // 2. Compute Prorated Corporate Action Dividend / Coupon Payouts
  // Dividend pool: 2.0 HBAR total mass payout across testnet investors
  const totalDividendPool = Hbar.from(2.0).toTinybars()
  console.log('[2/4] 🧮 Executing ATS Prorated Dividend Calculation Engine...')
  const calcEngine = new AtsDividendCalculationEngine(totalDividendPool.toString(), 'HBAR')
  const distributionPlan = calcEngine.computePayouts(snapshot)

  console.log(`   Total Dividend Pool:   ${Hbar.fromTinybars(distributionPlan.totalBudgetTinybars).toString()}`)
  console.log(`   Total Net Dispersal:   ${Hbar.fromTinybars(distributionPlan.totalNetDispersedTinybars).toString()}`)
  distributionPlan.payouts.forEach((p) => {
    console.log(`     → Payout to ${p.name} (${p.accountId}):`)
    console.log(`        Gross: ${p.grossEntitlementTinybars} tinybars | Tax: ${p.withholdingRate} | Net: ${p.netPayoutHbar} HBAR`)
  })
  console.log()

  // 3. Execute Atomic Mass Payout Batch Settlement on Hedera
  console.log('[3/4] ⚡ Executing Atomic Multi-Party Mass Payout on Hedera Consensus...')
  const netLegs = distributionPlan.payouts.map((p) => ({
    account: AccountId.fromString(p.accountId),
    tinybars: BigInt(p.netPayoutTinybars),
    amount: Hbar.fromTinybars(BigInt(p.netPayoutTinybars))
  }))

  const totalDeductedTinybars = netLegs.reduce((sum, leg) => sum + leg.tinybars, 0n)
  const totalDeducted = Hbar.fromTinybars(totalDeductedTinybars)

  // Construct single atomic multi-leg transfer transaction
  let massPayoutTx = new TransferTransaction()
    // Debit treasury operator for full amount
    .addHbarTransfer(operatorId, Hbar.fromTinybars(-totalDeductedTinybars))

  // Credit each investor simultaneously
  for (const leg of netLegs) {
    massPayoutTx = massPayoutTx.addHbarTransfer(leg.account, leg.amount)
  }

  const massPayoutSubmit = await massPayoutTx.freezeWith(client).execute(client)
  const massPayoutReceipt = await massPayoutSubmit.getReceipt(client)

  console.log(`   ✅ Atomic Mass Payout Settled: ${massPayoutReceipt.status.toString()}`)
  console.log(`   🔗 Transaction ID: ${massPayoutSubmit.transactionId.toString()}`)
  console.log(`   🔗 Hashscan URL:   ${getHashscanUrl(massPayoutSubmit.transactionId.toString())}\n`)

  // 4. Emit ATS Regulatory Compliance Audit Certificate to HCS
  console.log('[4/4] 📜 Anchoring ATS Regulatory Audit Certificate to Consensus Service...')
  let complianceTopicId = getState('ATS_COMPLIANCE_TOPIC_ID')

  if (!complianceTopicId) {
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('ATS Corporate Actions Compliance Log')
      .execute(client)
    const topicRx = await topicTx.getReceipt(client)
    complianceTopicId = topicRx.topicId.toString()
    updateState('ATS_COMPLIANCE_TOPIC_ID', complianceTopicId)
  }

  const auditPayload = {
    standard: 'ATS-CORPORATE-ACTION-V2',
    actionType: 'DIVIDEND_DISTRIBUTION',
    securityToken: securityTokenSymbol,
    recordConsensusTimestamp: recordTimestamp,
    settlementTransactionId: massPayoutSubmit.transactionId.toString(),
    dividendPoolHbar: Hbar.fromTinybars(distributionPlan.totalBudgetTinybars).toString(),
    netDispersedHbar: totalDeducted.toString(),
    recipientsCount: distributionPlan.payouts.length,
    payoutHash: crypto.createHash('sha256').update(JSON.stringify(distributionPlan)).digest('hex'),
    timestamp: new Date().toISOString()
  }

  const hcsSubmit = await new TopicMessageSubmitTransaction()
    .setTopicId(complianceTopicId)
    .setMessage(JSON.stringify(auditPayload))
    .execute(client)
  const hcsReceipt = await hcsSubmit.getReceipt(client)

  console.log(`   ✅ Audit Certificate Anchored to HCS Topic: ${complianceTopicId}`)
  console.log(`   Consensus Sequence Number: #${hcsReceipt.topicSequenceNumber.toString()}`)
  console.log(`   Audit Payload Hash:        ${auditPayload.payoutHash}`)

  // Persist State
  updateState('ATS_LAST_MASS_PAYOUT_TX_ID', massPayoutSubmit.transactionId.toString())
  updateState('ATS_LAST_CORPORATE_ACTION_DATE', auditPayload.timestamp)

  console.log('\n====================================================================')
  console.log('🎉 ASSET TOKENIZATION STUDIO MASS PAYOUT ENGINE: SETTLED & VERIFIED')
  console.log('====================================================================')

  client.close()
  process.exit()
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
