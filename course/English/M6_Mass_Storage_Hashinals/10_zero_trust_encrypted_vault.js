/**
 * ============================================================================
 * Lab 10: Zero-Trust Encrypted Vault (Enterprise Privacy over Public Consensus)
 * [CONCEPT] End-to-End Encrypted Sharding via Gzip, AES-256-GCM, and HCS-1
 * ============================================================================
 * [ KEY CONCEPT ]
 * Public ledgers guarantee fair ordering and immutability, but public
 * payloads are visible to any node runner or mirror node indexer.
 * Enterprise architectures require "Zero-Trust Consensus": sensitive records
 * (medical vaults, financial audit trails) must be cryptographically
 * sealed before reaching Layer 1. By combining:
 * 1. Stream Compression (Gzip) to minimize consensus byte fees.
 * 2. Authenticated Encryption (AES-256-GCM) with 96-bit IV and 128-bit GMAC tags.
 * 3. Envelope Encryption separating the Data Encryption Key (DEK) from Master Keys.
 * 4. HCS-1-style JSON sharding across consensus sequences.
 *
 * The ledger keeps the order and timestamps; confidentiality lasts as long as the keys stay safe.
 * Encrypted data still stays on the ledger forever, so personal data that may need erasing
 * (for example under GDPR) should not go on-chain even encrypted.
 *
 * [ LEARNABLE MOMENT ]
 * Hashinals and HCS are not limited to public jpegs or open JSON. With AES-GCM,
 * the ledger only ever stores ciphertext. Anyone can read the messages from a
 * Mirror Node, but without the key envelope they cannot decrypt them, and any
 * tamper attempt fails the 128-bit Galois Message Authentication Code (GMAC).
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-1/
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 09: HCS-7 Smart Hashinals (EVM State + WASM Dynamic Inscriptions)
 * - Next:     M7 Lab 01: Multi-signature Models and KeyLists
 *
 * [ SIMULATED ]
 * The audit report is made-up sample data (institution, clients, policy names and IDs are fictional), and the master key (KEK) is a non-extractable WebCrypto key for this session instead of a KMS key. The AES-KW key wrapping, AES-256-GCM encryption, HCS messages and tamper check are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M6_Mass_Storage_Hashinals/10_zero_trust_encrypted_vault.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl, getHashscanUrl, sleep } from '../M99_Utilities/index.js'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

/**
 * 1. Envelope Encryption & Sharding Engine (WebCrypto)
 * The DEK encrypts the document (AES-256-GCM); the KEK wraps the DEK (AES-KW, RFC 3394).
 * The KEK is non-extractable: only this session can unwrap the DEK.
 */
const encryptAndShardVaultPayload = async (rawBuffer, kek) => {
  const subtle = globalThis.crypto.subtle
  // A. Compress with Gzip to reduce on-chain message footprint
  const compressed = zlib.gzipSync(rawBuffer)

  // B. Fresh Data Encryption Key (DEK) and 96-bit IV for this document
  const dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const iv = crypto.randomBytes(12)

  // C. Authenticated encryption: WebCrypto appends the 16-byte GCM tag to the ciphertext
  const sealed = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, dek, compressed))
  const encryptedPayload = sealed.subarray(0, sealed.length - 16)
  const authTag = sealed.subarray(sealed.length - 16)

  // D. Envelope encryption: wrap the DEK with the KEK (AES-KW)
  const wrappedDek = Buffer.from(await subtle.wrapKey('raw', dek, kek, { name: 'AES-KW' }))

  // E. SHA-256 fingerprint of the original document
  const documentFingerprint = crypto.createHash('sha256').update(rawBuffer).digest('hex')

  // F. Shard the ciphertext into HCS-1-style chunks (250 base64 chars each)
  const cipherBase64 = encryptedPayload.toString('base64')
  const CHUNK_SIZE = 250
  const rawChunks = []
  for (let i = 0; i < cipherBase64.length; i += CHUNK_SIZE) {
    rawChunks.push(cipherBase64.slice(i, i + CHUNK_SIZE))
  }

  const shards = rawChunks.map((chunk, index) => ({
    h: 'hcs-1-vault',
    v: '1.1.0',
    fid: documentFingerprint,
    env: {
      alg: 'A256KW+A256GCM',
      dek: wrappedDek.toString('base64'),
      iv: iv.toString('base64'),
      tag: authTag.toString('base64')
    },
    i: index,
    t: rawChunks.length,
    d: chunk
  }))

  return {
    documentFingerprint,
    compressedSize: compressed.length,
    encryptedSize: encryptedPayload.length,
    authTag,
    shards
  }
}

/**
 * 2. Trustless Reassembly & Decryption Engine
 */
