/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 07: Airdrop Cancellation & Anti-Spam Token Rejection (HIP-904)
 * [ CONCEPT ] Sender Clawback & User Wallet Sovereignty Against Spam Tokens
 * ============================================================================
 * [ KEY CONCEPT ]
 * HIP-904 did not just add `TokenAirdropTransaction`; it introduced a complete
 * 4-stage lifecycle to protect both senders and recipients:
 * 1. `TokenCancelAirdropTransaction`: If a sender airdrops tokens to an unassociated
 *    account and the recipient never claims them (or the sender made a typo), the
 *    sender can cancel the pending airdrop and reclaim the tokens.
 * 2. `TokenRejectTransaction`: If an account receives unwanted or spam tokens (via
 *    auto-association slots), the user can execute `TokenRejectTransaction` to return
 *    the entire balance back to the Token Treasury with ALL custom fees/royalties waived!
 *
 * [ LEARNABLE MOMENT ]
 * On Ethereum or Solana, if a scammer airdrops a malicious token with a transfer tax
 * or phishing hook into your wallet, interacting with it can drain you or cost high gas.
 * On Hedera, `TokenRejectTransaction` purges unwanted tokens back to the issuer at the
 * consensus layer while bypassing any malicious custom fee schedules.
 *
 * [ LEARNING PATH ]
 * - Previous: M4 Lab 06: Native Airdrops (HIP-904)
 * - Next:     M4 Lab 08: Orderbook & Triangular L1 Settlement
 *
 * [ HOW TO RUN ]
 * node English/M4_Token_Operations_Atomic_Swaps/07_airdrop_cancel_and_reject.js
 * ============================================================================
 */

