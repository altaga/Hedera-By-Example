/**
 * ============================================================================
 * Lab 01: HTS Immutable Issuance
 * [CONCEPT] Protocol-Level Fungible Tokens
 * ============================================================================
 * [ KEY CONCEPT ]
 * Power of Keys: By setting an `adminKey`, you keep the power to update the
 * token's properties. By setting a `supplyKey`, you keep the power to mint
 * more. If you remove these keys (set them to `null`), the token becomes
 * "Immutable"—mathematically guaranteed to never change. This is the
 * foundation of native trust on Hedera.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Omission is true immutability: by deliberately setting adminKey = null when creating a token, you permanently surrender control. The token rules and supply become mathematically enforced by the consensus layer forever.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/define-a-token
 *
 * [ LEARNING PATH ]
 * - Previous: M2 Lab 07: Mirror Node Query Aggregator (GraphQL-Style Resolvers)
 * - Next:     M3 Lab 02: Financial Identity and Compliance (KYC)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD); <0.1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M3_Hedera_Token_Service/01_immutable_issuance.js
 * ============================================================================
 */

import {
  AccountId, PrivateKey,
  TokenCreateTransaction, TokenType, TokenSupplyType
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HTS Fungible Token Issuance ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const treasuryKey = PrivateKey.fromString(operatorKey)

  try {
    console.log('[PROCESS] Creating Hedera Syllabus Coin (HSC) on the network...')

    // 1. Define and Execute Token Creation
    const tokenId = await reuseToken('REUSE_M3_01_TOKEN', async () => {
      const transaction = await new TokenCreateTransaction()
        .setTokenName('Hedera Syllabus Coin')
        .setTokenSymbol('HSC')
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(2)
        .setInitialSupply(1000000) // 10,000.00 HSC (since decimals is 2)
        .setMaxSupply(10000000)
        .setSupplyType(TokenSupplyType.Finite)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setAdminKey(treasuryKey)
        .setSupplyKey(treasuryKey) // Allows for future minting/burning
        .setPauseKey(treasuryKey) // Allows for emergency stopping
        .freezeWith(client)

      const response = await transaction.execute(client)

      console.log(`[LOG] View on HashScan: ${getHashscanUrl(response)}`)

      const receipt = await response.getReceipt(client)
      return receipt.tokenId
    })

    console.log(`\n[SUCCESS] Token Created Successfully: ${tokenId.toString()}`)

    // Automatically sync for use in M5 transfers
    console.log('[INFO] Synchronizing state.json with new Token ID...')
    updateState('FT_TOKEN_ID', tokenId.toString())

    console.log(`[LOG] Treasury Account: ${operatorId}`)
    console.log('[INFO] Initial Supply is now ready in the Treasury.')

    console.log('\n KEY CONCEPT:')
    console.log('Power of Keys: By setting an `adminKey`, you keep the power to update')
    console.log("the token's properties. By setting a `supplyKey`, you keep the power")
    console.log('to mint more. If you remove these keys (set them to `null`), the token')
    console.log('becomes "Immutable"—mathematically guaranteed to never change.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Token Issuance Failed:', error.message)
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
