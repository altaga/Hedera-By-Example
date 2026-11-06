/**
 * ============================================================================
 * Lab 01: Generate Local Wallet
 * [CONCEPT] Cryptographic Identity Generation
 * ============================================================================
 * [ KEY CONCEPT ]
 * Security starts offline. By generating your keys locally, you ensure the
 * network never sees your private key—only the public cryptographic proofs
 * you sign.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Never generate production keys in an online web tool or unencrypted environment. Generating your ECDSA key pair locally allows you to compute the deterministic EVM address (0x...) before ever funding the account or submitting an L1 transaction.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/keys
 *
 * [ LEARNING PATH ]
 * - Previous: N/A (Course Start)
 * - Next:     Lab 02: Account Verification
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: none. This lab runs entirely on your machine (no network calls).
 *
 * [ HOW TO RUN ]
 * node 01_generate_wallet.js
 * ============================================================================
 */

import { PrivateKey } from '@hiero-ledger/sdk'
import { updateEnv, loadEnv } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Hedera ECDSA Wallet Generation ---\n')

  // 1. Generate a random ECDSA private key. The EVM address derived from it is deterministic.
  console.log('[PROCESS] Generating secure ECDSA private key pair...')
  const privateKey = PrivateKey.generateECDSA()
  const publicKey = privateKey.publicKey

  // 2. Derive the standard Ethereum alias (0x...) from the public key
  const evmAddress = publicKey.toEvmAddress()

  console.log('[SUCCESS] Generated New Private Key.')
  console.log(`[LOG] Private Key: ${privateKey.toStringDer()}`)
  console.log(`[LOG] Public Key:  ${publicKey.toStringDer()}`)
  console.log(`[LOG] EVM Address: 0x${evmAddress}`)

  // 3. Save to .env as OPERATOR keys, unless an operator is already configured:
  //    overwriting only the key would leave OPERATOR_ID pointing at an account
  //    this new key does not control, and every later lab would fail.
  loadEnv()
  const inBrowser = typeof window !== 'undefined'
  if (process.env.OPERATOR_ID && process.env.OPERATOR_PRIVATE_KEY) {
    console.log(`\n[INFO] An operator is already configured (OPERATOR_ID=${process.env.OPERATOR_ID}).`)
    console.log('[INFO] The new key was NOT saved, so your current credentials keep working.')
    if (inBrowser) {
      console.log('[INFO] In this browser that operator is the wallet selected above. Nothing was written to a .env file.')
    } else {
      console.log('[INFO] To use this key as your operator, remove OPERATOR_ID and OPERATOR_PRIVATE_KEY from .env and run this lab again.')
    }
  } else {
    console.log(inBrowser
      ? '\n[INFO] No operator is configured in this browser yet. Use "Create wallet" in the header to fund one. The lines below are for running this file in Node.js.'
      : '\n[INFO] Synchronizing .env file...')
    if (!inBrowser) {
      updateEnv('OPERATOR_PRIVATE_KEY', privateKey.toStringDer())
      updateEnv('OPERATOR_EVM_ADDRESS', '0x' + evmAddress)
    }
    console.log('\n=======================================================')
    console.log('ACTION REQUIRED: FUND YOUR WALLET TO OBTAIN AN ACCOUNT ID')
    console.log('=======================================================')
    console.log('1. Go to the Hedera Testnet Faucet: https://portal.hedera.com/faucet')
    console.log(`2. Paste your EVM Address: 0x${evmAddress}`)
    console.log('3. Click \'Receive HBAR\'')
    console.log(`4. View your account on HashScan: https://hashscan.io/testnet/account/0x${evmAddress}`)
    console.log('5. Once you see your Account ID (0.0.X), run Lab 02.')
    console.log('=======================================================\n')
  }

  console.log('KEY CONCEPT:')
  console.log('Security starts offline. By generating your keys locally, you ensure')
  console.log('the network never sees your private key—only the public cryptographic')
  console.log('proofs you sign.')

  console.log('\n--- SESSION COMPLETE ---')
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
