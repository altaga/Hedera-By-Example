/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Native Fee Sponsorship & Delegated Allowances (HIP-1068)
 * [CONCEPT] Gasless User & Agent Onboarding Without ERC-4337 Bundlers
 * ============================================================================
 * [ KEY CONCEPT ]
 * Native Fee Sponsorship vs. Allowances: On EVM chains, sponsoring gas fees
 * requires complex ERC-4337 bundlers, paymasters, and alt-mempools.
 * On Hedera, two native consensus primitives solve this cleanly:
 * 1. Designated Fee Payer (`TransactionId.generate(sponsorId)`): An agent with
 *    literally 0.0000 HBAR signs a transaction (e.g., mutating its account state
 *    or transferring tokens), while the Sponsor co-signs as the TransactionId
 *    payer to absorb 100% of the HBAR network fee.
 * 2. Delegated Allowances (`AccountAllowanceApproveTransaction`): The Sponsor
 *    authorizes an operator agent (the TransactionId caller) to spend HBAR from
 *    the Sponsor's treasury via `addApprovedHbarTransfer` without sharing keys.
 *
 * [ LEARNABLE MOMENT ]
 * On Hedera, `addApprovedHbarTransfer` identifies the "spender" by the
 * `TransactionId` payer account. For pure zero-HBAR gas sponsorship, you set
 * `TransactionId.generate(sponsorId)` and co-sign; for autonomous treasury
 * spending, the authorized spender signs the `TransactionId`.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-1068
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/approve-an-allowance
 *
 * [ LEARNING PATH ]
 * - Previous: M13 Lab 01: CLPR State Proof Verification (HIP-1535)
 * - Next:     M13 Lab 03: Block Stream & TSS Signature Verification (HIP-1056)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M13_Cross_Ledger_and_Data_Streams/02_sponsored_fees_allowance.js
 * ============================================================================
 */

import {
  Client,
  AccountId,
  AccountAllowanceApproveTransaction,
  AccountCreateTransaction,
  AccountUpdateTransaction,
  PrivateKey,
  TransactionId,
  TransferTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, updateState, sleep, createClient, ensureFunded } from '../M99_Utilities/index.js'

/**
 * Queries account balance in tinybars and HBAR using the Hedera Mirror Node REST API.
 *
 * @param {string} accountId - Target Account ID
 * @param {string} network - 'testnet' | 'mainnet'
 * @returns {Promise<{tinybars: number, formatted: string}>} Balance object
 */
const queryBalance = async (accountId, network = 'testnet') => {
  const res = await fetch(`https://${network}.mirrornode.hedera.com/api/v1/accounts/${accountId}`)
  if (!res.ok) return { tinybars: 0, formatted: '0.0000 HBAR' }
  const data = await res.json()
  const tinybars = Number(data?.balance?.balance ?? 0)
  return {
    tinybars,
    formatted: (tinybars / 1e8).toFixed(4) + 'HBAR'
  }
}

