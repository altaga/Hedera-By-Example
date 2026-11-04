/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: HTS Stablecoin (USDC) Micropayments
 * [CONCEPT] Fractional-Cent Settlements via Hedera Token Service
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Credit Card Paradox: Charging $0.01 for an API request through Stripe
 * or Visa costs $0.30 + 2.9% in interchange fees—a 3,000% overhead that destroys
 * machine-to-machine business models. With Hedera Token Service (HTS), a USDC
 * transfer costs a fixed ~$0.001 USD in network fees, making fractional-cent
 * per-token or per-inference pricing wildly profitable.
 * *
 * [ LEARNABLE MOMENT ]
 * Settling agent API requests in native HTS USDC avoids cryptocurrency price volatility for API providers while maintaining sub-cent settlement fees on Hedera.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/tokens
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 03: Facilitator Settlement
 * - Next:     M10 Lab 05: Financial Guardrails
 *
 * [SEQUENCE]
 * Server -> Agent: 402 challenge priced in USDC ($0.025)
 * Agent -> Hedera: HTS token transfer of 25,000 base units
 * Hedera -> Agent: Receipt SUCCESS
 * Agent -> Server: Retry with the payment transaction ID
 *
 * [SIMULATED]
 * "USDC" is a test token the lab mints, and the payment is a transfer to yourself. Both are real on testnet.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD); <1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/04_usdc_hts_micropayments.js
 * ============================================================================
 */

import {
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TransferTransaction,
  AccountId
} from '@hiero-ledger/sdk'
import { getClient, getState, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HTS Stablecoin (USDC) Micropayment Rail ---\n')
  const { client, operatorId, network } = getClient()

  try {
    let mockUsdcTokenId = getState('X402_MOCK_USDC_TOKEN_ID')

    // 1. Provision or reuse an HTS fungible token representing USDC (6 decimals)
    if (!mockUsdcTokenId) {
      console.log('[PROCESS] Minting HTS testnet mock USDC token (6 decimals)...')
      // Create the token: its keys (admin, supply, KYC, freeze...) decide who can change it later.
      const tokenCreateTx = await new TokenCreateTransaction()
        .setTokenName('Hedera USD Coin')
        .setTokenSymbol('USDC')
        .setDecimals(6)
        .setInitialSupply(1000000 * 1000000) // 1,000,000 USDC
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Infinite)
        .setTreasuryAccountId(operatorId)
        .setAdminKey(client.operatorPublicKey)
        .setSupplyKey(client.operatorPublicKey)
        .freezeWith(client)

      const tokenCreateResponse = await tokenCreateTx.execute(client)
      // Wait for consensus: the receipt says whether the network accepted the transaction.
      const tokenCreateReceipt = await tokenCreateResponse.getReceipt(client)
      mockUsdcTokenId = tokenCreateReceipt.tokenId.toString()
      console.log(`[SUCCESS] HTS USDC Token Created: ${mockUsdcTokenId}`)
      updateState('X402_MOCK_USDC_TOKEN_ID', mockUsdcTokenId)
    } else {
      console.log(`[INFO] Reusing existing HTS USDC Token: ${mockUsdcTokenId}`)
    }

    // 2. Simulate x402 Micropayment: $0.025 USD for a high-performance LLM prompt
    const costUsd = 0.025
    const microUnits = Math.round(costUsd * 1000000) // 25,000 base units

    console.log(`\n[PROCESS] Initiating x402 settlement for $${costUsd} USD (${microUnits} base units)...`)
    console.log(`[LOG] Paying Token: HTS (${mockUsdcTokenId})`)

    // Build the transfer: debits (negative) and credits (positive) in one transaction must add up to zero.
    const transferTx = await new TransferTransaction()
      .addTokenTransfer(mockUsdcTokenId, operatorId, -microUnits)
      .addTokenTransfer(mockUsdcTokenId, operatorId, microUnits) // Atomic self-transfer for demonstration
      .setTransactionMemo(`x402:usdc:$${costUsd}:prompt_inference`)
      .freezeWith(client)

    const txResponse = await transferTx.execute(client)
    const receipt = await txResponse.getReceipt(client)
    const hashscanUrl = getHashscanUrl(txResponse)

    console.log('\n[SUCCESS] HTS USDC Micropayment Confirmed On-Chain:')
    console.log(`[LOG] Status:         ${receipt.status.toString()}`)
    console.log(`[LOG] Transaction ID: ${txResponse.transactionId.toString()}`)
    console.log(`[EXPLORER] HashScan:  ${hashscanUrl}`)

    // 3. Mathematical Fee Comparison Analysis
    console.log('\n===============================================================')
    console.log('ECONOMIC VIABILITY BENCHMARK: $0.025 API INFERENCE')
    console.log('===============================================================')
    console.log('1. Traditional Rail (Visa/Stripe):')
    console.log('- Fee: $0.30 fixed + 2.9% = $0.3007')
    console.log('- Merchant Net Revenue: -$0.2757 (LOSING 1,100% PER CALL!)')
    console.log('2. Ethereum L1 / Congested L2:')
    console.log('- Gas Fee: $0.40 - $2.50')
    console.log('- Economic Feasibility: IMPOSSIBLE')
    console.log('3. Hedera Token Service (HTS):')
    console.log('- Network Fee: ~$0.001 USD fixed')
    console.log('- Merchant Net Revenue: +$0.024 USD (96% Margin)')
    console.log('===============================================================')

    console.log('\n KEY CONCEPT:')
    console.log('HTS executes at the native gossip and virtual voting layer without spin-up')
    console.log('overhead of EVM smart contract loops. This enables high-frequency micropayments')
    console.log('that make per-token LLM pricing profitable down to fractions of a cent.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] HTS USDC micropayment failed:', error.message)
    process.exit(1)
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
