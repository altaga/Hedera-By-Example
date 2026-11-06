/**
 * ============================================================================
 * Lab 08: In-Memory Orderbook & Triangular L1 Atomic Settlement (Ring Trade)
 * [CONCEPT] Off-Chain Order Matching with Zero-Escrow Multi-Party L1 Clearing
 * ============================================================================
 * [ KEY CONCEPT ]
 * Automated Market Makers (AMMs) suffer from slippage, front-running (MEV), and
 * liquidity pool fees. Cutting-edge DeFi architectures (such as CoW Swap, UniswapX,
 * and institutional dark pools) solve this through Coincidence of Wants (CoW) and
 * Ring Trades:
 * 1. Off-Chain Orderbook: Traders submit signed cryptographic limit orders off-chain.
 * 2. Ring Matching: The engine identifies a closed cycle among 3 traders:
 *    - Trader Alpha: Wants to swap USD for HBAR.
 *    - Trader Beta:  Wants to swap HBAR for GOLD.
 *    - Trader Gamma: Wants to swap GOLD for USD.
 * 3. Atomic L1 Clearing: The engine compiles all legs into a SINGLE Hedera Layer 1
 *    `TransferTransaction`. There are zero escrow smart contracts, zero pool slippage,
 *    and zero counterparty risk. If any trader lacks balance, the entire ring reverts.
 *
 * [ LEARNABLE MOMENT ]
 * You do not need EVM smart contracts to settle complex multi-party barter networks.
 * Hedera's native Layer 1 `TransferTransaction` supports multi-token, multi-account
 * atomic transfers out of the box with fixed, sub-cent transaction fees.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens#atomic-crypto-and-token-transfers
 *
 * [ LEARNING PATH ]
 * - Previous: M4 Lab 07: Airdrop Cancel & Reject (HIP-904)
 * - Next:     M4 Lab 09: Zero-Capital Flash Loans & Atomic L1 Settlement
 *
 * [SEQUENCE]
 * Alpha -> Solver: Signed limit order (USD → GOLD)
 * Beta -> Solver: Signed limit order (GOLD → HBAR)
 * Gamma -> Solver: Signed limit order (HBAR → USD)
 * Note Solver: Finds the ring (coincidence of wants)
 * Solver -> Hedera: One 6-leg TransferTransaction signed by all three
 * Hedera -> Solver: Ring settled atomically
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~35 ℏ the first time (it creates 2 tokens, about 2 USD); ~6 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M4_Token_Operations_Atomic_Swaps/08_orderbook_triangular_settlement.js
 * ============================================================================
 */

import {
  PrivateKey,
  TokenCreateTransaction,
  TransferTransaction,
  AccountCreateTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, updateState, reuseToken } from '../M99_Utilities/index.js'

/**
 * In-Memory Ring-Trade Matching Engine
 */
class TriangularMatchingEngine {
  constructor () {
    this.orders = []
  }

  submitOrder (order) {
    this.orders.push(order)
    console.log(`[ORDERBOOK] New Limit Order: ${order.traderName} offers ${order.sellAmount} ${order.sellSymbol} ➔ wants ${order.buyAmount} ${order.buySymbol}`)
  }

  findTriangularRing () {
    // Look for a 3-way cycle: A->B, B->C, C->A
    for (const a of this.orders) {
      for (const b of this.orders) {
        for (const c of this.orders) {
          if (
            a.buySymbol === b.sellSymbol &&
            b.buySymbol === c.sellSymbol &&
            c.buySymbol === a.sellSymbol &&
            a.traderId !== b.traderId &&
            b.traderId !== c.traderId
          ) {
            return [a, b, c]
          }
        }
      }
    }
    return null
  }
}

