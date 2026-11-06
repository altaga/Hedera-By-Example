/**
 * ============================================================================
 * Lab 05: Authorization Protocols and Allowances
 * [CONCEPT] Native Delegate Permission Layer
 * ============================================================================
 * [ KEY CONCEPT ]
 * Granular Security: In traditional DeFi, you use `approve()` in an ERC-20
 * contract. Hedera offers a more secure, native version:
 * `AccountAllowanceApproveTransaction`. This allows the ledger itself to
 * track who is allowed to spend what, without needing to pay for smart
 * contract processing for every single permission check. These allowances
 * can be revoked independently and are visible in any explorer, providing a
 * "Permission Dashboard" for users to safely interact with complex DeFi
 * protocols.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Using CryptoApproveAllowance in conjunction with smart contracts allows precise, time-bounded spending caps, preventing malicious or buggy contracts from draining master account balances.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/approve-an-allowance
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 04: The Hedera System Oracle
 * - Next:     M8 Lab 06: Advanced USDC Token Interactions (ERC-20)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M8 Lab 01 (this lab reads what it saved).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M8_Smart_Contracts_EVM/05_authorization_protocols.js
 * ============================================================================
 */

import {
  AccountId, PrivateKey,
  AccountAllowanceApproveTransaction, Hbar
} from '@hiero-ledger/sdk'
import { getClient, getState } from '../M99_Utilities/index.js'

/**
 * Functional wrapper for establishing Spender allow-lists natively
 */
const establishContractApproval = async (client, ownerId, ownerKey, spenderContractId) => {
  console.log(`[PROCESS] Approving 5 HBAR allowance for contract: ${spenderContractId}...`)

  // Approve an allowance: the spender may move up to this amount on the owner's behalf.
  const tx = await new AccountAllowanceApproveTransaction()
    .approveHbarAllowance(
      ownerId, // Owner
      spenderContractId, // Spender (Smart Contract)
      new Hbar(5) // Amount
    )
    .freezeWith(client)

  const signedTx = await tx.sign(ownerKey)
  const txResponse = await signedTx.execute(client)

  // Wait for consensus: the receipt says whether the network accepted the transaction.
  return await txResponse.getReceipt(client)
}

const main = async () => {
  console.log('--- SESSION START: Native Authorization Protocols ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const ownerKey = PrivateKey.fromString(operatorKey)
  const contractId = getState('SC_STORAGE_ID')

  if (!contractId) {
    console.error('[FAILED] Missing SC_STORAGE_ID in configuration. Run Lab 01 first.')
    process.exitCode = 1
    return
  }

  try {
    const receipt = await establishContractApproval(
      client,
      AccountId.fromString(operatorId),
      ownerKey,
      contractId
    )

    console.log(`\n[SUCCESS] Native Allowance Established (Status: ${receipt.status.toString()})`)
    console.log(`[LOG] Contract ${contractId} is now authorized to spend 5 HBAR.`)
    console.log('[INFO] This is the professional alternative to EVM-side approvals.')

    console.log('\n KEY CONCEPT:')
    console.log('Granular Security: Native allowances on Hedera can be revoked')
    console.log('independently and are visible in any explorer. This provides a')
    console.log('"Permission Dashboard" for users to safely interact with complex DeFi')
    console.log('protocols.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Authorization Protocol Failed:', error.message)
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

export { establishContractApproval }
