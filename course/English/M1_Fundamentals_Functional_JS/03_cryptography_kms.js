/**
 * ============================================================================
 * Lab 03: Cryptography and Signature Delegation (KMS / HSM)
 * [CONCEPT] Signer-Agnostic Transaction Authority
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Hedera SDK is "Signer-Agnostic". It doesn't care *how* a signature is
 * generated, as long as it's cryptographically valid. This flexibility
 * allows for enterprise-level key management (AWS KMS, Azure Key Vault, etc.)
 * where developers never see the secrets they are using.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Choose signature algorithms intentionally: Ed25519 provides superior cryptographic throughput and smaller signatures, while ECDSA secp256k1 is required for native EVM and Ethereum tooling interoperability.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/keys-and-signatures
 *
 * [ LEARNING PATH ]
 * - Previous: M1 Lab 02: State Rent & Account Lifecycle
 * - Next:     M1 Lab 04: Account Key Rotation
 *
 * The "vault" here is WebCrypto: the key is generated as non-extractable, so this code can ask
 * it to sign but can never read the private key (the lab proves it by trying). A cloud KMS or a
 * hardware HSM plays the same role in production; the SDK side (signWith) is identical.
 *
 * [ SEQUENCE ]
 * App -> Vault: Generate a non-extractable Ed25519 key
 * App -> Hedera: Create an account controlled by the vault's public key
 * App -> Vault: Sign the transaction body bytes (signWith)
 * App -> Hedera: Submit; the network checks the vault's signature
 * App -> Hedera: Delete the account (also signed by the vault), balance returns to you
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it funds a temporary vault account and gets the balance back).
 * - Cost: <1 ℏ (account creation and network fees; the 0.2 ℏ deposit comes back).
 *
 * [ HOW TO RUN ]
 * node English/M1_Fundamentals_Functional_JS/03_cryptography_kms.js
 * ============================================================================
 */

import { AccountCreateTransaction, AccountDeleteTransaction, Hbar, PublicKey, TransferTransaction, TransactionId } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl } from '../M99_Utilities/index.js'

/**
 * A signing vault backed by WebCrypto. The private key is created non-extractable:
 * this class can ask it to sign, but nothing (not even this code) can export it.
 */
class WebCryptoVault {
  async init () {
    const pair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    this._privateKey = pair.privateKey
    const rawPublic = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey))
    this.publicKey = PublicKey.fromBytesED25519(rawPublic)
    return this
  }

  // Signs the bytes inside the vault and returns only the 64-byte signature.
  async sign (bytes) {
    return new Uint8Array(await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, this._privateKey, bytes))
  }

  // Tries to read the private key out of the vault; WebCrypto refuses.
  async tryExport () {
    try {
      await globalThis.crypto.subtle.exportKey('pkcs8', this._privateKey)
      return 'EXPORTED (the key was extractable!)'
    } catch (error) {
      return `refused (${error.name})`
    }
  }
}

const main = async () => {
  console.log('--- SESSION START: Signature Delegation to a Vault ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. The vault creates its key; we only ever see the public half
    const vault = await new WebCryptoVault().init()
    console.log(`[INFO] Vault key created (Ed25519, non-extractable). Public key: ${vault.publicKey.toStringDer().slice(0, 30)}...`)
    console.log(`[VERIFY] Export of the private key: ${await vault.tryExport()}`)

    // 2. A testnet account whose only key is the vault's key
    console.log('\n[PROCESS] Creating a testnet account controlled by the vault key (0.2 ℏ deposit)...')
    const createRes = await new AccountCreateTransaction()
      .setKeyWithoutAlias(vault.publicKey)
      .setInitialBalance(new Hbar(0.2))
      .execute(client)
    const vaultAccountId = (await createRes.getReceipt(client)).accountId
    console.log(`[SUCCESS] Vault account: ${vaultAccountId}`)

    // 3. The vault account pays and signs its own transfer: only the vault can authorize it
    console.log('\n[PROCESS] Building a transfer paid by the vault account and asking the vault to sign it...')
    const transfer = new TransferTransaction()
      .addHbarTransfer(vaultAccountId, Hbar.fromTinybars(-1_000_000))
      .addHbarTransfer(operatorId, Hbar.fromTinybars(1_000_000))
      .setTransactionId(TransactionId.generate(vaultAccountId))
      .freezeWith(client)
    // signWith hands the vault the exact body bytes the network will check.
    await transfer.signWith(vault.publicKey, (bodyBytes) => vault.sign(bodyBytes))
    const transferRes = await transfer.execute(client)
    const transferReceipt = await transferRes.getReceipt(client)
    console.log(`[SUCCESS] Network accepted the vault's signature: ${transferReceipt.status.toString()}`)
    console.log(`[EXPLORER] ${getHashscanUrl(transferRes)}`)

    // 4. Clean up: delete the account (signed by the vault), its balance returns to you
    console.log('\n[PROCESS] Deleting the vault account; the vault signs again...')
    const del = new AccountDeleteTransaction()
      .setAccountId(vaultAccountId)
      .setTransferAccountId(operatorId)
      .freezeWith(client)
    await del.signWith(vault.publicKey, (bodyBytes) => vault.sign(bodyBytes))
    const delReceipt = await (await del.execute(client)).getReceipt(client)
    console.log(`[SUCCESS] Vault account deleted: ${delReceipt.status.toString()} (remaining balance returned to ${operatorId})`)

    console.log('\n KEY CONCEPT:')
    console.log("The Hedera SDK is \"Signer-Agnostic\". It doesn't care *how* a signature")
    console.log('is generated, as long as it is valid. Here a key that no code could ever')
    console.log('read signed two real transactions; a KMS or HSM plugs into signWith the same way.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Signing Delegation Failed:', error.message)
    process.exitCode = 1
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
