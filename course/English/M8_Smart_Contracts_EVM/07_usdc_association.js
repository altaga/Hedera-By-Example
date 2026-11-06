/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 07: USDC Association Bridge
 * [CONCEPT] Anti-Spam Intentionality
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Anti-Spam Shield: On Hedera, you cannot "Spam" someone with tokens.
 * An account must explicitly "Opt-In" to a token before it can receive any
 * balance. This is called "Token Association". This is a powerful security
 * feature that ensures your wallet is never cluttered with useless tokens
 * and that your account state is only used for assets you trust and authorize.
 * This lab explicitly associates the Operator with the official Circle USDC.
 * *
 * [ LEARNABLE MOMENT ]
 * When deploying smart contracts that hold or route USDC or other HTS tokens, the contract must associate the token class (either via precompile 0x167 or prior to deployment) to receive transfers without error.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/evm/hedera-services/system-contracts/hts
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 06: ERC20 USDC Interaction
 * - Next:     M9 Lab 01: Client Initialization
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 07_usdc_association.js
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
    console.log('The Anti-Spam Shield: Association is a powerful security feature. It')
    console.log('ensures that your wallet is never cluttered with useless tokens and')
    console.log('that your account state is only used for assets you trust.')

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
