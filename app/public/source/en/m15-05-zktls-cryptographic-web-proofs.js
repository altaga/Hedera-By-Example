/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: zk-TLS & Cryptographic Web Proofs (TLSNotary / Reclaim Model)
 * [ CONCEPT ] Zero-Knowledge Web2 Attestation Anchored to Hedera Consensus
 * ============================================================================
 * [ KEY CONCEPT ]
 * Modern RWA tokenization and institutional DeFi require off-chain Web2 data verification
 * (e.g. proving accredited investor net worth > $1M, medical board credentials, or credit ratings)
 * without leaking passwords, session tokens, or private PII on-chain.
 * The zk-TLS / TLSNotary architecture splits a TLS 1.3 session between client and notary.
 * The user selectively discloses only the certified claim while blinding sensitive fields
 * using cryptographic commitments (SHA-256 blinding). The notarized proof is anchored
 * directly to Hedera Consensus Service (HCS), providing immutable proof of verification.
 *
 * [ LEARNABLE MOMENT ]
 * Do not put personally identifiable information (PII) or confidential banking statements
 * on public ledgers. Instead, store only the zero-knowledge commitment hash and notary
 * cryptographic signature on HCS. Any smart contract or verifier can validate that the
 * proof was notarized by a trusted enclave while preserving 100% user privacy.
 *
 * [ LEARNING PATH ]
 * - Previous: M15 Lab 04: Passkeys & WebAuthn P-256 Biometric Authenticator
 * - Module Finish: Complete Frontier Architecture Suite
 *
 * [ OFFICIAL REFERENCES ]
 * - TLSNotary Protocol Specifications: https://tlsnotary.org/
 * - Reclaim Protocol Whitepaper: https://docs.reclaimprotocol.org/
 * - Hedera Consensus Service: https://docs.hedera.com/hedera/services/consensus-service
 *
 * [ SEQUENCE ]
 * Prover -> Bank: TLS 1.3 session (simulated)
 * Notary -> Prover: Signs a commitment to the response (Ed25519)
 * Note Prover: Reveals only the claim, not the private data
 * Prover -> Hedera: Proof on HCS
 * Verifier -> Hedera: Check the notary signature and commitment
 *
 * [ SIMULATED ]
 * The TLS session with the bank and the notary are emulated. The signatures and the HCS proof are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M15_DePIN_and_Future_Crypto/05_zktls_cryptographic_web_proofs.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import crypto from 'node:crypto'
import { getClient, updateState, getHashscanUrl } from '../M99_Utilities/index.js'

/**
 * Emulated zk-TLS MPC Notary Node
 * Holds an authoritative Ed25519 notary keypair to attest to TLS session authenticity.
 */
class ZkNotaryNode {
  constructor (notaryId = 'URN:NOTARY:MPC:ORACLE-NODE-01') {
    this.notaryId = notaryId
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    this.privateKey = privateKey
    this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
  }

  /**
   * Generates a signed web proof attestation from a verifiable TLS session transcript.
   */
  notarizeClaim (serverDomain, publicClaim, blindedCommitmentHash) {
    const attestationManifest = {
      standard: 'zkTLS-WebProof-v1',
      notaryId: this.notaryId,
      serverDomain,
      publicClaim,
      blindedCommitmentHash,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 86400000 // 24-hour validity
    }

    const manifestBuf = Buffer.from(JSON.stringify(attestationManifest))
    const notarySignature = crypto.sign(null, manifestBuf, this.privateKey)

    return {
      manifest: attestationManifest,
      notarySignatureHex: notarySignature.toString('hex'),
      notaryPublicKeyPem: this.publicKeyPem
    }
  }
}

/**
 * Client-Side Prover that blinds private fields
 */
class ZkWebProver {
  constructor (userAccountId) {
    this.userAccountId = userAccountId
  }

  /**
   * Blinds private banking data (e.g. account numbers, tax ID) while generating a public claim.
   */
  preparePrivateProof (rawBankResponse) {
    // Generate cryptographic blinding secret salt
    const blindingSecretSalt = crypto.randomBytes(32).toString('hex')

    // Commit to the private data without revealing it: SHA-256(salt || rawPrivateData)
    const blindedCommitmentHash = crypto
      .createHash('sha256')
      .update(blindingSecretSalt + JSON.stringify(rawBankResponse.privatePii))
      .digest('hex')

    const publicClaim = {
      userAccountId: this.userAccountId,
      claimType: 'ACCREDITED_INVESTOR_STATUS',
      isAccredited: rawBankResponse.certifiedMetrics.netWorthUsd >= 1000000,
      verificationThreshold: '$1,000,000+ USD',
      jurisdiction: rawBankResponse.certifiedMetrics.jurisdiction
    }

    return {
      publicClaim,
      blindedCommitmentHash,
      blindingSecretSalt
    }
  }
}

