/**
 * ============================================================================
 * Lab 03: Stablecoin Roles on HTS (Stablecoin Studio Concepts)
 * [CONCEPT] Segregation of Duties in Fiat-Backed Stablecoins
 * ============================================================================
 * [ KEY CONCEPT ]
 * A fiat-backed stablecoin needs separate powers: Cash-In (mint/burn), Freeze, Wipe
 * and KYC. HTS lets each power be a DIFFERENT key on the token, enforced by the
 * network. This lab creates a token with five separate role keys and proves it:
 *   - a mint signed only by the operator is rejected (INVALID_SIGNATURE);
 *   - the Cash-In key mints; the KYC key grants KYC to a holder;
 *   - the Freeze key freezes the holder, and a transfer to it is rejected;
 *   - the Wipe key wipes the holder's balance (court-ordered clawback).
 *
 * [ LEARNABLE MOMENT ]
 * Hedera's Stablecoin Studio builds the same role model with its own SDK and
 * factory contracts; this lab shows the underlying native HTS roles directly.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://github.com/hashgraph/stablecoin-studio
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/define-a-token
 *
 * [ LEARNING PATH ]
 * - Previous: M11 Lab 02: Tranche Bonds on HTS & Coupon Payouts (ERC-1400 Concepts)
 * - Next:     M11 Lab 04: Proof-of-Reserve (PoR) Oracle & Circuit Breakers
 *
 * [ SIMULATED ]
 * The bank wire and the AML/court decisions are narrative; the role keys, mint, KYC, freeze and wipe are real. The Stablecoin Studio SDK and contracts are not used.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (creates a token and 1 throwaway holder).
 * - Cost: ~17 ℏ (token creation ~15 ℏ on testnet) + 0.05 ℏ for the holder + fees.
 *
 * [ HOW TO RUN ]
 * node English/M11_Hedera_Studios_RWA/03_stablecoin_studio_role_management.js
 * ============================================================================
 */

import {
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenFreezeTransaction,
  TokenUnfreezeTransaction,
  TokenGrantKycTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType,
  TokenWipeTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { createLabAccount, getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

const run = async (tx, client, ...keys) => {
  const frozen = tx.freezeWith(client)
  for (const k of keys) await frozen.sign(k)
  const res = await frozen.execute(client)
  return { res, receipt: await res.getReceipt(client) }
}

const main = async () => {
  console.log('--- SESSION START: Stablecoin Roles on HTS ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Segregated role keys
    console.log('[PROCESS] Step 1: Generating segregated role keys...')
    const roles = {
      cashIn: PrivateKey.generateECDSA(),
      freeze: PrivateKey.generateECDSA(),
      wipe: PrivateKey.generateECDSA(),
      kyc: PrivateKey.generateECDSA()
    }
    for (const [name, key] of Object.entries(roles)) console.log(`[LOG] ${name.padEnd(6)} key: ${key.publicKey.toStringRaw().substring(0, 20)}...`)

    // 2. Token where every power is a different key
    console.log('\n[PROCESS] Step 2: Creating the stablecoin with one key per role...')
    const { receipt: createReceipt } = await run(new TokenCreateTransaction()
      .setTokenName('Hedera Digital Dollar')
      .setTokenSymbol('USDD')
      .setDecimals(6)
      .setInitialSupply(0)
      .setTokenType(TokenType.FungibleCommon)
      .setSupplyType(TokenSupplyType.Infinite)
      .setTreasuryAccountId(operatorId)
      .setAdminKey(client.operatorPublicKey)
      .setSupplyKey(roles.cashIn.publicKey)
      .setFreezeKey(roles.freeze.publicKey)
      .setWipeKey(roles.wipe.publicKey)
      .setKycKey(roles.kyc.publicKey)
      .setTokenMemo('hbe:stablecoin-roles'), client)
    const tokenId = createReceipt.tokenId
    console.log(`[SUCCESS] Stablecoin ${tokenId} — https://hashscan.io/testnet/token/${tokenId}`)

    // 3. Operator alone cannot mint
    console.log('\n[PROCESS] Step 3: Mint signed only by the operator (no Cash-In key)...')
    try {
      await run(new TokenMintTransaction().setTokenId(tokenId).setAmount(1_000_000), client)
      throw new Error('Mint without the Cash-In key should fail')
    } catch (error) {
      if (/should fail/.test(error.message)) throw error
      console.log(`[REJECTED] ${error.status ?? error.message}`)
    }

    // 4. Cash-In key mints 250,000 USDD
    console.log('\n[PROCESS] Step 4: Cash-In role mints 250,000 USDD after the (narrative) bank wire...')
    const { res: mintRes, receipt: mintReceipt } = await run(new TokenMintTransaction().setTokenId(tokenId).setAmount(250_000 * 1_000_000), client, roles.cashIn)
    console.log(`[SUCCESS] Total supply ${mintReceipt.totalSupply} — ${getHashscanUrl(mintRes)}`)

    // 5. KYC + transfer to a holder
    console.log('\n[PROCESS] Step 5: KYC role approves a holder; treasury sends 1,000 USDD...')
    const holder = await createLabAccount(client, { hbar: 0.05 })
    await run(new TokenAssociateTransaction().setAccountId(holder.accountId).setTokenIds([tokenId]), client, holder.privateKey)
    await run(new TokenGrantKycTransaction().setTokenId(tokenId).setAccountId(holder.accountId), client, roles.kyc)
    const send = (amount) => run(new TransferTransaction()
      .addTokenTransfer(tokenId, operatorId, -amount)
      .addTokenTransfer(tokenId, holder.accountId, amount), client)
    await send(1_000 * 1_000_000)
    console.log(`[SUCCESS] Holder ${holder.accountId} received 1,000 USDD`)

    // 6. Freeze role
    console.log('\n[PROCESS] Step 6: Freeze role freezes the flagged holder; a new transfer must fail...')
    await run(new TokenFreezeTransaction().setTokenId(tokenId).setAccountId(holder.accountId), client, roles.freeze)
    try {
      await send(1_000_000)
      throw new Error('Transfer to a frozen account should fail')
    } catch (error) {
      if (/should fail/.test(error.message)) throw error
      console.log(`[REJECTED] ${error.status ?? error.message}`)
    }

    // 7. Wipe role
    console.log('\n[PROCESS] Step 7: Wipe role claws back the holder balance...')
    // Wipe requires an unfrozen relationship: unfreeze first, then claw back
    await run(new TokenUnfreezeTransaction().setTokenId(tokenId).setAccountId(holder.accountId), client, roles.freeze)
    const { res: wipeRes, receipt: wipeReceipt } = await run(new TokenWipeTransaction().setTokenId(tokenId).setAccountId(holder.accountId).setAmount(1_000 * 1_000_000), client, roles.wipe)
    console.log(`[SUCCESS] Wiped 1,000 USDD; total supply now ${wipeReceipt.totalSupply} — ${getHashscanUrl(wipeRes)}`)

    updateState('STABLECOIN_TOKEN_ID', tokenId.toString())
    updateState('STABLECOIN_MINT_TX_ID', mintRes.transactionId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('Each power is a separate key checked by the network: no single admin can mint,')
    console.log('freeze and claw back alone.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Stablecoin governance failed:', error.message)
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
