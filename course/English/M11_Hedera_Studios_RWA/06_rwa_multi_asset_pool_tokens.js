/**
 * ============================================================================
 * Lab 06: Institutional Multi-Asset Pool Tokens & RWA Baskets (Archax / ATS)
 * [CONCEPT] Composable Tokenized Portfolios & Atomic Basket Settlement
 * ============================================================================
 * [ KEY CONCEPT ]
 * One of Hedera's landmark institutional tokenization breakthroughs (pioneered
 * with Archax, abrdn, Lloyds Banking Group, and the Asset Tokenization Studio)
 * is the **Pool Token**: a native HTS token that represents a proportional claim
 * on an underlying basket of distinct regulated RWAs (e.g., 50% Tokenized US
 * Treasury Money Market Fund, 30% Corporate Green Bond, 20% Commercial Real Estate).
 * Because Hedera `TransferTransaction` supports up to 10 token legs atomically,
 * an Authorized Participant (AP) can deposit the exact underlying RWA basket and
 * receive newly issued Pool Tokens in a single, zero-counterparty-risk atomic swap!
 *
 * [ LEARNABLE MOMENT ]
 * In traditional finance, creating or redeeming an ETF basket takes T+1 or T+2 days
 * of clearinghouse reconciliation. On Hedera, multi-asset Pool Token creation and
 * collateral transfers settle atomically in 2.5 seconds for $0.001.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/tokenization/ats
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens#atomic-crypto-and-token-transfers
 *
 * [ LEARNING PATH ]
 * - Previous: M11 Lab 05: Real-World Asset (RWA) Invoice Factoring Pipeline
 * - Next:     M11 Lab 07: Institutional ERP Integration Bridge (UBL Invoice -> HCS -> HTS Tranches)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~60 ℏ the first time (4 tokens at ~15 ℏ each on testnet); ~3 ℏ when it reuses them.
 *
 * [ HOW TO RUN ]
 * node English/M11_Hedera_Studios_RWA/06_rwa_multi_asset_pool_tokens.js
 * ============================================================================
 */