async function main () {
  console.log('====================================================================')
  console.log('🛡️ ZK-TLS LAB 05: CRYPTOGRAPHIC WEB PROOFS & SELECTIVE DISCLOSURE')
  console.log('====================================================================\n')

  const { client, operatorId, network } = getClient()

  try {
    console.log(`[📡 OPERATOR] Authenticated as ${operatorId} on Hedera ${network.toUpperCase()}`)

    // 1. Provision HCS Topic for zk-TLS Compliance Attestation Stream
    console.log('\n[1/5] Creating Dedicated zk-TLS Compliance HCS Topic...')
    const topicCreateTx = await new TopicCreateTransaction()
      .setTopicMemo('Hedera zk-TLS Web Proofs & Accredited Investor Attestation Log')
      .execute(client)

    const topicReceipt = await topicCreateTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[✅ TOPIC CREATED] ID: ${topicId}`)
    console.log(`[🔗 EXPLORER] https://hashscan.io/${network}/topic/${topicId}`)

    // 2. Initialize MPC Notary Node and Client Prover
    console.log('\n[2/5] Initializing Decentralized Notary & Client Prover...')
    const notary = new ZkNotaryNode()
    const prover = new ZkWebProver(operatorId.toString())

    console.log(`[🏛️ NOTARY NODE] ${notary.notaryId}`)
    console.log('[🔑 NOTARY KEY] Ed25519 Attestation Key initialized.')

    // 3. Emulate HTTPS TLS 1.3 Session with Institutional Financial Endpoint
    console.log('\n[3/5] Emulating Verifiable TLS 1.3 Session with Bank Endpoint...')
    const serverDomain = 'api.custody.institutional-bank.com'
    const rawBankTlsResponse = {
      privatePii: {
        legalName: 'Alice Vance',
        ssnTaxId: '***-**-8891',
        checkingAccountNumber: '4920-8819-2049-1120',
        exactBalanceTinybars: '4,520,000,000'
      },
      certifiedMetrics: {
        netWorthUsd: 2500000,
        jurisdiction: 'US'
      }
    }

    console.log(`[🔒 TLS 1.3 SESSION] Connected to: https://${serverDomain}/v1/accredited-status`)
    console.log('   • Confidential PII: Account Number, SSN, Legal Name (REDACTED & BLINDED)')
    console.log('   • Certified Metric: Net Worth = $2,500,000 USD (Meets $1M+ Accredited Threshold)')

    // 4. Client Generates Zero-Knowledge Blinding Commitment
    console.log('\n[4/5] Client Generating Zero-Knowledge Commitment & Notary Attestation...')
    const { publicClaim, blindedCommitmentHash } = prover.preparePrivateProof(rawBankTlsResponse)

    console.log(`[👁️ PUBLIC CLAIM] Type: ${publicClaim.claimType} | Accredited: ${publicClaim.isAccredited}`)
    console.log(`[🔒 BLINDED HASH] SHA-256 Commitment: ${blindedCommitmentHash}`)

    // Notary validates TLS session transcript and issues cryptographic attestation
    const webProof = notary.notarizeClaim(serverDomain, publicClaim, blindedCommitmentHash)

    // Verify Notary Signature
    const manifestBuf = Buffer.from(JSON.stringify(webProof.manifest))
    const isNotarySigValid = crypto.verify(
      null,
      manifestBuf,
      webProof.notaryPublicKeyPem,
      Buffer.from(webProof.notarySignatureHex, 'hex')
    )

    if (!isNotarySigValid) {
      throw new Error('Notary attestation cryptographic signature validation failed')
    }
    console.log(`[✅ NOTARY ATTESTATION] Signature verified: ${webProof.notarySignatureHex.substring(0, 32)}...`)

    // 5. Anchor zk-TLS Web Proof Attestation to Hedera Consensus
    console.log('\n[5/5] Anchoring zk-TLS Web Proof Attestation to Hedera Consensus...')
    const onChainAttestationMessage = {
      p: 'zktls-webproof-v1',
      op: 'anchor_attestation',
      manifest: webProof.manifest,
      notarySignature: webProof.notarySignatureHex,
      timestamp: Date.now()
    }

    const attestationSubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(onChainAttestationMessage))
      .execute(client)

    const attestationReceipt = await attestationSubmitTx.getReceipt(client)
    console.log(`[✅ PROOF ANCHORED] Sequence #${attestationReceipt.topicSequenceNumber} on HCS`)
    console.log(`[🔗 EXPLORER] ${getHashscanUrl(attestationSubmitTx.transactionId.toString())}`)

    // Persist State
    updateState('ZKTLS_TOPIC_ID', topicId)
    updateState('ZKTLS_BLINDED_COMMITMENT', blindedCommitmentHash)
    updateState('ZKTLS_NOTARY_ID', notary.notaryId)

    console.log('\n💡 KEY CONCEPT:')
    console.log('zk-TLS proves off-chain Web2 data without exposing credentials or confidential PII.')
    console.log('Users selective disclose claims, blind private fields via cryptographic commitments,')
    console.log('and anchor the notary attestation to Hedera Consensus Service for verifiable compliance.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Never post confidential banking statements or personal identity data directly on-chain.')
    console.log('Zero-knowledge commitments allow instant mathematical verification while preserving 100% privacy.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] zk-TLS Web Proof Execution Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
