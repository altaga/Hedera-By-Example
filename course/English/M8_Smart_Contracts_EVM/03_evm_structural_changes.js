/**
 * ============================================================================
 * Lab 03: Structural Differences and Rent Mechanics
 * [CONCEPT] Operational Sustainability & State Management
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Sustainable Ledger: Unlike Ethereum, where state storage is "Free but
 * Expensive Upfront", Hedera uses an "Auto-Renewal Rent" model. This keeps the
 * network lean by pruning abandoned contracts. Contracts must maintain an
 * HBAR balance for periodic auto-renewal fees. This script shows how to
 * programmatically extend a contract's lifespan by setting its
 * `autoRenewPeriod`, ensuring it remains active on the ledger.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Hedera EVM contracts are governed by storage rent and auto-renew mechanics. Maintaining a funded auto-renew account ensures persistent contract storage across network upgrade epochs.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/evm/development/rent
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 02: Hybrid Environment
 * - Next:     M8 Lab 04: System Contracts
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M8 Lab 01 (this lab reads what it saved).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 03_evm_structural_changes.js
 * ============================================================================
 */

import { PrivateKey, ContractUpdateTransaction } from '@hiero-ledger/sdk'
import { getClient, getState } from '../M99_Utilities/index.js'

/**
 * Functional wrapper to top-up contract rent lifespan
 */
const extendContractLifespan = async (client, contractId, adminKey) => {
  console.log(`[PROCESS] Proposing lifespan extension for contract: ${contractId}...`)
  const thirtyDaysInSeconds = 30 * 24 * 60 * 60

  const tx = await new ContractUpdateTransaction()
    .setContractId(contractId)
    .setAutoRenewPeriod(thirtyDaysInSeconds)
    .freezeWith(client)

  const signed = await tx.sign(adminKey)
  const result = await signed.execute(client)

  // Wait for consensus: the receipt says whether the network accepted the transaction.
  return await result.getReceipt(client)
}

const main = async () => {
  console.log('--- SESSION START: Smart Contract Structural Management ---\n')

  const { client, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)
  const contractId = getState('SC_STORAGE_ID')

  if (!contractId) {
    console.error('[FAILED] Missing SC_STORAGE_ID in configuration. Run Lab 01 first.')
    process.exitCode = 1
    return
  }

  try {
    const receipt = await extendContractLifespan(client, contractId, adminKey)

    console.log(`\n[SUCCESS] Contract Lifespan Extended (Status: ${receipt.status.toString()})`)
    console.log('[LOG] Auto-renewal period is now set to 30 days.')
    console.log('[INFO] Contract will automatically pull rent from its balance or payer.')

    console.log('\n KEY CONCEPT:')
    console.log('The Sustainable Ledger: By enforcing rent, Hedera ensures that the')
    console.log('"State" of the network does not grow infinitely with junk data. This')
    console.log("script shows how to programmatically extend a contract's lifespan.")

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Lifespan Extension Failed:', error.message)
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

export { extendContractLifespan }
