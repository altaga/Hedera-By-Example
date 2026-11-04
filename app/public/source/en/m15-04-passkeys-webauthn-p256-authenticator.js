/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Passkeys & WebAuthn P-256 Biometric Authenticator
 * [CONCEPT] Seedless Hardware Cryptography (NIST P-256 / secp256r1) over Hedera
 * ============================================================================
 * [ KEY CONCEPT ]
 * Seed phrases and plaintext private keys are the largest attack vectors in Web3.
 * The W3C WebAuthn / FIDO2 standard enables users to authenticate directly with
 * native hardware biometrics (Apple FaceID/TouchID, Android Fingerprint, Windows Hello,
 * YubiKey) using the NIST P-256 (`secp256r1`) elliptic curve. An emulated authenticator
 * signs challenges inside a secure enclave, producing `authenticatorData` and
 * `clientDataJSON`. A Hedera Gateway verifies this biometric assertion to authorize
 * transactions without the user ever managing or exposing private keys.
 *
 * [ LEARNABLE MOMENT ]
 * WebAuthn authenticators do not sign raw messages directly. They enforce strict
 * phishing resistance by binding signatures to an explicit Origin and RP ID (Relying Party ID),
 * hashing `authenticatorData` flags (User Present `UP=1`, User Verified `UV=1`) and
 * `clientDataJSON`. Verifying these cryptographic assertions eliminates 100% of remote
 * phishing and credential theft.
 *
 * [ LEARNING PATH ]
 * - Previous: M15 Lab 03: Intent-Based DeFi Settlement Solver (ERC-7683)
 * - Next:     M15 Lab 05: zk-TLS & Cryptographic Web Proofs (TLSNotary Model)
 *
 * [ OFFICIAL REFERENCES ]
 * - W3C Web Authentication (WebAuthn) Level 3: https://www.w3.org/TR/webauthn-3/
 * - FIDO Alliance Specifications: https://fidoalliance.org/specs/
 * - EIP-7212: Precompiled Contract for secp256r1 Curve Support: https://eips.ethereum.org/EIPS/eip-7212
 *
 * [SIMULATED]
 * The biometric authenticator is emulated in software (the website lets you try a real passkey). The P-256 signatures and the HCS audit are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M15_DePIN_and_Future_Crypto/04_passkeys_webauthn_p256_authenticator.js
 * ============================================================================
 */

import {
  TransferTransaction,
  Hbar,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  AccountId
} from '@hiero-ledger/sdk'
import crypto from 'node:crypto'
import { getClient, updateState, getHashscanUrl } from '../M99_Utilities/index.js'

/**
 * Emulates a Hardware Biometric Authenticator (Apple Secure Enclave / TouchID / FaceID)
 * Operating over the NIST P-256 (secp256r1 / prime256v1) elliptic curve.
 */
class WebAuthnBiometricAuthenticator {
  constructor (userName = 'alice.biometrics@enterprise.vault') {
    this.userName = userName
    // Generates simulated hardware P-256 (prime256v1) keypair
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1'
    })
    this.privateKey = privateKey
    this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
    this.credentialId = crypto.randomBytes(32).toString('hex')
    this.signCount = 0
  }

  /**
   * Simulates `navigator.credentials.get({ publicKey: ... })` following W3C WebAuthn spec.
   */
  generateAssertion (challengeHex, rpId = 'vault.hedera.network', origin = 'https://vault.hedera.network') {
    this.signCount += 1

    // 1. Construct clientDataJSON
    const clientDataObj = {
      type: 'webauthn.get',
      challenge: challengeHex,
      origin,
      crossOrigin: false
    }
    const clientDataJSON = Buffer.from(JSON.stringify(clientDataObj))
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest()

    // 2. Construct authenticatorData: rpIdHash (32) + flags (1) + signCount (4)
    const rpIdHash = crypto.createHash('sha256').update(rpId).digest()
    const flags = Buffer.from([0x05]) // Bit 0 (User Present = 1), Bit 2 (User Verified = 1)
    const counterBuf = Buffer.alloc(4)
    counterBuf.writeUInt32BE(this.signCount, 0)

    const authenticatorData = Buffer.concat([rpIdHash, flags, counterBuf])

    // 3. Signature over authenticatorData || sha256(clientDataJSON)
    const signedData = Buffer.concat([authenticatorData, clientDataHash])
    const signatureDer = crypto.sign('SHA256', signedData, this.privateKey)

    return {
      credentialId: this.credentialId,
      authenticatorDataHex: authenticatorData.toString('hex'),
      clientDataJSONBase64: clientDataJSON.toString('base64'),
      signatureHex: signatureDer.toString('hex'),
      publicKeyPem: this.publicKeyPem,
      signCount: this.signCount
    }
  }
}