const reassembleAndDecryptVault = async (shards, kek) => {
  const subtle = globalThis.crypto.subtle
  if (!shards || shards.length === 0) {
    throw new Error('No shards available for reassembly')
  }

  const sorted = [...shards].sort((a, b) => a.i - b.i)
  if (sorted.length !== sorted[0].t) {
    throw new Error(`Incomplete shard set: received ${sorted.length} of ${sorted[0].t}`)
  }

  const header = sorted[0]
  const cipherBuffer = Buffer.from(sorted.map(s => s.d).join(''), 'base64')
  const iv = Buffer.from(header.env.iv, 'base64')
  const authTag = Buffer.from(header.env.tag, 'base64')

  // Unwrap the DEK with the KEK, then decrypt and authenticate (a tampered byte fails here)
  const dek = await subtle.unwrapKey('raw', Buffer.from(header.env.dek, 'base64'), kek, { name: 'AES-KW' }, { name: 'AES-GCM' }, false, ['decrypt'])
  const decompressed = Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, dek, Buffer.concat([cipherBuffer, authTag])))

  const originalBuffer = zlib.gunzipSync(decompressed)
  const verifiedFingerprint = crypto.createHash('sha256').update(originalBuffer).digest('hex')

  if (verifiedFingerprint !== header.fid) {
    throw new Error('Integrity check failed: Reconstructed document hash mismatch')
  }

  return {
    originalBuffer,
    verifiedFingerprint
  }
}

