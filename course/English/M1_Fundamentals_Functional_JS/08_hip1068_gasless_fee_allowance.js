/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 08: Native Gas Sponsorship & Allowance Grants (HIP-1068)
 * [ CONCEPT ] Gasless Web3 User Experience via Account Allowances
 * ============================================================================
 * [ KEY CONCEPT ]
 * In mainstream Web3 applications, forcing end-users to buy native crypto (HBAR)
 * before performing their first transaction creates massive onboarding friction.
 *
 * Hedera solves this natively without complex smart contracts via the
 * Account Allowance framework (governed by HIP-1068 principles).
 *
 * A sponsor account (Enterprise Treasury or dApp Paymaster) grants an HBAR
 * allowance to an end-user account (`AccountAllowanceApproveTransaction`).
 * The user can then dispatch an approved transfer (`addApprovedHbarTransfer`)
 * where funds are debited directly from the sponsor's balance, enabling
 * frictionless "Gasless" onboarding while preserving ledger security.
 * *
 * [ LEARNABLE MOMENT ]
 * Fee sponsorship under HIP-1068 allows enterprises to subsidize transaction costs for their users: dApp end-users can sign their own transactions while network execution fees are debited seamlessly from a corporate treasury allowance.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-1068
 *
 * [ LEARNING PATH ]
 * - Previous: M1 Lab 07: HIP-1261 Simple Fees Engine
 * - Next:     M2 Lab 01: Legacy Query Deprecation
 *
 * [ HOW TO RUN ]
 * node English/M1_Fundamentals_Functional_JS/08_hip1068_gasless_fee_allowance.js
 * ============================================================================
 */

import { AccountAllowanceApproveTransaction, TransferTransaction, Hbar, PrivateKey, Client } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getMirrorNodeBaseUrl, updateState, createClient, ensureFunded } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Native Gas Sponsorship & Allowances (HIP-1068) ---\n')

  const { client, operatorId } = getClient()
  const spenderId = process.env.ACCOUNT_1_ID
  const spenderKeyStr = process.env.ACCOUNT_1_PRIVATE_KEY
  const recipientId = process.env.ACCOUNT_2_ID || operatorId.toString()
  const mirrorBase = getMirrorNodeBaseUrl()

  if (!spenderId || !spenderKeyStr) {
    console.error('[❌ FAILED] Missing ACCOUNT_1_ID or ACCOUNT_1_PRIVATE_KEY in .env configuration.')
    process.exitCode = 1
    console.log('[ℹ️ INFO] Run M0 Lab 04 to provision child accounts first.')
    return
  }

  const spenderKey = PrivateKey.fromStringDer(spenderKeyStr)

  try {
    const ALLOWANCE_AMOUNT_HBAR = 0.1
    const SPONSORED_TRANSFER_HBAR = 0.005

    // STAGE 1: SPONSOR APPROVES ALLOWANCE TO USER (OR REUSES EXISTING ACTIVE GRANT)
    console.log(`[⚙️ PROCESS] Stage 1: Inspecting active on-chain allowance from Sponsor (${operatorId}) to Spender (${spenderId})...`)

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
      console.log(`[✅ SUCCESS] Active On-Chain Allowance Detected: ${activeAllowanceHbar} HBAR remaining.`)
      console.log('[ℹ️ INFO] Reusing existing grant (Zero redundant network approval fees).')
    } else {
      console.log(`[⚙️ PROCESS] Granting new ${ALLOWANCE_AMOUNT_HBAR} HBAR allowance on-chain...`)
      const approveTx = await new AccountAllowanceApproveTransaction()
        .approveHbarAllowance(operatorId, spenderId, Hbar.from(ALLOWANCE_AMOUNT_HBAR))
        .freezeWith(client)

      const approveResponse = await approveTx.execute(client)
      const approveReceipt = await approveResponse.getReceipt(client)
      console.log(`[✅ SUCCESS] Allowance Granted: Status ${approveReceipt.status.toString()}`)
      console.log(`[🔗 EXPLORER] Approval HashScan: ${getHashscanUrl(approveResponse)}`)
    }

    // STAGE 2: USER EXECUTES SPONSORED TRANSFER WITHOUT SPONSOR'S SIGNATURE
    console.log(`\n[⚙️ PROCESS] Stage 2: Spender (${spenderId}) transferring ${SPONSORED_TRANSFER_HBAR} HBAR debited from Sponsor's allowance...`)

    // Initialize spender client instance (Sponsor's key is NOT present here)
    // ACCOUNT_1 pays the fees of its own transactions here; keep it funded.
    await ensureFunded(client, spenderId, 5)
    const spenderClient = createClient()
    spenderClient.setOperator(spenderId, spenderKey)

    const transferTx = await new TransferTransaction()
      .addApprovedHbarTransfer(operatorId, new Hbar(-SPONSORED_TRANSFER_HBAR))
      .addHbarTransfer(recipientId, new Hbar(SPONSORED_TRANSFER_HBAR))
      .freezeWith(spenderClient)

    const transferResponse = await transferTx.execute(spenderClient)
    const transferReceipt = await transferResponse.getReceipt(spenderClient)

    console.log(`[✅ SUCCESS] Sponsored Transfer Settled: Status ${transferReceipt.status.toString()}`)
    console.log(`[📊 LOG] Transaction ID: ${transferResponse.transactionId.toString()}`)
    console.log(`[🔗 EXPLORER] Transfer HashScan: ${getHashscanUrl(transferResponse)}`)

    // STAGE 3: INTERROGATE SPONSOR'S REMAINING ALLOWANCES VIA MIRROR NODE
    console.log('\n[⚙️ PROCESS] Stage 3: Verifying remaining allowance on Mirror Node REST API...')
    const allowanceRes = await fetch(`${mirrorBase}/api/v1/accounts/${operatorId}/allowances/crypto`)

    if (allowanceRes.ok) {
      const data = await allowanceRes.json()
      const grant = data.allowances?.find(a => a.spender === spenderId.toString())
      if (grant) {
        const remainingHbar = grant.amount / 1e8
        console.log(`[📊 LOG] Verified Remaining Allowance: ${remainingHbar} HBAR for spender ${spenderId}`)
      }
    }

    updateState('HIP1068_SPONSOR_ID', operatorId.toString())
    updateState('HIP1068_SPENDER_ID', spenderId.toString())
    updateState('HIP1068_LAST_TRANSFER_TX_ID', transferResponse.transactionId.toString())

    console.log('\n💡 KEY CONCEPT:')
    console.log('Frictionless Gasless UX: The end-user signed ONLY as the spender.')
    console.log('The funds were debited directly from the sponsor without requiring co-signatures.')
    console.log('This enables gaming, enterprise ticketing, and Web3 apps to subsidize')
    console.log('user activity seamlessly with zero smart contract vulnerabilities.')

    client.close()
    spenderClient.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error(`\n[❌ FAILED] Gasless Allowance Execution Failed: ${error.message}`)
    process.exitCode = 1
    if (client) client.close()
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