import {
  AccountCreateTransaction,
  Hbar,
  MirrorNodeTokenBalanceQuery,
  PendingAirdropId,
  PrivateKey,
  TokenAirdropTransaction,
  TokenCancelAirdropTransaction,
  TokenCreateTransaction,
  TokenRejectTransaction
} from '@hiero-ledger/sdk'
import { getClient, sleep, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HIP-904 Airdrop Cancellation & Token Rejection ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const supplyKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Create a Fungible Token for our Airdrop Lifecycle Test
    console.log('[⚙️ PROCESS] Creating Fungible Token (SPAM / PROMO)...')
    const tokenTx = await new TokenCreateTransaction()
      .setTokenName('Promo Drop Token')
      .setTokenSymbol('PROMO')
      .setDecimals(0)
      .setInitialSupply(10000)
      .setTreasuryAccountId(operatorId)
      .setSupplyKey(supplyKey)
      .freezeWith(client)

    const signedToken = await tokenTx.sign(supplyKey)
    const tokenRes = await signedToken.execute(client)
    const tokenId = (await tokenRes.getReceipt(client)).tokenId
    console.log(`[✅ SUCCESS] Token Created: ${tokenId.toString()} (Initial Supply: 10,000 PROMO)`)

    // 2. PART A: Sender Cancels an Unclaimed Pending Airdrop (`TokenCancelAirdropTransaction`)
    console.log('\n[⚙️ PROCESS] Part A: Creating Dormant Account (0 Auto-Association Slots)...')
    const dormantKey = PrivateKey.generateED25519()
    const dormantRes = await new AccountCreateTransaction()
      .setKeyWithoutAlias(dormantKey.publicKey)
      .setInitialBalance(new Hbar(1))
      .setMaxAutomaticTokenAssociations(0) // Forces airdrop into PENDING state
      .execute(client)
    const dormantId = (await dormantRes.getReceipt(client)).accountId
    console.log(`[👤 ACTOR] Dormant Receiver: ${dormantId.toString()}`)

    console.log(`[⚙️ PROCESS] Airdropping 500 PROMO to ${dormantId.toString()} (Enters Pending Queue)...`)
    const pendingDropRes = await new TokenAirdropTransaction()
      .addTokenTransfer(tokenId, operatorId, -500)
      .addTokenTransfer(tokenId, dormantId, 500)
      .execute(client)
    const pendingDropRecord = await pendingDropRes.getRecord(client)
    const pendingAirdropId = pendingDropRecord.newPendingAirdrops?.[0]?.airdropId ||
      new PendingAirdropId({ senderId: operatorId, receiverId: dormantId, tokenId })
    console.log('[✅ SUCCESS] Airdrop is now PENDING on ledger.')

    console.log('[⚙️ PROCESS] Sender executing `TokenCancelAirdropTransaction` to claw back unclaimed drop...')
    const cancelRes = await new TokenCancelAirdropTransaction()
      .addPendingAirdropId(pendingAirdropId)
      .execute(client)
    const cancelReceipt = await cancelRes.getReceipt(client)
    console.log(`[✅ SUCCESS] Unclaimed Airdrop Cancelled! Status: ${cancelReceipt.status.toString()}`)

    // 3. PART B: Recipient Rejects an Auto-Associated Airdrop (`TokenRejectTransaction`)
    console.log('\n[⚙️ PROCESS] Part B: Creating Sovereign User Account (With Auto-Associations Enabled)...')
    const userKey = PrivateKey.generateED25519()
    const userRes = await new AccountCreateTransaction()
      .setKeyWithoutAlias(userKey.publicKey)
      .setInitialBalance(new Hbar(1))
      .setMaxAutomaticTokenAssociations(5) // Airdrop lands immediately in wallet!
      .execute(client)
    const userId = (await userRes.getReceipt(client)).accountId
    console.log(`[👤 ACTOR] Sovereign User: ${userId.toString()} (Auto-Association Slots: 5)`)

    console.log(`[⚙️ PROCESS] Airdropping 750 PROMO directly into ${userId.toString()}...`)
    const instantDropRes = await new TokenAirdropTransaction()
      .addTokenTransfer(tokenId, operatorId, -750)
      .addTokenTransfer(tokenId, userId, 750)
      .execute(client)
    await instantDropRes.getReceipt(client)

    await sleep(3500)
    const userBalBefore = await new MirrorNodeTokenBalanceQuery()
      .setAccountId(userId)
      .setTokenId(tokenId)
      .execute(client)
    console.log(`[📊 LOG] User Token Balance Before Reject: ${userBalBefore.balance.toString()} PROMO`)

    console.log('[⚙️ PROCESS] User executing `TokenRejectTransaction` to purge unwanted tokens back to Treasury...')
    const rejectTx = await new TokenRejectTransaction()
      .setOwnerId(userId)
      .addTokenId(tokenId)
      .freezeWith(client)
    const signedReject = await rejectTx.sign(userKey)
    const rejectRes = await signedReject.execute(client)
    const rejectReceipt = await rejectRes.getReceipt(client)
    console.log(`[✅ SUCCESS] Token Rejected by User! Status: ${rejectReceipt.status.toString()}`)

    await sleep(3500)
    const treasuryBalAfter = await new MirrorNodeTokenBalanceQuery()
      .setAccountId(operatorId)
      .setTokenId(tokenId)
      .execute(client)
    console.log(`[📊 LOG] Treasury Balance Restored: ${treasuryBalAfter.balance.toString()} / 10000 PROMO`)

    updateState('HIP904_PROMO_TOKEN_ID', tokenId.toString())
    updateState('HIP904_REJECT_STATUS', rejectReceipt.status.toString())

    console.log('\n💡 KEY CONCEPT:')
    console.log('HIP-904 completes the token distribution circle: Senders can cancel unclaimed')
    console.log('pending drops, and receivers can reject unwanted tokens back to the treasury')
    console.log('with 100% immunity from predatory custom transfer fees.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Never burn or transfer spam tokens manually—doing so can trigger custom royalty')
    console.log('hooks. Always use `TokenRejectTransaction` to return them fee-free to the issuer.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] HIP-904 Cancel/Reject Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