import {
  AccountCreateTransaction,
  Hbar,
  MirrorNodeTokenBalanceQuery,
  PrivateKey,
  TokenCreateTransaction,
  TokenSupplyType,
  TokenType,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { getClient, sleep, updateState, reuseToken } from '../M99_Utilities/index.js'

const BASKET_WEIGHTS = [
  { symbol: 'USTB-MMF', name: 'Tokenized US Treasury MMF (abrdn)', weight: 500 }, // 50%
  { symbol: 'CORP-BND', name: 'Senior Green Corporate Bond', weight: 300 }, // 30%
  { symbol: 'CRE-REIT', name: 'Prime Commercial Real Estate Equity', weight: 200 } // 20%
]

const main = async () => {
  console.log('--- SESSION START: Institutional Multi-Asset Pool Tokens (Archax / ATS Pattern) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const issuerKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Deploy the 3 Underlying Regulated RWA Tokens on HTS
    console.log('[PROCESS] Step 1: Deploying 3 Underlying RWA Constituents on HTS...')
    const underlyingTokens = []

    for (const item of BASKET_WEIGHTS) {
      const tokenId = await reuseToken(`REUSE_M11_06_${item.symbol}`, async () => {
        const tx = await new TokenCreateTransaction()
          .setTokenName(item.name)
          .setTokenSymbol(item.symbol)
          .setDecimals(0)
          .setInitialSupply(100000)
          .setTokenType(TokenType.FungibleCommon)
          .setSupplyType(TokenSupplyType.Finite)
          .setMaxSupply(100000)
          .setTreasuryAccountId(operatorId)
          .setSupplyKey(issuerKey)
          .freezeWith(client)

        const res = await (await tx.sign(issuerKey)).execute(client)
        return (await res.getReceipt(client)).tokenId
      }, { minBalance: item.weight })
      underlyingTokens.push({ ...item, tokenId })
      console.log(`[ RWA LEG] ${item.symbol.padEnd(10)} (${item.name.padEnd(36)}) ➔ Token ID: ${tokenId.toString()}`)
    }

    // 2. Deploy the Composite "Institutional RWA Pool Token" (POOL-RWA)
    console.log('\n[PROCESS] Step 2: Deploying Composite Multi-Asset Pool Token [POOL-RWA]...')
    const poolMemo = `ats:pool_v1:${underlyingTokens.map(t => `${t.tokenId.toString()}_${t.weight}`).join('|')}`
    const poolTokenId = await reuseToken('REUSE_M11_06_POOL', async () => {
      const poolTx = await new TokenCreateTransaction()
        .setTokenName('Archax-Style Institutional RWA Basket Pool')
        .setTokenSymbol('POOL-RWA')
        .setDecimals(0)
        .setInitialSupply(10000)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(issuerKey)
        .setTokenMemo(poolMemo)
        .freezeWith(client)

      const poolRes = await (await poolTx.sign(issuerKey)).execute(client)
      return (await poolRes.getReceipt(client)).tokenId
    }, { minBalance: 1000, check: (t) => t.memo === poolMemo })
    console.log(`[SUCCESS] Composite Pool Token Created: ${poolTokenId.toString()}`)
    console.log(`[LOG] On-Chain Basket Composition Memo: ${poolMemo}`)

    // 3. Provision an Institutional Authorized Participant (AP) & Seed Underlying Assets
    console.log('\n[PROCESS] Step 3: Provisioning Institutional Authorized Participant (AP) Vault...')
    const apKey = PrivateKey.generateED25519()
    const apRes = await new AccountCreateTransaction()
      .setKeyWithoutAlias(apKey.publicKey)
      .setInitialBalance(new Hbar(0))
      .setMaxAutomaticTokenAssociations(10)
      .execute(client)
    const apAccountId = (await apRes.getReceipt(client)).accountId

    // Seed AP with 500 USTB-MMF, 300 CORP-BND, and 200 CRE-REIT
    const seedTx = new TransferTransaction()
    for (const asset of underlyingTokens) {
      seedTx.addTokenTransfer(asset.tokenId, operatorId, -asset.weight)
      seedTx.addTokenTransfer(asset.tokenId, apAccountId, asset.weight)
    }
    await (await seedTx.execute(client)).getReceipt(client)
    console.log(`[ AP VAULT] Account ${apAccountId.toString()} funded with 500 USTB-MMF, 300 CORP-BND, 200 CRE-REIT`)

    // 4. Atomic Basket Creation: AP Deposits 3 RWA Legs & Receives 1,000 POOL-RWA in ONE Transaction!
    console.log('\n[PROCESS] Step 4: Executing Atomic 4-Token Basket Creation (DvP)...')
    const atomicBasketSwap = new TransferTransaction()
      // Leg 1, 2, 3: AP deposits underlying RWA basket into Pool Treasury
      .addTokenTransfer(underlyingTokens[0].tokenId, apAccountId, -500)
      .addTokenTransfer(underlyingTokens[0].tokenId, operatorId, 500)
      .addTokenTransfer(underlyingTokens[1].tokenId, apAccountId, -300)
      .addTokenTransfer(underlyingTokens[1].tokenId, operatorId, 300)
      .addTokenTransfer(underlyingTokens[2].tokenId, apAccountId, -200)
      .addTokenTransfer(underlyingTokens[2].tokenId, operatorId, 200)
      // Leg 4: Pool Treasury delivers 1,000 POOL-RWA shares to AP
      .addTokenTransfer(poolTokenId, operatorId, -1000)
      .addTokenTransfer(poolTokenId, apAccountId, 1000)
      .setTransactionMemo('ATS:POOL_MINT:1000_SHARES')
      .freezeWith(client)

    // Co-signed by both the AP and the Pool Treasury
    const signedSwap = await (await atomicBasketSwap.sign(apKey)).sign(issuerKey)
    const swapRes = await signedSwap.execute(client)
    const swapReceipt = await swapRes.getReceipt(client)
    console.log(`[SUCCESS] Atomic Basket Creation Settled! Status: ${swapReceipt.status.toString()}`)
    console.log(`[LOG] Tx ID: ${swapRes.transactionId.toString()}`)

    // 5. Verify AP's Final Pool Token Balance via Mirror Node
    await sleep(3500)
    const apPoolBal = await new MirrorNodeTokenBalanceQuery()
      .setAccountId(apAccountId)
      .setTokenId(poolTokenId)
      .execute(client)
    console.log(`\n[AUDIT] AP Final Pool Token Balance: ${apPoolBal.balance.toString()} POOL-RWA (Backed 1:1 by 3 RWA Vault Legs)`)

    updateState('RWA_POOL_TOKEN_ID', poolTokenId.toString())
    updateState('RWA_AP_ACCOUNT_ID', apAccountId.toString())
    updateState('RWA_POOL_SHARES_MINTED', apPoolBal.balance.toString())

    console.log('\n KEY CONCEPT:')
    console.log('Pool Tokens allow institutions to bundle Money Market Funds, Bonds, and Equities')
    console.log('into a single transferable HTS instrument used as instant collateral for FX and DeFi.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Because Hedera supports multi-token atomic transfers natively at Layer 1,')
    console.log('creating or redeeming a multi-asset ETF basket requires zero escrow smart contracts.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] RWA Pool Token Execution Failure:', error.message)
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
