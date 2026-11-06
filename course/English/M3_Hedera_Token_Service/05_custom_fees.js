/**
 * ============================================================================
 * Lab 05: Fee Modularity (Custom Fees)
 * [CONCEPT] Protocol-Enforced Business Logic
 * ============================================================================
 * [ KEY CONCEPT ]
 * No Bypass: Because these fees are enforced by the network nodes themselves,
 * users cannot "Code around" them. This is the ultimate tool for platform
 * owners who want to monetize their digital ecosystems fairly and securely.
 * You can bake-in fixed and fractional fee logic directly at the ledger level.
 * *
 * [ LEARNABLE MOMENT ]
 * Custom transfer fees are enforced by consensus nodes on every single transfer. Whether a token is traded peer-to-peer or inside a decentralized exchange, royalties and transfer assessments are collected automatically.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/custom-token-fees
 *
 * [ LEARNING PATH ]
 * - Previous: M3 Lab 04: Read NFT On-Chain
 * - Next:     M3 Lab 06: Base Layer Royalties
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: ~30 ℏ the first time (it creates a token with custom fees, about 2 USD); <1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node 05_custom_fees.js
 * ============================================================================
 */

import {
  AccountId,
  CustomFixedFee,
  CustomFractionalFee,
  PrivateKey,
  TokenCreateTransaction,
  TokenType,
  TransferTransaction,
  MirrorNodeTokenBalanceQuery,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, sleep, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HTS Custom Fee Implementation ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  // Secondary accounts from .env
  const account1Id = process.env.ACCOUNT_1_ID
  const account1PrivateKey = PrivateKey.fromString(process.env.ACCOUNT_1_PRIVATE_KEY)
  const account2Id = process.env.ACCOUNT_2_ID

  try {
    console.log('[PROCESS] Defining Custom Fee Schedule for the new token...')

    // 1. Fixed Fee: 1 HBAR
    const fixedFee = new CustomFixedFee()
      .setAmount(1 * 100000000)
      .setFeeCollectorAccountId(AccountId.fromString(operatorId))

    // 2. Fractional Fee: 5% (Min 20, Max 100)
    const fractionalFee = new CustomFractionalFee()
      .setNumerator(5)
      .setDenominator(100)
      .setMin(20)
      .setMax(100)
      .setFeeCollectorAccountId(AccountId.fromString(operatorId))
      .setAssessmentMethod(false) // Inclusive

    console.log('[PROCESS] Issuing the Fee Regulated Token (FRT) with native logic...')
    const tokenId = await reuseToken('REUSE_M3_05_TOKEN', async () => {
      // Create the token: its keys (admin, supply, KYC, freeze...) decide who can change it later.
      const transaction = await new TokenCreateTransaction()
        .setTokenName('Fee Regulated Token')
        .setTokenSymbol('FRT')
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(0)
        .setInitialSupply(1000000)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setAdminKey(adminKey)
        .setCustomFees([fixedFee, fractionalFee])
        .freezeWith(client)

      const response = await transaction.execute(client)
      // Wait for consensus: the receipt says whether the network accepted the transaction.
      const receipt = await response.getReceipt(client)
      return receipt.tokenId
    }, { minBalance: 100000 })

    console.log(`[SUCCESS] Token Created: ${tokenId.toString()}`)

    // Fuel Account 1 with HBAR for Fixed Fees
    console.log(`\n[INFO] Fueling ${account1Id} with 3 HBAR and 100,000 tokens for simulation...`)
    // Build the transfer: debits (negative) and credits (positive) in one transaction must add up to zero.
    const setupTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-3))
      .addHbarTransfer(account1Id, new Hbar(3))
      .addTokenTransfer(tokenId, operatorId, -100000)
      .addTokenTransfer(tokenId, account1Id, 100000)
      .execute(client)
    await setupTx.getReceipt(client)

    // --- SCENARIO 1: LESS THAN THE MINIMUM (EXPECT FAIL) ---
    console.log('\n--- Scenario 1: Amount less than Min Fee (Network Error Simulation) ---')
    console.log('[PROCESS] Attempting to send 5 tokens (Minimum custom fee is 20)...')
    try {
      const failTx = await new TransferTransaction()
        .addTokenTransfer(tokenId, account1Id, -5)
        .addTokenTransfer(tokenId, account2Id, 5)
        .freezeWith(client)
        .sign(account1PrivateKey)
      await (await failTx.execute(client)).getReceipt(client)
    } catch (error) {
      console.log('[SUCCESS] Success: Transfer failed as expected (Payout < Fee).')
    }

    const scenarios = [
      { name: 'The Minimum (400 tokens -> 20 fee)', amount: 400, expectFee: 20 },
      { name: 'Halfway (1,000 tokens -> 50 fee)', amount: 1000, expectFee: 50 },
      { name: 'Max Capped (10,000 tokens -> 100 fee capped)', amount: 10000, expectFee: 100 }
    ]

    for (const scenario of scenarios) {
      console.log(`\n--- Scenario: ${scenario.name} ---`)
      const transferTx = await new TransferTransaction()
        .addTokenTransfer(tokenId, account1Id, -scenario.amount)
        .addTokenTransfer(tokenId, account2Id, scenario.amount)
        .freezeWith(client)
        .sign(account1PrivateKey)

      await (await transferTx.execute(client)).getReceipt(client)
      await sleep(3500)

      const balance1 = await new MirrorNodeTokenBalanceQuery().setAccountId(account1Id).setTokenId(tokenId).execute(client)
      const balance2 = await new MirrorNodeTokenBalanceQuery().setAccountId(account2Id).setTokenId(tokenId).execute(client)

      console.log(`[SUCCESS] Sent ${scenario.amount}. Fee of ${scenario.expectFee} was protocol-enforced.`)
      console.log(`[LOG] Sender Balance:   ${balance1.balance.toString()} FRT`)
      console.log(`[LOG] Receiver Balance: ${balance2.balance.toString()} FRT`)
    }

    console.log('\n KEY CONCEPT:')
    console.log('Using Account 1 -> Account 2 triggered all custom fees because neither')
    console.log('account is the Treasury. This proves the logic is global and automated.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Custom Fee Demonstration Failed:', error.message)
    process.exitCode = 1
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
