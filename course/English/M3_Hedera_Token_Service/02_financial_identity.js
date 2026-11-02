/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Financial Identity and Compliance (KYC)
 * [ CONCEPT ] Native Identity-Gating & Asset Freeze
 * ============================================================================
 * [ KEY CONCEPT ]
 * Native Compliance: In the Ethereum world, you have to write custom code
 * inside a smart contract for this. On Hedera, this is a native configuration
 * of the token itself. This makes your regulatory oversight (KYC/Freeze) more
 * secure, easier to audit, and impervious to smart contract exploits.
 * *
 * [ LEARNABLE MOMENT ]
 * Regulated institutional assets require KYC and Freeze keys. While smart contracts on EVM require expensive custom blacklist loops, HTS executes identity enforcement at Layer 1 with micro-cent predictability.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/kyc-a-token
 *
 * [ LEARNING PATH ]
 * - Previous: M3 Lab 01: Immutable Issuance
 * - Next:     M3 Lab 03: NFT HIP-412
 *
 * [ HOW TO RUN ]
 * node 02_financial_identity.js
 * ============================================================================
 */

import {
  MirrorNodeAccountBalanceQuery,
  AccountId,
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenFreezeTransaction,
  TokenGrantKycTransaction,
  TokenUnfreezeTransaction
} from '@hiero-ledger/sdk'
import { getClient, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Financial Compliance Simulation ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const targetId = process.env.ACCOUNT_1_ID
  const targetKey = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!targetId || !targetKey) {
    console.error('[❌ FAILED] Missing credentials in .env (ACCOUNT_1).')
    process.exitCode = 1
    return
  }

  const adminKey = PrivateKey.fromString(operatorKey)
  const userKey = PrivateKey.fromString(targetKey)
  const userId = AccountId.fromString(targetId)

  try {
    // 1. Verify Child Wallet Identity
    console.log(`[⚙️ PROCESS] Verifying Child Wallet ${userId.toString()} on-chain...`)
    const balance = await new MirrorNodeAccountBalanceQuery().setAccountId(userId).execute(client)
    console.log(`[✅ SUCCESS] Child Wallet Verified (Balance: ${balance.hbars.toString()})`)

    // 2. Create a KYC-Regulated Token
    console.log('\n[⚙️ PROCESS] Issuing a Regulated Financial Token (RFT)...')
    const tokenId = await reuseToken('REUSE_M3_02_TOKEN', async () => {
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('Regulated Financial Token')
        .setTokenSymbol('RFT')
        .setDecimals(0)
        .setInitialSupply(100)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setAdminKey(adminKey)
        .setKycKey(adminKey)
        .setFreezeKey(adminKey)
        .freezeWith(client)
      return (await (await tokenTx.execute(client)).getReceipt(client)).tokenId
    })

    console.log(`[✅ SUCCESS] Token Created: ${tokenId.toString()}`)

    // 3. MANDATORY: Associate with robust signing
    console.log(`\n[⚙️ PROCESS] Associating ${targetId} with the token (User Opt-in)...`)
    const associateTx = await new TokenAssociateTransaction()
      .setAccountId(userId)
      .setTokenIds([tokenId])
      .freezeWith(client)

    // Explicitly sign with both User (Target) and Admin (Payer)
    await associateTx.sign(userKey)
    // Re-running the lab reuses the token, and an account can only be associated once.
    try {
      const assocResponse = await associateTx.execute(client)
      await assocResponse.getReceipt(client)
      console.log('[✅ SUCCESS] Association Success.')
    } catch (error) {
      if (!/TOKEN_ALREADY_ASSOCIATED/.test(String(error?.status ?? error?.message))) throw error
      console.log('[ℹ️ INFO] Already associated on an earlier run: nothing to do.')
    }

    // 4. Grant KYC
    console.log(`\n[⚙️ PROCESS] Granting KYC clearance to ${targetId} via adminKey...`)
    const kycTx = await new TokenGrantKycTransaction()
      .setAccountId(userId)
      .setTokenId(tokenId)
      .freezeWith(client)

    const kycResponse = await kycTx.execute(client)
    const kycReceipt = await kycResponse.getReceipt(client)
    console.log(`[📊 LOG] KYC Grant Status: ${kycReceipt.status.toString()}`)

    // 5. Demonstrate Freezing
    console.log(`\n[⚙️ PROCESS] Freezing token assets for ${targetId} (Temporary Lock simulation)...`)
    const freezeTx = await new TokenFreezeTransaction()
      .setAccountId(userId)
      .setTokenId(tokenId)
      .freezeWith(client)

    const freezeResponse = await freezeTx.execute(client)
    await freezeResponse.getReceipt(client)
    console.log('[✅ SUCCESS] Freeze Status: SUCCESS')

    // 6. Demonstrate Unfreezing
    console.log(`\n[⚙️ PROCESS] Unfreezing token assets for ${targetId} (Restoring Access)...`)
    const unfreezeTx = await new TokenUnfreezeTransaction()
      .setAccountId(userId)
      .setTokenId(tokenId)
      .freezeWith(client)

    const unfreezeResponse = await unfreezeTx.execute(client)
    await unfreezeResponse.getReceipt(client)
    console.log('[✅ SUCCESS] Unfreeze Status: SUCCESS')

    console.log('\n[ℹ️ INFO] Ready for Lab 03 (NFT HIP-412).')

    console.log('\n💡 KEY CONCEPT:')
    console.log('Native Compliance: In the Ethereum world, you have to write custom')
    console.log('code inside a smart contract for this. On Hedera, this is a native')
    console.log('configuration of the Token itself, making it more secure and easier to')
    console.log('audit.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Compliance Flow Failed:', error.message)
    process.exitCode = 1
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