const main = async () => {
  console.log('--- SESSION START: Native Fee Sponsorship & Allowances (HIP-1068) ---\n')
  const { client, operatorId, operatorKey, network } = getClient()
  const sponsorAccountId = AccountId.fromString(operatorId)
  const sponsorKey = PrivateKey.fromStringDer(operatorKey)

  const delegateSpenderId = AccountId.fromString(process.env.ACCOUNT_1_ID)
  const delegateSpenderKey = PrivateKey.fromStringDer(process.env.ACCOUNT_1_PRIVATE_KEY)

  try {
    // 1. Create a literally ZERO-HBAR Agent account
    console.log('[PROCESS] Step 1: Creating ephemeral Agent with 0.0000 initial HBAR balance...')
    const zeroGasAgentKey = PrivateKey.generateED25519()
    const agentCreateTx = await new AccountCreateTransaction()
      .setKeyWithoutAlias(zeroGasAgentKey.publicKey)
      .setInitialBalance(new Hbar(0)) // Literally 0.0000 HBAR!
      .execute(client)

    const agentReceipt = await agentCreateTx.getReceipt(client)
    const zeroGasAgentId = agentReceipt.accountId
    console.log(`[SUCCESS] Zero-Balance Agent Created: ${zeroGasAgentId.toString()} (Key: ED25519)`)

    await sleep(3500)
    const initZeroAgentBal = await queryBalance(zeroGasAgentId.toString(), network)
    const initSponsorBal = await queryBalance(operatorId.toString(), network)
    console.log(`[LOG] Zero-Gas Agent Balance:  ${initZeroAgentBal.formatted}`)
    console.log(`[LOG] Sponsor Initial Balance: ${initSponsorBal.formatted}`)

    // 2. Primitive A: True Zero-HBAR Gas Sponsorship via Designated TransactionId Payer
    console.log(`\n[PROCESS] Step 2 (Gasless Sponsorship): 0-HBAR Agent (${zeroGasAgentId}) mutating its on-chain state...`)
    console.log(`[INFO] Consensus requires ${zeroGasAgentId}'s signature, while Sponsor (${operatorId}) pays 100% of gas.`)

    const gaslessUpdateTx = await new AccountUpdateTransaction()
      .setAccountId(zeroGasAgentId)
      .setAccountMemo('HIP-1068:Gasless-Agent-Verified')
      .setTransactionId(TransactionId.generate(sponsorAccountId))
      .freezeWith(client)

    // Agent signs to authorize its own state mutation; Sponsor signs to pay the network fee
    const signedByAgent = await gaslessUpdateTx.sign(zeroGasAgentKey)
    const signedByBoth = await signedByAgent.sign(sponsorKey)
    const gaslessResponse = await signedByBoth.execute(client)
    const gaslessReceipt = await gaslessResponse.getReceipt(client)

    console.log(`[SUCCESS] Gasless State Mutation Finalized! Tx: ${gaslessResponse.transactionId.toString()}`)
    console.log(`[LOG] Status: ${gaslessReceipt.status.toString()}`)

    await sleep(3500)
    const midZeroAgentBal = await queryBalance(zeroGasAgentId.toString(), network)
    const agentGasSpent = ((initZeroAgentBal.tinybars - midZeroAgentBal.tinybars) / 1e8).toFixed(8)
    console.log(`[LOG] Zero-Gas Agent Balance After Tx: ${midZeroAgentBal.formatted} (Gas Spent: ${agentGasSpent} HBAR)`)

    // 3. Primitive B: Delegated HBAR Allowance (Autonomous Treasury Spender)
    const allowanceAmount = new Hbar(2)
    console.log(`\n[PROCESS] Step 3 (Delegated Allowance): Sponsor (${operatorId}) approving ${allowanceAmount.toString()} to Spender (${delegateSpenderId})...`)

    const allowanceTx = await new AccountAllowanceApproveTransaction()
      .approveHbarAllowance(sponsorAccountId, delegateSpenderId, allowanceAmount)
      .execute(client)
    const allowanceReceipt = await allowanceTx.getReceipt(client)
    console.log(`[SUCCESS] Allowance Approved! Status: ${allowanceReceipt.status.toString()}`)

    // Spender transfers 0.25 HBAR from Sponsor's treasury to the Zero-Gas Agent without Sponsor's signature
    console.log(`\n[PROCESS] Spender (${delegateSpenderId}) drawing 0.25 HBAR from Sponsor's allowance to fund Agent (${zeroGasAgentId})...`)
    // ACCOUNT_1 pays the fees of its own transactions here; keep it funded.
    await ensureFunded(client, delegateSpenderId, 1)
    const spenderClient = createClient()
    spenderClient.setOperator(delegateSpenderId, delegateSpenderKey)

    const allowanceTransfer = await new TransferTransaction()
      .addApprovedHbarTransfer(sponsorAccountId, new Hbar(-0.25))
      .addHbarTransfer(zeroGasAgentId, new Hbar(0.25))
      .setTransactionMemo('HIP-1068:DelegatedAllowanceSpend')
      .execute(spenderClient)
    const transferReceipt = await allowanceTransfer.getReceipt(spenderClient)
    spenderClient.close()

    console.log(`[SUCCESS] Delegated Allowance Transfer Executed! Tx: ${allowanceTransfer.transactionId.toString()}`)
    console.log(`[LOG] Status: ${transferReceipt.status.toString()}`)

    await sleep(3500)
    const finalZeroAgentBal = await queryBalance(zeroGasAgentId.toString(), network)
    const finalSponsorBal = await queryBalance(operatorId.toString(), network)

    console.log('\n[LOG] Post-Execution Audit (Mirror Node Verified):')
    console.log(`[LOG] Agent Gas Spent in Step 2: ${agentGasSpent} HBAR (100% Sponsored)`)
    console.log(`[LOG] Agent Final Balance:       ${finalZeroAgentBal.formatted} (Received 0.25 HBAR via Allowance)`)
    console.log(`[LOG] Sponsor Final Balance:     ${finalSponsorBal.formatted}`)

    // Persist state
    updateState('SPONSORED_AGENT_ID', zeroGasAgentId.toString())
    updateState('SPONSORED_ALLOWANCE_HBAR', allowanceAmount.toString())
    updateState('SPONSORED_LAST_TX_ID', allowanceTransfer.transactionId.toString())
    updateState('SPONSORED_AGENT_GAS_SPENT', `${agentGasSpent} HBAR`)

    console.log('\n KEY CONCEPT:')
    console.log('Hedera provides both native fee sponsorship (via TransactionId payer co-signing)')
    console.log('and native treasury allowances (via AccountAllowanceApproveTransaction), enabling')
    console.log('zero-HBAR onboarding and autonomous budget delegation at the consensus layer.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('In Hedera, `addApprovedHbarTransfer` checks that the `TransactionId` payer is the')
    console.log('approved spender, while `TransactionId.generate(sponsorId)` allows any 0-HBAR')
    console.log('account to execute transactions with its gas paid 100% by a sponsor.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Sponsored Fee Execution Failure:', error.message)
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