/**
 * Enterprise Relying Party (RP) / Hedera WebAuthn Verification Gateway
 */
class HederaWebAuthnGateway {
  constructor (rpId = 'vault.hedera.network', origin = 'https://vault.hedera.network') {
    this.rpId = rpId
    this.origin = origin
    this.registeredPasskeys = {} // credentialId -> publicKeyPem
    this.activeChallenges = new Map()
  }

  registerPasskey (credentialId, publicKeyPem) {
    this.registeredPasskeys[credentialId] = publicKeyPem
  }

  generateChallenge () {
    const challengeHex = crypto.randomBytes(32).toString('hex')
    this.activeChallenges.set(challengeHex, Date.now() + 60000)
    return challengeHex
  }

  verifyAssertion (assertion) {
    const { credentialId, authenticatorDataHex, clientDataJSONBase64, signatureHex } = assertion
    const publicKeyPem = this.registeredPasskeys[credentialId]

    if (!publicKeyPem) {
      return { verified: false, error: 'Unregistered passkey credential ID' }
    }

    // Decode clientDataJSON
    const clientDataBuffer = Buffer.from(clientDataJSONBase64, 'base64')
    const clientData = JSON.parse(clientDataBuffer.toString('utf8'))

    // Verify challenge
    if (!this.activeChallenges.has(clientData.challenge)) {
      return { verified: false, error: 'Challenge expired or invalid' }
    }
    this.activeChallenges.delete(clientData.challenge)

    // Verify origin
    if (clientData.origin !== this.origin) {
      return { verified: false, error: `Origin mismatch: expected ${this.origin}, received ${clientData.origin}` }
    }

    // Verify authenticatorData flags (User Present & User Verified)
    const authDataBuf = Buffer.from(authenticatorDataHex, 'hex')
    const flagsByte = authDataBuf[32]
    const userPresent = (flagsByte & 0x01) !== 0
    const userVerified = (flagsByte & 0x04) !== 0

    if (!userPresent || !userVerified) {
      return { verified: false, error: 'Biometric user verification flag not set' }
    }

    // Verify cryptographic ECDSA signature over SHA-256
    const clientDataHash = crypto.createHash('sha256').update(clientDataBuffer).digest()
    const signedData = Buffer.concat([authDataBuf, clientDataHash])

    const isCryptoValid = crypto.verify(
      'SHA256',
      signedData,
      publicKeyPem,
      Buffer.from(signatureHex, 'hex')
    )

    if (!isCryptoValid) {
      return { verified: false, error: 'Cryptographic P-256 signature mismatch' }
    }

    return {
      verified: true,
      credentialId,
      signCount: authDataBuf.readUInt32BE(33),
      userPresent,
      userVerified
    }
  }
}

