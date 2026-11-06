/**
 * ============================================================================
 * Lab 08: HBAR Allowances & Sponsored Spending (HIP-336)
 * [CONCEPT] Let a User Spend From a Sponsor's Treasury Without the Sponsor's Key
 * ============================================================================
 * [ KEY CONCEPT ]
 * HIP-336 (Approval and Allowance API) lets an owner approve a spender for a
 * maximum HBAR amount (`AccountAllowanceApproveTransaction`). The spender then
 * builds a transfer with `addApprovedHbarTransfer(owner, -amount)` and signs it
 * ALONE: the amount is debited from the owner's balance, not the spender's.
 *
 * Be precise about fees: the spender is the transaction payer here, so it still
 * pays its own small network fee. For true fee sponsorship (the user holds 0 HBAR)
 * the sponsor must be the TransactionId payer and co-sign — see M13 Lab 02.
 *
 * [ LEARNABLE MOMENT ]
 * Allowances move value without sharing keys; the payer in the TransactionId decides
 * who pays the network fee. They are two different tools.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://github.com/hiero-ledger/hiero-improvement-proposals/blob/main/HIP/hip-336.md
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/approve-an-allowance
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/transactions/transaction-id
 *
 * [ LEARNING PATH ]
 * - Previous: M1 Lab 07: HIP-1261 Simple Fees & Deterministic Pricing Engine
 * - Next:     M2 Lab 01: Deprecation of Synchronous State Queries
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the sponsor (owner of the allowance).
 * - Spender: ACCOUNT_1 from .env if set, otherwise a throwaway account (0.5 ℏ) funded by the operator.
 * - Cost: <1 ℏ.
 *
 * [ HOW TO RUN ]
 * node English/M1_Fundamentals_Functional_JS/08_hip1068_gasless_fee_allowance.js
 * ============================================================================
 */

import { AccountAllowanceApproveTransaction, TransferTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getMirrorNodeBaseUrl, updateState, createClient, ensureFunded, createLabAccount, parsePrivateKey } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HBAR Allowances & Sponsored Spending (HIP-336) ---\n')

  const { client, operatorId } = getClient()
  const mirrorBase = getMirrorNodeBaseUrl()
  // ACCOUNT_1 from .env if set; otherwise a throwaway account funded by the operator
  const spender = process.env.ACCOUNT_1_ID && process.env.ACCOUNT_1_PRIVATE_KEY
    ? { accountId: process.env.ACCOUNT_1_ID, privateKey: parsePrivateKey(process.env.ACCOUNT_1_PRIVATE_KEY) }
    : await createLabAccount(client, { hbar: 0.5 })
  const spenderId = spender.accountId.toString()
  const spenderKey = spender.privateKey
  const recipientId = process.env.ACCOUNT_2_ID || operatorId.toString()

  try {
    const ALLOWANCE_AMOUNT_HBAR = 0.1
    const SPONSORED_TRANSFER_HBAR = 0.005

    // STAGE 1: SPONSOR APPROVES ALLOWANCE TO USER (OR REUSES EXISTING ACTIVE GRANT)
    console.log(`[PROCESS] Stage 1: Inspecting active on-chain allowance from Sponsor (${operatorId}) to Spender (${spenderId})...`)

    let activeAllowanceHbar = 0
    try {
      const checkRes = await fetch(`${mirrorBase}/api/v1/accounts/${operatorId}/allowances/crypto`)
      if (checkRes.ok) {
        const checkData = await checkRes.json()
        const found = checkData.allowances?.find(a => a.spender === spenderId.toString())
        if (found) activeAllowanceHbar = found.amount / 1e8
      }
    } catch (_) {}

    if (activeAllowanceHbar >= SPONSORED_TRANSFER_HBAR) {
      console.log(`[SUCCESS] Active On-Chain Allowance Detected: ${activeAllowanceHbar} HBAR remaining.`)
      console.log('[INFO] Reusing existing grant (Zero redundant network approval fees).')
    } else {
      console.log(`[PROCESS] Granting new ${ALLOWANCE_AMOUNT_HBAR} HBAR allowance on-chain...`)
      const approveTx = await new AccountAllowanceApproveTransaction()
        .approveHbarAllowance(operatorId, spenderId, Hbar.from(ALLOWANCE_AMOUNT_HBAR))
        .freezeWith(client)

      const approveResponse = await approveTx.execute(client)
      const approveReceipt = await approveResponse.getReceipt(client)
      console.log(`[SUCCESS] Allowance Granted: Status ${approveReceipt.status.toString()}`)
      console.log(`[EXPLORER] Approval HashScan: ${getHashscanUrl(approveResponse)}`)
    }

    // STAGE 2: USER EXECUTES SPONSORED TRANSFER WITHOUT SPONSOR'S SIGNATURE
    console.log(`\n[PROCESS] Stage 2: Spender (${spenderId}) transferring ${SPONSORED_TRANSFER_HBAR} HBAR debited from Sponsor's allowance...`)

    // Initialize spender client instance (Sponsor's key is NOT present here)
    // ACCOUNT_1 pays the fees of its own transactions here; keep it funded.
    await ensureFunded(client, spenderId, 1)
    const spenderClient = createClient()
    spenderClient.setOperator(spenderId, spenderKey)

    const transferTx = await new TransferTransaction()
      .addApprovedHbarTransfer(operatorId, new Hbar(-SPONSORED_TRANSFER_HBAR))
      .addHbarTransfer(recipientId, new Hbar(SPONSORED_TRANSFER_HBAR))
      .freezeWith(spenderClient)

    const transferResponse = await transferTx.execute(spenderClient)
    const transferReceipt = await transferResponse.getReceipt(spenderClient)

    console.log(`[SUCCESS] Sponsored Transfer Settled: Status ${transferReceipt.status.toString()}`)
    console.log(`[LOG] Transaction ID: ${transferResponse.transactionId.toString()}`)
    console.log(`[EXPLORER] Transfer HashScan: ${getHashscanUrl(transferResponse)}`)

    // STAGE 3: INTERROGATE SPONSOR'S REMAINING ALLOWANCES VIA MIRROR NODE
    console.log('\n[PROCESS] Stage 3: Verifying remaining allowance on Mirror Node REST API...')
    const allowanceRes = await fetch(`${mirrorBase}/api/v1/accounts/${operatorId}/allowances/crypto`)

    if (allowanceRes.ok) {
      const data = await allowanceRes.json()
      const grant = data.allowances?.find(a => a.spender === spenderId.toString())
      if (grant) {
        const remainingHbar = grant.amount / 1e8
        console.log(`[LOG] Verified Remaining Allowance: ${remainingHbar} HBAR for spender ${spenderId}`)
      }
    }

    updateState('HIP1068_SPONSOR_ID', operatorId.toString())
    updateState('HIP1068_SPENDER_ID', spenderId.toString())
    updateState('HIP1068_LAST_TRANSFER_TX_ID', transferResponse.transactionId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('Allowance spending: the spender signed alone (and paid its own network fee).')
    console.log('The funds were debited directly from the sponsor without requiring co-signatures.')
    console.log('To also sponsor the fee, make the sponsor the TransactionId payer (M13 Lab 02).')

    client.close()
    spenderClient.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error(`\n[FAILED] Gasless Allowance Execution Failed: ${error.message}`)
    process.exitCode = 1
    if (client) client.close()
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
