/**
 * ============================================================================
 * Lab 03: Intent-Based DeFi Settlement Solver (ERC-7683 / CoW Swap Model)
 * [CONCEPT] Off-Chain Cryptographic Declarations & Atomic Multi-Leg Execution
 * ============================================================================
 * [ KEY CONCEPT ]
 * In traditional AMMs, users broadcast transactions to a mempool where searchers
 * sandwich trade executions, extract MEV, and impose slippage. In an Intent-Based
 * architecture (standardized by ERC-7683), users sign off-chain declarative "intents"
 * (e.g. "I want to exchange X for at least Y before timestamp T"). Specialized
 * off-chain solvers match Coincidence-of-Wants (CoW) between counter-parties or route
 * private liquidity, settling the trade atomically on Hedera via a multi-leg
 * `TransferTransaction` with net-zero balance across all participants.
 *
 * Each maker signs an ERC-7683 `GaslessCrossChainOrder` with EIP-712, using the key of
 * their own Hedera account, so the solver can prove who agreed to what before it settles.
 *
 * [ LEARNABLE MOMENT ]
 * A single Hedera `TransferTransaction` can carry the HBAR leg and the token leg of a
 * trade together. It needs the signature of every account it debits, and if any leg
 * fails (for example, a balance is too low) none of them happen.
 *
 * [ LEARNING PATH ]
 * - Previous: M15 Lab 02: DePIN Lightweight Cold-Chain Telemetry (API Key + HMAC-SHA256)
 * - Next:     M15 Lab 04: Passkeys & WebAuthn P-256 Biometric Authenticator
 *
 * [ OFFICIAL REFERENCES ]
 * - ERC-7683: Cross-Chain Intent Standard: https://eips.ethereum.org/EIPS/eip-7683
 * - Hedera Atomic Transfers Documentation: https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/transfer-cryptocurrency
 * - CoW Protocol Architecture: https://docs.cow.fi/overview/introduction
 *
 * [ SEQUENCE ]
 * Alice -> Solver: EIP-712 signed order: HBAR for tUSD
 * Bob -> Solver: EIP-712 signed order: tUSD for HBAR
 * Note Solver: Recovers each signer and checks it is the account's on-chain key
 * Solver -> Hedera: One TransferTransaction with both legs (signed by Alice and Bob)
 * Solver -> Hedera: Settlement record on HCS
 *
 * [ SIMULATED ]
 * Alice, Bob and the solver run in one process (in production they are separate parties). There is no
 * ERC-7683 settler contract on Hedera, so `originSettler` is the zero address and the solver checks the
 * EIP-712 signatures itself. tUSD is a test stablecoin this lab creates, not USDC. Both legs, the
 * signatures and the HCS record are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: ~15 ℏ the first time (it creates the tUSD token, about 1 USD); <1 ℏ when you run it again (it reuses it). Alice sends Bob 0.5 HBAR in the trade.
 *
 * [ HOW TO RUN ]
 * node English/M15_DePIN_and_Future_Crypto/03_intent_based_defi_solver.js
 * ============================================================================
 */

import {
  TransferTransaction,
  Hbar,
  TokenCreateTransaction,
  TokenAssociateTransaction,
  TokenType,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  AccountId,
  PrivateKey,
  TokenId
} from '@hiero-ledger/sdk'
import { ethers } from 'ethers'
import { getClient, updateState, getHashscanUrl, requireEnv, reuseToken, reuseTopic, getMirrorNodeBaseUrl, sleep } from '../M99_Utilities/index.js'

const CHAIN_ID = 296 // Hedera testnet EVM chain ID
const HBAR_ADDRESS = ethers.ZeroAddress // native HBAR in the order data
const ALICE_SELLS_TINYBARS = 50_000_000n // 0.5 HBAR

// ERC-7683 GaslessCrossChainOrder, signed with EIP-712 (https://eips.ethereum.org/EIPS/eip-7683)
const DOMAIN = { name: 'HBE Intent Settler', version: '1', chainId: CHAIN_ID }
const ORDER_TYPES = {
  GaslessCrossChainOrder: [
    { name: 'originSettler', type: 'address' },
    { name: 'user', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'originChainId', type: 'uint256' },
    { name: 'openDeadline', type: 'uint32' },
    { name: 'fillDeadline', type: 'uint32' },
    { name: 'orderDataType', type: 'bytes32' },
    { name: 'orderData', type: 'bytes' }
  ]
}
// The order data is a swap: what the maker gives and the least it accepts in return.
const SWAP_TYPE = 'Swap(address sellToken,uint256 sellAmount,address buyToken,uint256 minBuyAmount)'
const SWAP_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes(SWAP_TYPE))
const coder = ethers.AbiCoder.defaultAbiCoder()