async function main () {
  console.log('====================================================================')
  console.log('PASSEKEYS LAB 04: WEBAUTHN P-256 BIOMETRIC AUTHENTICATOR')
  console.log('====================================================================\n')

  const { client, operatorId, network } = getClient()

  try {
    console.log(`[OPERATOR] Authenticated as ${operatorId} on Hedera ${network.toUpperCase()}`)

    // 1. Provision HCS Topic for WebAuthn Biometric Audit Stream
    console.log('\n[1/5] Creating Dedicated WebAuthn Audit HCS Topic...')
    const topicCreateTx = await new TopicCreateTransaction()
      .setTopicMemo('Hedera WebAuthn P-256 Biometric Authentication Log')
      .execute(client)

    const topicReceipt = await topicCreateTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[ TOPIC CREATED] ID: ${topicId}`)
    console.log(`[EXPLORER] https://hashscan.io/${network}/topic/${topicId}`)

    // 2. Initialize Hardware Biometric Authenticator & Gateway
    console.log('\n[2/5] Initializing Hardware Secure Enclave & Gateway...')
    const authenticator = new WebAuthnBiometricAuthenticator('alice.biometrics@enterprise.vault')
    const gateway = new HederaWebAuthnGateway()

    // Register Passkey
    gateway.registerPasskey(authenticator.credentialId, authenticator.publicKeyPem)
    console.log(`[ PASSKEY REGISTERED] Credential ID: ${authenticator.credentialId}`)
    console.log('[ PUBLIC KEY] NIST P-256 (secp256r1) SPKI Key registered.')

    // 3. Issue Challenge and Simulate Hardware Biometric Authentication (FaceID / TouchID)
    console.log('\n[3/5] Requesting Biometric Assertion (Simulating Apple FaceID / TouchID)...')
    const challengeHex = gateway.generateChallenge()
    console.log(`[ GATEWAY CHALLENGE] ${challengeHex}`)

    console.log('[ TOUCH SENSOR] User presents biometric scan: Verified (User Present=1, User Verified=1)')
    const assertion = authenticator.generateAssertion(challengeHex)
    console.log(`[ ASSERTION DER] Signature: ${assertion.signatureHex.substring(0, 32)}... (Valid P-256 DER)`)

    // 4. Gateway Cryptographic Verification
    console.log('\n[4/5] Gateway Verifying WebAuthn Biometric Assertion...')
    const result = gateway.verifyAssertion(assertion)

    if (!result.verified) {
      throw new Error(`WebAuthn verification rejected: ${result.error}`)
    }

    console.log('[ WEBAUTHN VERIFIED] Biometric hardware proof confirmed authentic!')
    console.log(`• User Present (UP):  ${result.userPresent}`)
    console.log(`• User Verified (UV): ${result.userVerified}`)
    console.log(`• Hardware SignCount: ${result.signCount}`)

    // 5. Execute Authorized Hedera Transaction upon Biometric Verification
    console.log('\n[5/5] Executing Biometrically Authorized Hedera Transfer...')
    const authorizedTransferTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-0.01))
      .addHbarTransfer(AccountId.fromString(process.env.ACCOUNT_1_ID || '0.0.11226623'), new Hbar(0.01))
      .setTransactionMemo('Biometrically Authorized via Passkey P-256')
      .execute(client)

    const transferReceipt = await authorizedTransferTx.getReceipt(client)
    console.log(`[ TRANSACTION EXECUTED] Status: ${transferReceipt.status.toString()}`)
    console.log(`[EXPLORER] ${getHashscanUrl(authorizedTransferTx.transactionId.toString())}`)

    // Anchor Biometric Proof to HCS
    const auditRecord = {
      p: 'webauthn-p256-hedera',
      op: 'biometric_assertion_verified',
      credentialId: authenticator.credentialId,
      signCount: result.signCount,
      flags: { userPresent: result.userPresent, userVerified: result.userVerified },
      txId: authorizedTransferTx.transactionId.toString(),
      timestamp: Date.now()
    }

    const auditSubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(auditRecord))
      .execute(client)

    const auditReceipt = await auditSubmitTx.getReceipt(client)
    console.log(`[ BIOMETRIC AUDIT LOGGED] HCS Sequence #${auditReceipt.topicSequenceNumber}`)

    // Persist State
    updateState('WEBAUTHN_TOPIC_ID', topicId)
    updateState('WEBAUTHN_CREDENTIAL_ID', authenticator.credentialId)

    console.log('\n KEY CONCEPT:')
    console.log('Passkeys replace vulnerable mnemonic seed phrases with device-bound hardware biometrics.')
    console.log('The NIST P-256 standard (secp256r1) ensures that private keys never leave the Secure Enclave,')
    console.log('while Hedera verifies assertions or anchors compliance proofs on HCS.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('WebAuthn protects against phishing by binding the signature to the domain (Origin) and RP ID.')
    console.log('An attacker on a phishing clone cannot replay assertions to the genuine Hedera Gateway.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Passkeys WebAuthn Execution Failure:', error.message)
    process.exit(1)
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
