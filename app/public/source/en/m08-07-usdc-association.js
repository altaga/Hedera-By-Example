/**
 * ============================================================================
 * Lab 07: USDC Association Bridge
 * [CONCEPT] Anti-Spam Intentionality
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Anti-Spam Shield: An account receives a token only after it is
 * associated with it ("Opt-In"), either explicitly with TokenAssociate or
 * through its auto-association slots. An account with no free slots cannot be
 * sent tokens it never chose; airdrops to it stay pending until it claims them
 * (HIP-904). Accounts set to unlimited auto-association (as in M0 Lab 03)
 * accept any token, so that protection is a setting you choose.
 * This lab explicitly associates the Operator with the official Circle USDC.
 *
 *
 * [ LEARNABLE MOMENT ]
 * When deploying smart contracts that hold or route USDC or other HTS tokens, the contract must associate the token class (either via precompile 0x167 or prior to deployment) to receive transfers without error.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/evm/hedera-services/system-contracts/hts
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 06: Advanced USDC Token Interactions (ERC-20)
 * - Next:     M8 Lab 08: Advanced HTS Precompiles
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M8_Smart_Contracts_EVM/07_usdc_association.js
 * ============================================================================
 */

import {
  AccountId,
  TokenAssociateTransaction, TokenId
} from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: USDC Association Bridge ---\n')
  console.log('[INFO] INITIALIZING PREREQUISITE POLICY\n')

  const { client, operatorId } = getClient()
  const USDC_TOKEN_ID = '0.0.429274'

  try {
    console.log(`[PROCESS] Associating Operator (${operatorId}) with USDC (${USDC_TOKEN_ID})...`)

    // Associate first: an account must opt in to a token before it can hold it.
    const tx = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(operatorId))
      .setTokenIds([TokenId.fromString(USDC_TOKEN_ID)])
      .execute(client)

    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const receipt = await tx.getReceipt(client)

    console.log(`\n[SUCCESS] ASSOCIATION SUCCESSFUL (Status: ${receipt.status.toString()})`)
    console.log('[INFO] Operator is now ready to hold and transfer USDC.')

    console.log('\n KEY CONCEPT:')
    console.log('The Anti-Spam Shield: with no free auto-association slots, a wallet only')
    console.log('holds tokens it associated with on purpose. Unlimited auto-association')
    console.log('trades that protection for convenience.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    if (error.message.includes('TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT')) {
      console.log('\n [LOG] Note: Operator is already associated. Skipping.')
    } else {
      console.error(`\n[FAILED] ASSOCIATION FAILED: ${error.message}`)
      process.exitCode = 1
    }
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
