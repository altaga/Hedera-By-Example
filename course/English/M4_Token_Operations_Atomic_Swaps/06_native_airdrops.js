/**
 * ============================================================================
 * Lab 06: Native Airdrops (HIP-904)
 * [CONCEPT] Frictionless Token Distribution
 * ============================================================================
 * [ KEY CONCEPT ]
 * Historically, users had to manually associate a token (paying a fee) before
 * they could receive it. This made airdrops extremely difficult.
 * With HIP-904, developers can use `TokenAirdropTransaction` to send tokens
 * to accounts that haven't associated them. The tokens go into a "pending" state.
 * The user can then use `TokenClaimAirdropTransaction` to claim them, which
 * automatically associates the token and transfers the balance.
 * *
 * [ LEARNABLE MOMENT ]
 * HIP-904 native airdrops push tokens directly to target recipients: if an account has open auto-association slots, delivery is instantaneous; if slots are full, a pending airdrop record is preserved for user claim.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-904
 *
 * [ LEARNING PATH ]
 * - Previous: M4 Lab 05: Parallel Transfers
 * - Next:     M4 Lab 07: Airdrop Cancel & Reject (HIP-904)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD); ~2 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node 06_native_airdrops.js
 * ============================================================================
 */

import {
  PrivateKey,
  PendingAirdropId,
  TokenCreateTransaction,
  TokenAirdropTransaction,
  TokenClaimAirdropTransaction,
  AccountCreateTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Native Airdrops ---\n')

  const { client, operatorKey, operatorId } = getClient()
  const supplyKey = PrivateKey.fromString(operatorKey)

  try {
    // 1. Create a receiver account (that WILL NOT associate the token)
    console.log('[PROCESS] Creating a new receiver account...')
    const receiverKey = PrivateKey.generateED25519()
    let tx = await new AccountCreateTransaction()
      .setKey(receiverKey)
      .setInitialBalance(new Hbar(0))
      .execute(client)

    let receipt = await tx.getReceipt(client)
    const receiverId = receipt.accountId
    console.log(`[SUCCESS] Receiver Account created: ${receiverId.toString()}`)

    // 2. Create a new fungible token
    console.log('\n[PROCESS] Creating an Airdrop Token...')
    const tokenId = await reuseToken('REUSE_M4_06_TOKEN', async () => {
      const createTx = await new TokenCreateTransaction()
        .setTokenName('AirdropCoin')
        .setTokenSymbol('DROP')
        .setDecimals(2)
        .setInitialSupply(100000) // 1,000.00
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(supplyKey)
        .freezeWith(client)
      return (await (await (await createTx.sign(supplyKey)).execute(client)).getReceipt(client)).tokenId
    }, { minBalance: 500 })
    let signTx, submitTx
    console.log(`[SUCCESS] Token created: ${tokenId.toString()}`)

    // 3. Perform the Airdrop (sending to an unassociated account!)
    console.log(`\n[PROCESS] Airdropping 5.00 DROP to ${receiverId.toString()}...`)
    tx = await new TokenAirdropTransaction()
      .addTokenTransfer(tokenId, operatorId, -500) // 5.00 DROP (2 decimals)
      .addTokenTransfer(tokenId, receiverId, 500)
      .execute(client)

    const airdropRecord = await tx.getRecord(client)
    const pendingAirdropId = airdropRecord.newPendingAirdrops?.[0]?.airdropId ||
      new PendingAirdropId({ senderId: operatorId, receiverId, tokenId })
    console.log('[SUCCESS] Airdrop transaction submitted! Tokens are now PENDING.')

    // 4. The receiver claims the airdrop
    console.log('\n[PROCESS] Receiver is claiming the pending airdrop...')
    tx = await new TokenClaimAirdropTransaction()
      .addPendingAirdropId(pendingAirdropId)
      .freezeWith(client)

    signTx = await tx.sign(receiverKey)
    submitTx = await signTx.execute(client)
    await submitTx.getReceipt(client)

    console.log('[SUCCESS] Airdrop claimed successfully!')

    console.log('\n KEY CONCEPT:')
    console.log('Airdrops no longer require complex smart contracts or begging users')
    console.log('to associate your token first. You push the tokens, they claim them.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Execution Error:', error.message)
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