const main = async () => {
  console.log('--- SESSION START: In-Memory Orderbook & Triangular L1 Atomic Settlement ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const treasuryKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Provision 2 Fungible HTS Assets: USD Token & GOLD Token
    console.log('[PROCESS] Step 1: Deploying Synthetic Trading Pair on HTS (USD & GOLD)...')
    const usdId = await reuseToken('REUSE_M4_08_USD', async () => {
      const usdTx = await new TokenCreateTransaction()
        .setTokenName('Synthetic USD Credit')
        .setTokenSymbol('USD')
        .setDecimals(0)
        .setInitialSupply(100000)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(treasuryKey)
        .freezeWith(client)
      return (await (await (await usdTx.sign(treasuryKey)).execute(client)).getReceipt(client)).tokenId
    }, { minBalance: 100 })

    const goldId = await reuseToken('REUSE_M4_08_GOLD', async () => {
      const goldTx = await new TokenCreateTransaction()
        .setTokenName('Tokenized Gold Ounce')
        .setTokenSymbol('GOLD')
        .setDecimals(0)
        .setInitialSupply(10000)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(treasuryKey)
        .freezeWith(client)
      return (await (await (await goldTx.sign(treasuryKey)).execute(client)).getReceipt(client)).tokenId
    }, { minBalance: 5 })

    console.log(`[SUCCESS] HTS Token USD Created:  ${usdId.toString()}`)
    console.log(`[SUCCESS] HTS Token GOLD Created: ${goldId.toString()}`)

    // 2. Provision 3 Autonomous Traders with Initial Inventories
    console.log('\n[PROCESS] Step 2: Provisioning 3 Traders (Alpha, Beta, Gamma) with Auto-Association...')
    const alphaKey = PrivateKey.generateED25519()
    const betaKey = PrivateKey.generateED25519()
    const gammaKey = PrivateKey.generateED25519()

    const makeTrader = async (key, name) => {
      const res = await new AccountCreateTransaction()
        .setKeyWithoutAlias(key.publicKey)
        .setInitialBalance(new Hbar(0))
        .setMaxAutomaticTokenAssociations(5)
        .execute(client)
      const id = (await res.getReceipt(client)).accountId
      console.log(`[TRADER] ${name} (${id.toString()}) provisioned.`)
      return id
    }

    const alphaId = await makeTrader(alphaKey, 'Trader Alpha')
    const betaId = await makeTrader(betaKey, 'Trader Beta')
    const gammaId = await makeTrader(gammaKey, 'Trader Gamma')

    // Fund Trader Alpha with 100 USD
    // Fund Trader Beta with 1 HBAR
    // Fund Trader Gamma with 5 GOLD
    console.log('\n[PROCESS] Distributing Initial Asset Inventories to Traders...')
    const seedInventoryTx = new TransferTransaction()
      .addTokenTransfer(usdId, operatorId, -100)
      .addTokenTransfer(usdId, alphaId, 100)
      .addHbarTransfer(operatorId, new Hbar(-1))
      .addHbarTransfer(betaId, new Hbar(1))
      .addTokenTransfer(goldId, operatorId, -5)
      .addTokenTransfer(goldId, gammaId, 5)
      .freezeWith(client)

    await (await seedInventoryTx.execute(client)).getReceipt(client)
    console.log('[SUCCESS] Inventories Funded: Alpha(100 USD), Beta(1 HBAR), Gamma(5 GOLD)')

    // 3. Off-Chain Orderbook: Submit 3 Non-Overlapping Limit Orders
    console.log('\n[PROCESS] Step 3: Submitting Off-Chain Cryptographic Limit Orders...')
    const engine = new TriangularMatchingEngine()

    // Trader Alpha: Sells 100 USD ➔ Wants 1 HBAR
    engine.submitOrder({
      traderName: 'Trader Alpha',
      traderId: alphaId,
      traderKey: alphaKey,
      sellSymbol: 'USD',
      sellTokenId: usdId,
      sellAmount: 100,
      buySymbol: 'HBAR',
      buyTokenId: null,
      buyAmount: 1
    })

    // Trader Beta: Sells 1 HBAR ➔ Wants 5 GOLD
    engine.submitOrder({
      traderName: 'Trader Beta',
      traderId: betaId,
      traderKey: betaKey,
      sellSymbol: 'HBAR',
      sellTokenId: null,
      sellAmount: 1,
      buySymbol: 'GOLD',
      buyTokenId: goldId,
      buyAmount: 5
    })

    // Trader Gamma: Sells 5 GOLD ➔ Wants 100 USD
    engine.submitOrder({
      traderName: 'Trader Gamma',
      traderId: gammaId,
      traderKey: gammaKey,
      sellSymbol: 'GOLD',
      sellTokenId: goldId,
      sellAmount: 5,
      buySymbol: 'USD',
      buyTokenId: usdId,
      buyAmount: 100
    })

    // 4. Ring Detection Algorithm
    console.log('\n[PROCESS] Step 4: Running Coincidence of Wants (CoW) Graph Cycle Detection...')
    const ring = engine.findTriangularRing()
    if (!ring) {
      throw new Error('No triangular ring could be matched!')
    }
    console.log('[ MATCH FOUND] Closed Ring Identified: Alpha ➔ Beta ➔ Gamma ➔ Alpha!')
    console.log('Alpha delivers USD  ➔ Gamma receives USD')
    console.log('Gamma delivers GOLD ➔ Beta receives GOLD')
    console.log('Beta delivers HBAR  ➔ Alpha receives HBAR')

    // 5. Atomic Layer 1 Settlement (6 Transfer Legs in 1 Transaction!)
    console.log('\n[PROCESS] Step 5: Compiling 6-Leg Atomic L1 Clearing Transaction...')
    const ringClearingTx = new TransferTransaction()
      // Leg 1 & 2: Alpha delivers 100 USD to Gamma
      .addTokenTransfer(usdId, alphaId, -100)
      .addTokenTransfer(usdId, gammaId, 100)
      // Leg 3 & 4: Gamma delivers 5 GOLD to Beta
      .addTokenTransfer(goldId, gammaId, -5)
      .addTokenTransfer(goldId, betaId, 5)
      // Leg 5 & 6: Beta delivers 1 HBAR to Alpha
      .addHbarTransfer(betaId, new Hbar(-1))
      .addHbarTransfer(alphaId, new Hbar(1))
      .setTransactionMemo('COW:TRIANGULAR:RING_CLEARING')
      .freezeWith(client)

    // Collect cryptographic co-signatures from all 3 traders off-chain
    console.log('[PROCESS] Aggregating Ed25519 Signatures from all 3 Ring Participants...')
    const signedClearingTx = await (await (await ringClearingTx.sign(alphaKey)).sign(betaKey)).sign(gammaKey)

    // Execute atomic settlement in a single consensus call
    const clearingRes = await signedClearingTx.execute(client)
    const clearingReceipt = await clearingRes.getReceipt(client)
    console.log(`[SUCCESS] Triangular Ring Cleared on Consensus! Status: ${clearingReceipt.status.toString()}`)
    console.log(`[LOG] Consensus Tx ID: ${clearingRes.transactionId.toString()}`)

    updateState('COW_SETTLED_TX_ID', clearingRes.transactionId.toString())
    updateState('COW_USD_TOKEN_ID', usdId.toString())
    updateState('COW_GOLD_TOKEN_ID', goldId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('Triangular Ring Trades eliminate the need for centralized intermediaries or')
    console.log('fragmented liquidity pools. Settle N-party Coincidence of Wants directly in')
    console.log('a single atomic Hedera Layer 1 transaction with zero execution slippage.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Because Hedera enforces atomicity natively across multiple accounts and tokens,')
    console.log('if any trader had insufficient balance or an invalid signature, 100% of the trade')
    console.log('would fail atomically without locking or draining any trader\'s funds.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Triangular Settlement Failure:', error.message)
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