const signOrder = async (wallet, swap) => {
  const now = Math.floor(Date.now() / 1000)
  const order = {
    originSettler: ethers.ZeroAddress, // no settler contract on Hedera: the solver verifies off-chain
    user: wallet.address,
    nonce: BigInt(ethers.hexlify(ethers.randomBytes(8))),
    originChainId: CHAIN_ID,
    openDeadline: now + 3600,
    fillDeadline: now + 3600,
    orderDataType: SWAP_TYPEHASH,
    orderData: coder.encode(['address', 'uint256', 'address', 'uint256'], [swap.sellToken, swap.sellAmount, swap.buyToken, swap.minBuyAmount])
  }
  return { order, swap, signature: await wallet.signTypedData(DOMAIN, ORDER_TYPES, order) }
}

// The EVM address of the key an account has on-chain (read from the Mirror Node).
const onChainKeyAddress = async (accountId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
  if (!res.ok) throw new Error(`Mirror Node has no account ${accountId}`)
  const { key } = await res.json()
  if (key?._type !== 'ECDSA_SECP256K1') throw new Error(`${accountId} needs an ECDSA key to sign EIP-712 orders (it has ${key?._type}).`)
  return ethers.computeAddress('0x' + key.key)
}

const tokenBalance = async (accountId, tokenId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`)
  const data = res.ok ? await res.json() : {}
  return data.tokens?.length ? Number(data.tokens[0].balance) : null // null = not associated
}

async function main () {
  console.log('====================================================================')
  console.log('DEFI LAB 03: INTENT-BASED SETTLEMENT SOLVER (ERC-7683 / COW)')
  console.log('====================================================================\n')

  const { client, operatorId, operatorKey, network } = getClient()

  try {
    const aliceId = AccountId.fromString(operatorId.toString())
    const aliceKey = PrivateKey.fromStringDer(operatorKey)
    const bobId = AccountId.fromString(requireEnv('ACCOUNT_1_ID'))
    const bobKey = PrivateKey.fromStringDer(requireEnv('ACCOUNT_1_PRIVATE_KEY'))
    console.log(`[OPERATOR] Alice (maker A) = ${aliceId} | Bob (maker B) = ${bobId} | network ${network}`)

    // 1. The test stablecoin and the audit topic (reused on later runs)
    console.log('\n[1/6] Preparing the tUSD test stablecoin and the audit topic...')
    const tusdId = await reuseToken('REUSE_M15_03_TUSD', async () => {
      const tx = await new TokenCreateTransaction()
        .setTokenName('HBE Test USD')
        .setTokenSymbol('tUSD')
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(2)
        .setInitialSupply(1_000_000) // 10,000.00 tUSD in the treasury (Alice)
        .setTreasuryAccountId(aliceId)
        .execute(client)
      return (await tx.getReceipt(client)).tokenId
    })
    const topicId = await reuseTopic('REUSE_M15_03_TOPIC', async () =>
      (await (await new TopicCreateTransaction().setTopicMemo('HBE intent solver settlements').execute(client)).getReceipt(client)).topicId)
    console.log(`[LOG] tUSD token: ${tusdId} | audit topic: ${topicId}`)

    // Bob needs tUSD to sell: associate him and give him some from the treasury if needed.
    let bobTusd = await tokenBalance(bobId, tusdId)
    if (bobTusd === null) {
      console.log(`[PROCESS] Associating Bob (${bobId}) with tUSD...`)
      const assoc = await new TokenAssociateTransaction().setAccountId(bobId).setTokenIds([tusdId]).freezeWith(client)
      await (await (await assoc.sign(bobKey)).execute(client)).getReceipt(client)
      bobTusd = 0
    }
    if (bobTusd < 100) {
      console.log('[PROCESS] Funding Bob with 1.00 tUSD from the treasury...')
      await (await new TransferTransaction().addTokenTransfer(tusdId, aliceId, -100).addTokenTransfer(tusdId, bobId, 100).execute(client)).getReceipt(client)
    }

    // 2. Price from the live network exchange rate
    const rateRes = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/network/exchangerate`)
    const { current_rate: rate } = await rateRes.json()
    const usdPerHbar = rate.cent_equivalent / rate.hbar_equivalent / 100
    const tusdUnits = BigInt(Math.max(1, Math.floor(Number(ALICE_SELLS_TINYBARS) / 1e8 * usdPerHbar * 100))) // tUSD has 2 decimals
    console.log(`\n[2/6] Live rate: 1 HBAR = $${usdPerHbar.toFixed(4)} -> 0.5 HBAR is worth ${(Number(tusdUnits) / 100).toFixed(2)} tUSD`)

    // 3. Both makers sign ERC-7683 orders with their own account keys
    console.log('\n[3/6] Makers sign ERC-7683 GaslessCrossChainOrders (EIP-712)...')
    const tusdAddress = '0x' + TokenId.fromString(tusdId.toString()).toEvmAddress()
    const aliceWallet = new ethers.Wallet('0x' + aliceKey.toStringRaw())
    const bobWallet = new ethers.Wallet('0x' + bobKey.toStringRaw())
    const aliceOrder = await signOrder(aliceWallet, { sellToken: HBAR_ADDRESS, sellAmount: ALICE_SELLS_TINYBARS, buyToken: tusdAddress, minBuyAmount: tusdUnits })
    const bobOrder = await signOrder(bobWallet, { sellToken: tusdAddress, sellAmount: tusdUnits, buyToken: HBAR_ADDRESS, minBuyAmount: ALICE_SELLS_TINYBARS })
    console.log(`[LOG] Alice signs: give 0.5 HBAR, want >= ${tusdUnits} tUSD units | sig ${aliceOrder.signature.slice(0, 18)}...`)
    console.log(`[LOG] Bob signs:   give ${tusdUnits} tUSD units, want >= 0.5 HBAR | sig ${bobOrder.signature.slice(0, 18)}...`)

    // 4. The solver verifies each order against the signer's on-chain key, then matches them
    console.log('\n[4/6] Solver verifies the signatures and matches the orders...')
    const makers = [[aliceOrder, aliceId], [bobOrder, bobId]]
    for (const [{ order, signature }, accountId] of makers) {
      const signer = ethers.verifyTypedData(DOMAIN, ORDER_TYPES, order, signature)
      const expected = await onChainKeyAddress(accountId)
      if (signer !== order.user || signer !== expected) throw new Error(`Order for ${accountId} was not signed by its account key`)
      if (order.fillDeadline < Math.floor(Date.now() / 1000)) throw new Error(`Order for ${accountId} has expired`)
      console.log(`[VERIFY] ${accountId}: EIP-712 signer ${signer} matches the account's on-chain key`)
    }
    const a = aliceOrder.swap
    const b = bobOrder.swap
    const crosses = a.sellToken === b.buyToken && a.buyToken === b.sellToken && a.sellAmount >= b.minBuyAmount && b.sellAmount >= a.minBuyAmount
    if (!crosses) throw new Error('The orders do not cross')
    console.log('[SUCCESS] Coincidence of wants: each order gives at least what the other asks.')

    // 5. One TransferTransaction settles both legs; Alice and Bob both sign it
    console.log('\n[5/6] Settling both legs atomically on Hedera...')
    const settle = new TransferTransaction()
      .addHbarTransfer(aliceId, Hbar.fromTinybars(-Number(a.sellAmount)))
      .addHbarTransfer(bobId, Hbar.fromTinybars(Number(a.sellAmount)))
      .addTokenTransfer(tusdId, bobId, -Number(b.sellAmount))
      .addTokenTransfer(tusdId, aliceId, Number(b.sellAmount))
      .setTransactionMemo('ERC-7683 CoW settlement')
      .freezeWith(client)
    const settleRes = await (await settle.sign(bobKey)).execute(client)
    const settleReceipt = await settleRes.getReceipt(client)
    console.log(`[SUCCESS] Settlement status: ${settleReceipt.status.toString()}`)
    console.log(`[EXPLORER] ${getHashscanUrl(settleRes)}`)

    // Read the settled transfers back from the Mirror Node
    let legs = null
    for (let i = 0; i < 8 && !legs; i++) {
      await sleep(2500)
      const txId = settleRes.transactionId.toString().replace('@', '-').replace(/\.(\d+)$/, '-$1')
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions/${txId}`)
      const tx = res.ok ? (await res.json()).transactions?.[0] : null
      if (tx) legs = tx
    }
    if (legs) {
      const hbarToBob = legs.transfers.find((t) => t.account === bobId.toString())?.amount
      const tusdToAlice = legs.token_transfers.find((t) => t.account === aliceId.toString() && t.token_id === tusdId.toString())?.amount
      console.log(`[VERIFY] Mirror Node: Bob received ${hbarToBob} tinybars, Alice received ${tusdToAlice} tUSD units, in one transaction.`)
    }

    // 6. Settlement record on HCS
    const auditRecord = {
      p: 'erc7683-hedera',
      op: 'settle_cow',
      orders: makers.map(([{ order, signature }, accountId]) => ({ account: accountId.toString(), user: order.user, nonce: order.nonce.toString(), signature })),
      settlementTxId: settleRes.transactionId.toString()
    }
    const auditRes = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(JSON.stringify(auditRecord)).execute(client)
    const auditReceipt = await auditRes.getReceipt(client)
    console.log(`\n[6/6] [SUCCESS] Settlement recorded on HCS topic ${topicId}, sequence #${auditReceipt.topicSequenceNumber}`)

    updateState('INTENT_SOLVER_TOPIC_ID', topicId.toString())
    updateState('INTENT_SOLVER_LAST_TX_ID', settleRes.transactionId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('Intents never sit in a public mempool, so there is no pending order to front-run or sandwich.')
    console.log('Each maker signed an ERC-7683 order with their own key; the solver proved the signers,')
    console.log('matched the orders and settled both legs in one atomic Hedera TransferTransaction.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('The settlement needed both signatures because it debited both accounts. If either')
    console.log('balance had been too low, the network would have rejected both legs together.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Intent Solver Execution Failure:', error.message)
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
