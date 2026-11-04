/**
 * ============================================================================
 * Lab 06: Native Staking (HIP-584)
 * [CONCEPT] Consensus Node Delegation & Rewards
 * ============================================================================
 * [ KEY CONCEPT ]
 * Hedera's Proof-of-Stake allows accounts to stake their HBAR balance to a
 * consensus node (or another account). Staking directly contributes to the
 * network's security and consensus weight. In return, the network pays out
 * passive staking rewards (up to a network-defined APY) natively to the
 * account. You can configure this via `AccountUpdateTransaction`.
 * *
 * [ LEARNABLE MOMENT ]
 * Hedera native staking (HIP-584) involves zero lockups, zero slashing, and zero smart contract risks. Your HBAR never leaves your wallet, yet you earn network staking rewards automatically distributed by consensus nodes.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-584
 *
 * [ LEARNING PATH ]
 * - Previous: M1 Lab 05: Lazy Account Creation
 * - Next:     M1 Lab 07: HIP-1261 Simple Fees Engine
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 06_native_staking.js
 * ============================================================================
 */

import { AccountUpdateTransaction, AccountInfoQuery } from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Native Staking ---\n')

  const { client, operatorId } = getClient()

  try {
    // We will stake the operator account to Node 2
    const TARGET_NODE_ID = 2

    console.log(`[PROCESS] Updating Account ${operatorId} to stake to Node ${TARGET_NODE_ID}...`)

    // 1. Update the account to stake to the node and accept rewards
    const tx = await new AccountUpdateTransaction()
      .setAccountId(operatorId)
      .setStakedNodeId(TARGET_NODE_ID)
      .setDeclineStakingReward(false) // Must be false to earn rewards
      .execute(client)

    await tx.getReceipt(client)
    console.log('[SUCCESS] Account staking updated successfully!')

    // 2. Verify the staking configuration by querying the account info
    console.log('\n[PROCESS] Querying Account Info to verify staking status...')
    const info = await new AccountInfoQuery()
      .setAccountId(operatorId)
      .execute(client)

    console.log('\n[LOG] Staking Information:')
    console.log(`- Staked to Node ID: ${info.stakingInfo.stakedNodeId}`)
    console.log(`- Staked to Account ID: ${info.stakingInfo.stakedAccountId || 'None'}`)
    console.log(`- Declining Rewards?: ${info.stakingInfo.declineStakingReward}`)
    console.log(`- Pending Rewards (HBAR): ${info.stakingInfo.pendingReward.toTinybars().toNumber() / 100000000}`)

    console.log('\n KEY CONCEPT:')
    console.log('Staking on Hedera is non-custodial and liquid. Your funds are never')
    console.log('locked, and you can transfer them at any time. The rewards are')
    console.log('automatically triggered and paid out when a transaction occurs.')

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
