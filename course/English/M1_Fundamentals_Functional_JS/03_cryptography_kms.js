/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Cryptography and Signature Delegation (KMS / HSM)
 * [ CONCEPT ] Signer-Agnostic Transaction Authority
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Hedera SDK is "Signer-Agnostic". It doesn't care *how* a signature is
 * generated, as long as it's cryptographically valid. This flexibility
 * allows for enterprise-level key management (AWS KMS, Azure Key Vault, etc.)
 * where developers never see the secrets they are using.
 * *
 * [ LEARNABLE MOMENT ]
 * Choose signature algorithms intentionally: Ed25519 provides superior cryptographic throughput and smaller signatures, while ECDSA secp256k1 is required for native EVM and Ethereum tooling interoperability.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/keys-and-signatures
 *
 * [ LEARNING PATH ]
 * - Previous: M1 Lab 02: Account Rent
 * - Next:     M1 Lab 04: Key Rotation
 *
 * [ SIMULATED ]
 * The HSM / vault is an in-memory mock. The signatures are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: none. This lab runs entirely on your machine (no network calls).
 *
 * [ HOW TO RUN ]
 * node 03_cryptography_kms.js
 * ============================================================================
 */

import { AccountId, Hbar, PrivateKey, TransferTransaction, TransactionId } from '@hiero-ledger/sdk'

/**
 * Mock Hardware Security Module (HSM) / Vault
 * This simulates an isolated environment where the Private Key lives.
 */
class RemoteHSMVault {
  constructor () {
    // Generate an ephemeral keys within the isolated vault boundaries
    this._privateKey = PrivateKey.generateECDSA()
    this.publicKey = this._privateKey.publicKey
  }

  getPublicKey () {
    return this.publicKey
  }

  /**
   * Simulation: Signs a payload asynchronously.
   * The private key NEVER leaves this function.
   */
  async signPayload (payloadBuffer) {
    console.log('[⚙️ PROCESS] Vault: Signing payload securely inside HSM enclave...')
    return new Promise((resolve) => {
      setTimeout(() => {
        const signature = this._privateKey.sign(payloadBuffer)
        resolve(signature)
      }, 500) // Simulate network delay
    })
  }
}

/**
 * Main simulation logic
 */
const main = async () => {
  console.log('--- SESSION START: Signature Delegation Simulation ---\n')

  // 1. Initialize our isolated "Vault"
  const vault = new RemoteHSMVault()
  const vaultPubKey = vault.getPublicKey()

  console.log(`[ℹ️ INFO] Vault initialized. Public Identity: ${vaultPubKey.toStringDer().substring(0, 30)}...`)

  // 2. Create a transaction that needs a signature
  console.log('[⚙️ PROCESS] Constructing a native TransferTransaction...')
  const transaction = new TransferTransaction()
    .addHbarTransfer(AccountId.fromString('0.0.1001'), Hbar.fromTinybars(-100))
    .addHbarTransfer(AccountId.fromString('0.0.1002'), Hbar.fromTinybars(100))

  try {
    // 3. Delegation: We freeze the transaction and extract the bytes
    console.log('[ℹ️ INFO] Freezing transaction to extract raw bytes for signing...')
    transaction.setTransactionId(TransactionId.generate(AccountId.fromString('0.0.2')))
    transaction.setNodeAccountIds([AccountId.fromString('0.0.3')])
    transaction.freeze()

    const transactionBytes = transaction.toBytes()

    console.log('[⚙️ PROCESS] Sending bytes to the Vault for remote signing...')
    const signature = await vault.signPayload(transactionBytes)

    // 4. Inject the signature back into the SDK object
    console.log('[ℹ️ INFO] Injecting external signature back into SDK Transaction object...')
    transaction.addSignature(vaultPubKey, signature)

    console.log('\n[✅ SUCCESS] Transaction is now signed by the remote Vault.')
    console.log(`[📊 LOG] Signatures in object: ${transaction.getSignatures().size}`)
    console.log('[ℹ️ INFO] This transaction is now safe to submit to the network.')

    console.log('\n💡 KEY CONCEPT:')
    console.log("The Hedera SDK is \"Signer-Agnostic\". It doesn't care *how* a signature")
    console.log("is generated, as long as it's cryptographically valid. This")
    console.log('flexibility allows for enterprise-level key management where')
    console.log('developers never see the secrets they are using.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Signing Delegation Failed:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}

export { RemoteHSMVault }
