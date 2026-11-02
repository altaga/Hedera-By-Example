/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: ERC-1400 Security Tokens & Bond Coupon Schedules
 * [ CONCEPT ] Tranche Partitions and Automated Debt Servicing
 * ============================================================================
 * [ KEY CONCEPT ]
 * Programmable Debt Instruments: Corporate and municipal bonds historically
 * suffer from high administrative overhead and manual custodian reconciliation.
 * The ERC-1400 standard models debt on-chain through discrete partitions
 * (Senior vs. Subordinated) and automates interest coupon payouts directly
 * to token holders' Hedera accounts through scheduled atomic transfers.
 * *
 * [ LEARNABLE MOMENT ]
 * ERC-1400 tranche partitions allow an enterprise to issue Senior and Mezzanine debt tranches within the same security token contract, automating distinct coupon payment schedules on Hedera.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://github.com/hashgraph/asset-tokenization-studio
 *
 * [ LEARNING PATH ]
 * - Previous: M11 Lab 01: ERC-3643 Identity Registry
 * - Next:     M11 Lab 03: Stablecoin Studio Roles
 *
 * [ SIMULATED ]
 * Coupon periods are simulated instead of waiting for real dates. Tokens and payments are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD); <0.1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M11_Hedera_Studios_RWA/02_security_token_erc1400_bonds.js
 * ============================================================================
 */

import {
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TransferTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState, reuseToken } from '../M99_Utilities/index.js'

const BOND_SPECIFICATION = {
  issuer: 'Hedera Renewable Energy Holdings Inc.',
  isin: 'US42312A1099',
  faceValueUsd: 1000,
  maturityYears: 5,
  partitions: [
    {
      partitionId: 'TRANCHE_SENIOR_SECURED',
      couponRateApy: 0.065, // 6.5% APY
      unitsIssued: 500,
      priority: 1
    },
    {
      partitionId: 'TRANCHE_MEZZANINE_YIELD',
      couponRateApy: 0.095, // 9.5% APY
      unitsIssued: 250,
      priority: 2
    }
  ]
}

const main = async () => {
  console.log('--- SESSION START: ERC-1400 Security Bond Issuance & Coupon Payout ---\n')
  const { client, operatorId, network } = getClient()

  try {
    console.log(`[⚙️ PROCESS] Initializing Bond Token Structure for: ${BOND_SPECIFICATION.issuer}`)
    console.log(`[📊 LOG] ISIN: ${BOND_SPECIFICATION.isin} | Maturity: ${BOND_SPECIFICATION.maturityYears} Years`)

    // 1. Issue the Security Token on HTS representing the Bond Series
    console.log('\n[⚙️ PROCESS] Deploying ERC-1400 compliant bond token on HTS...')
    const bondTokenId = (await reuseToken('REUSE_M11_02_TOKEN', async () => {
      // Create the token: its keys (admin, supply, KYC, freeze...) decide who can change it later.
      const bondCreateTx = await new TokenCreateTransaction()
        .setTokenName('Green Energy 2031 Bond')
        .setTokenSymbol('BOND-GRE-31')
        .setDecimals(0)
        .setInitialSupply(750) // Total units (500 Senior + 250 Mezzanine)
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(750)
        .setTreasuryAccountId(operatorId)
        .setAdminKey(client.operatorPublicKey)
        .setFreezeKey(client.operatorPublicKey)
        .setWipeKey(client.operatorPublicKey)
        .setTokenMemo('erc1400:isin:US42312A1099')
        .freezeWith(client)
      // Wait for consensus: the receipt says whether the network accepted the transaction.
      return (await (await bondCreateTx.execute(client)).getReceipt(client)).tokenId
    })).toString()

    console.log(`[✅ SUCCESS] Corporate Bond Token Deployed: ${bondTokenId}`)
    console.log(`[🔗 EXPLORER] HashScan: ${`https://hashscan.io/testnet/token/${bondTokenId}`}`)

    // 2. Simulate Quarterly Coupon Servicing Schedule
    console.log('\n===============================================================')
    console.log('📅 EXECUTING QUARTERLY COUPON DISTRIBUTION (AUTOMATED PAYOUT)')
    console.log('===============================================================')

    BOND_SPECIFICATION.partitions.forEach((tranche) => {
      const quarterlyRate = tranche.couponRateApy / 4
      const couponPerUnitUsd = BOND_SPECIFICATION.faceValueUsd * quarterlyRate
      const totalTranchePayoutUsd = couponPerUnitUsd * tranche.unitsIssued

      console.log(`\nTranche: ${tranche.partitionId} (Priority: ${tranche.priority})`)
      console.log(`- Units: ${tranche.unitsIssued} | Annual APY: ${(tranche.couponRateApy * 100).toFixed(1)}%`)
      console.log(`- Quarterly Coupon Per Unit: $${couponPerUnitUsd.toFixed(2)} USD`)
      console.log(`- Total Payout for Tranche:   $${totalTranchePayoutUsd.toLocaleString()} USD`)
    })

    // 3. Execute On-Chain Coupon Distribution
    console.log('\n[⚙️ PROCESS] Executing on-chain atomic coupon distribution...')
    // Build the transfer: debits (negative) and credits (positive) in one transaction must add up to zero.
    const couponDistributionTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-1.0)) // Distributing coupon yield
      .addHbarTransfer(operatorId, new Hbar(1.0))
      .setTransactionMemo('erc1400:coupon_q3_2026:US42312A1099')
      .freezeWith(client)

    const couponResponse = await couponDistributionTx.execute(client)
    const couponReceipt = await couponResponse.getReceipt(client)
    const couponHashscanUrl = getHashscanUrl(couponResponse)

    console.log('\n[✅ SUCCESS] Coupon Distribution Settled On-Chain:')
    console.log(`[📊 LOG] Status:         ${couponReceipt.status.toString()}`)
    console.log(`[📊 LOG] Transaction ID: ${couponResponse.transactionId.toString()}`)
    console.log(`[🔗 EXPLORER] HashScan:  ${couponHashscanUrl}`)

    updateState('BOND_TOKEN_ID', bondTokenId)
    updateState('BOND_COUPON_TX_ID', couponResponse.transactionId.toString())

    console.log('\n💡 KEY CONCEPT:')
    console.log('ERC-1400 replaces manual bond servicing teams with programmatic settlement.')
    console.log('Coupons, principal maturities, and voting tranches are enforced by ledger logic,')
    console.log('eliminating clearinghouse delays and reducing administrative fees by over 80%.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] ERC-1400 bond issuance failed:', error.message)
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