const main = async () => {
  console.log('--- SESSION START: Zero-Trust Enterprise Encrypted Vault (HCS-1 + AES-GCM) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const submitKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Prepare Sensitive Enterprise Document
    const sensitiveAuditReport = {
      vaultId: 'VAULT-CORP-SEC-2026-X9',
      classification: 'RESTRICTED / STRICT CONFIDENTIAL',
      timestamp: new Date().toISOString(),
      institution: 'Demo Custody Co. (fictional)',
      compliance: {
        policy: 'demo-policy-v1',
        auditorId: 'demo-auditor-01'
      },
      sensitiveRecords: [
        { client: 'Acme Global Treasury', vaultBalanceHbar: 15000000, kycTier: 3, riskScore: 0.02 },
        { client: 'Apex Sovereign Reserves', vaultBalanceHbar: 48000000, kycTier: 4, riskScore: 0.001 },
        { client: 'Nexus Settlement Gateway', vaultBalanceHbar: 9200000, kycTier: 3, riskScore: 0.05 }
      ],
      legalHashRoot: crypto.randomBytes(32).toString('hex')
    }

    const rawBuffer = Buffer.from(JSON.stringify(sensitiveAuditReport, null, 2), 'utf-8')
    console.log('[PROCESS] Step 1: Encrypting Enterprise Document using Zero-Trust Architecture...')
    console.log(`[LOG] Raw Document Size: ${rawBuffer.length} bytes`)

    // Master key (KEK): non-extractable AES-KW key held by WebCrypto, never a string in the code
    const kek = await globalThis.crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey'])
    const vault = await encryptAndShardVaultPayload(rawBuffer, kek)

    console.log(`[LOG] Gzip Compressed Size: ${vault.compressedSize} bytes (-${Math.round((1 - (vault.compressedSize / rawBuffer.length)) * 100)}% wire reduction)`)
    console.log(`[LOG] AES-256-GCM Ciphertext Size: ${vault.encryptedSize} bytes`)
    console.log(`[LOG] Document SHA-256 Fingerprint: 0x${vault.documentFingerprint}`)
    console.log(`[LOG] Authenticated GMAC Tag: 0x${vault.authTag.toString('hex')}`)
    console.log(`[LOG] Generated HCS-1 Shards: ${vault.shards.length} shards`)

    // 2. Create Confidential Vault Topic on Hedera
    console.log('\n[PROCESS] Step 2: Provisioning Dedicated HCS Vault Topic on Hedera Consensus Service...')
    const topicCreateTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-1-ENCRYPTED-VAULT:v1.0.0')
      .setSubmitKey(submitKey.publicKey)
      .setAutoRenewAccountId(operatorId)
      .execute(client)

    const topicReceipt = await topicCreateTx.getReceipt(client)
    const vaultTopicId = topicReceipt.topicId.toString()
    console.log(`[SUCCESS] HCS Vault Topic Provisioned: ${vaultTopicId}`)
    console.log(`[LOG] Topic Transaction on HashScan: ${getHashscanUrl(topicCreateTx)}`)

    // 3. Inscribe Shards to Hedera Consensus Layer
    console.log('\n[PROCESS] Step 3: Inscribing Encrypted Shards into Consensus Stream...')
    const sequenceNumbers = []

    for (const shard of vault.shards) {
      const payloadString = JSON.stringify(shard)
      const submitTx = await new TopicMessageSubmitTransaction()
        .setTopicId(vaultTopicId)
        .setMessage(payloadString)
        .freezeWith(client)
        .sign(submitKey)

      const submitRes = await submitTx.execute(client)
      const receipt = await submitRes.getReceipt(client)
      sequenceNumbers.push(receipt.topicSequenceNumber.toNumber())
      console.log(`[SUCCESS] Inscribed Shard [${shard.i + 1}/${shard.t}] at Consensus Sequence #${receipt.topicSequenceNumber}`)
    }

    // 4. Mirror Node Retrieval and Tamper-Proof Zero-Trust Reassembly
    console.log('\n[PROCESS] Step 4: Interrogating Mirror Node for Vault Stream Reassembly...')
    console.log('[INFO] Awaiting Mirror Node ingestion (4 seconds)...')
    await sleep(4000)

    const mirrorUrl = `${getMirrorNodeBaseUrl()}/api/v1/topics/${vaultTopicId}/messages?order=asc`
    const mirrorRes = await fetch(mirrorUrl)
    if (!mirrorRes.ok) {
      throw new Error(`Mirror Node request failed with status: ${mirrorRes.status}`)
    }

    const mirrorData = await mirrorRes.json()
    console.log(`[LOG] Mirror Node returned ${mirrorData.messages.length} messages for topic ${vaultTopicId}`)

    const retrievedShards = mirrorData.messages
      .map(msg => {
        try {
          const decoded = Buffer.from(msg.message, 'base64').toString('utf-8')
          return JSON.parse(decoded)
        } catch {
          return null
        }
      })
      .filter(parsed => parsed && parsed.h === 'hcs-1-vault' && parsed.fid === vault.documentFingerprint)

    console.log(`[SUCCESS] Successfully parsed and validated ${retrievedShards.length} vault shards from consensus records`)

    // 5. Decrypt and Verify Integrity
    console.log('\n[PROCESS] Step 5: Performing Authenticated GMAC Verification & Decryption...')
    const reconstruction = await reassembleAndDecryptVault(retrievedShards, kek)
    const reconstructedDocument = JSON.parse(reconstruction.originalBuffer.toString('utf-8'))

    console.log(`[SUCCESS] Document Integrity Verified! SHA-256 Fingerprint: 0x${reconstruction.verifiedFingerprint}`)
    console.log(`[LOG] Reconstructed Vault ID: "${reconstructedDocument.vaultId}"`)
    console.log(`[LOG] Classification: "${reconstructedDocument.classification}"`)
    console.log(`[LOG] Number of Confidential Audit Records: ${reconstructedDocument.sensitiveRecords.length}`)
    console.log(`[LOG] Total HBAR in Audited Vaults: ${reconstructedDocument.sensitiveRecords.reduce((acc, r) => acc + r.vaultBalanceHbar, 0).toLocaleString()} HBAR`)

    // 6. Demonstrate Zero-Trust Cryptographic Tamper Defense
    console.log('\n[PROCESS] Step 6: Testing Zero-Trust Tamper Detection (Adversarial Simulation)...')
    try {
      const tamperedShards = JSON.parse(JSON.stringify(retrievedShards))
      // Adversary tampers with 1 byte of the ciphertext on an unauthenticated mirror node
      const tamperedBytes = Buffer.from(tamperedShards[0].d, 'base64')
      tamperedBytes[0] = tamperedBytes[0] ^ 0xff // Flip bits
      tamperedShards[0].d = tamperedBytes.toString('base64')

      await reassembleAndDecryptVault(tamperedShards, kek)
      console.error('[FAILED] Security violation: Tampered ciphertext was accepted!')
      process.exitCode = 1
    } catch (tamperErr) {
      console.log(`[SUCCESS] Adversarial tamper detected and blocked by AES-GCM GMAC: ${tamperErr.name}${tamperErr.message ? ` (${tamperErr.message})` : ''} — decryption refused`)
    }

    console.log('\n KEY CONCEPT:')
    console.log('Zero-Trust Vaults combine Hedera L1 fair ordering and consensus timestamps with')
    console.log('envelope AES-256-GCM encryption. The network secures the proof and order, while')
    console.log('confidentiality and cryptographic access remain strictly off-chain with the key holders.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Never store unencrypted enterprise data on a public ledger. By applying Gzip')
    console.log('before AES-GCM sharding, you minimize HCS consensus fees while ensuring that all')
    console.log('on-chain shards appear as uniform pseudorandom entropy to external observers.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Zero-Trust Vault Failure:', error.message)
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
