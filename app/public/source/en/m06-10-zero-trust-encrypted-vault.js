/**
 * ============================================================================
 * Lab 10: Zero-Trust Encrypted Vault (Enterprise Privacy over Public Consensus)
 * [CONCEPT] End-to-End Encryption via Gzip, AES-KW + AES-256-GCM, stored as an HCS-1 file
 * ============================================================================
 * [ KEY CONCEPT ]
 * Public ledgers guarantee fair ordering and immutability, but public
 * payloads are visible to any node runner or mirror node indexer.
 * Enterprise architectures require "Zero-Trust Consensus": sensitive records
 * (medical vaults, financial audit trails) must be cryptographically
 * sealed before reaching Layer 1. By combining:
 * 1. Stream Compression (Gzip) to minimize consensus byte fees.
 * 2. Authenticated Encryption (AES-256-GCM) with 96-bit IV and 128-bit GMAC tags.
 * 3. Envelope Encryption: the Data Encryption Key (DEK) is wrapped with AES-KW (RFC 3394).
 * 4. The sealed envelope is inscribed as a standard HCS-1 file (zstd, {o, c} chunks).
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
 * The audit report is made-up sample data (institution, clients, policy names and IDs are fictional), and the master key (KEK) is a non-extractable WebCrypto key for this session instead of a KMS key. The AES-KW key wrapping, AES-256-GCM encryption, the HCS-1 inscription and the tamper check are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M6_Mass_Storage_Hashinals/10_zero_trust_encrypted_vault.js
 * ============================================================================
 */

import { getClient, inscribeHcs1, readHcs1 } from '../M99_Utilities/index.js'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

/**
 * 1. Envelope Encryption (WebCrypto)
 * The DEK encrypts the document (AES-256-GCM); the KEK wraps the DEK (AES-KW, RFC 3394).
 * The KEK is non-extractable: only this session can unwrap the DEK.
 */
const sealDocument = async (rawBuffer, kek) => {
  const subtle = globalThis.crypto.subtle
  // A. Compress with Gzip before encrypting (ciphertext does not compress)
  const compressed = zlib.gzipSync(rawBuffer)
  // B. Fresh Data Encryption Key (DEK) and 96-bit IV for this document
  const dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const iv = crypto.randomBytes(12)
  // C. Authenticated encryption: WebCrypto appends the 16-byte GCM tag to the ciphertext
  const sealed = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, dek, compressed))
  // D. Envelope encryption: wrap the DEK with the KEK (AES-KW)
  const wrappedDek = Buffer.from(await subtle.wrapKey('raw', dek, kek, { name: 'AES-KW' }))
  return {
    compressedSize: compressed.length,
    authTag: sealed.subarray(sealed.length - 16),
    envelope: {
      v: 'hbe-vault/1',
      alg: 'A256KW+A256GCM',
      fid: crypto.createHash('sha256').update(rawBuffer).digest('hex'), // SHA-256 of the plaintext
      dek: wrappedDek.toString('base64'),
      iv: iv.toString('base64'),
      ct: sealed.toString('base64') // ciphertext + GCM tag
    }
  }
}

/**
 * 2. Decryption: unwrap the DEK, decrypt and authenticate (one changed byte fails here),
 * then check the plaintext SHA-256.
 */
const openDocument = async (envelope, kek) => {
  const subtle = globalThis.crypto.subtle
  const dek = await subtle.unwrapKey('raw', Buffer.from(envelope.dek, 'base64'), kek, { name: 'AES-KW' }, { name: 'AES-GCM' }, false, ['decrypt'])
  const compressed = Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64'), tagLength: 128 }, dek, Buffer.from(envelope.ct, 'base64')))
  const originalBuffer = zlib.gunzipSync(compressed)
  const verifiedFingerprint = crypto.createHash('sha256').update(originalBuffer).digest('hex')
  if (verifiedFingerprint !== envelope.fid) throw new Error('Integrity check failed: Reconstructed document hash mismatch')
  return { originalBuffer, verifiedFingerprint }
}

const main = async () => {
  console.log('--- SESSION START: Zero-Trust Enterprise Encrypted Vault (HCS-1 + AES-GCM) ---\n')
  const { client } = getClient()

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
    const vault = await sealDocument(rawBuffer, kek)
    console.log(`[LOG] Gzip Compressed Size: ${vault.compressedSize} bytes (-${Math.round((1 - (vault.compressedSize / rawBuffer.length)) * 100)}% before encryption)`)
    console.log(`[LOG] Document SHA-256 Fingerprint: 0x${vault.envelope.fid}`)
    console.log(`[LOG] Authenticated GMAC Tag: 0x${vault.authTag.toString('hex')}`)
    console.log(`[LOG] Wrapped DEK (AES-KW): ${vault.envelope.dek}`)

    // 2. Inscribe the sealed envelope as an HCS-1 file
    console.log('\n[PROCESS] Step 2: Inscribing the sealed envelope as an HCS-1 file...')
    const vaultTopicId = await inscribeHcs1(client, Buffer.from(JSON.stringify(vault.envelope)), 'application/json', {
      onChunk: (done, total) => console.log(`[SUCCESS] Inscribed chunk ${done}/${total}`)
    })
    console.log(`[SUCCESS] Vault file: hcs://1/${vaultTopicId}`)

    // 3. Read it back from the Mirror Node (readHcs1 checks the memo SHA-256)
    console.log('\n[PROCESS] Step 3: Rebuilding the HCS-1 file from the Mirror Node...')
    const file = await readHcs1(vaultTopicId)
    const retrieved = JSON.parse(file.bytes.toString('utf-8'))
    console.log(`[VERIFY] HCS-1 file SHA-256 matches the topic memo (${file.chunks} chunks)`)
    console.log(`[VERIFY] Plaintext never reached the ledger: "${sensitiveAuditReport.sensitiveRecords[0].client}" ${file.bytes.toString('utf-8').includes(sensitiveAuditReport.sensitiveRecords[0].client) ? 'FOUND' : 'not found'} in the on-chain file`)

    // 4. Decrypt and Verify Integrity
    console.log('\n[PROCESS] Step 4: Performing Authenticated GMAC Verification & Decryption...')
    const reconstruction = await openDocument(retrieved, kek)
    const reconstructedDocument = JSON.parse(reconstruction.originalBuffer.toString('utf-8'))
    console.log(`[SUCCESS] Document Integrity Verified! SHA-256 Fingerprint: 0x${reconstruction.verifiedFingerprint}`)
    console.log(`[LOG] Reconstructed Vault ID: "${reconstructedDocument.vaultId}"`)
    console.log(`[LOG] Classification: "${reconstructedDocument.classification}"`)
    console.log(`[LOG] Number of Confidential Audit Records: ${reconstructedDocument.sensitiveRecords.length}`)

    // 5. Tamper test: flip one ciphertext byte of the retrieved copy and try to open it
    console.log('\n[PROCESS] Step 5: Tamper test (flip one byte of the retrieved ciphertext)...')
    try {
      const tampered = { ...retrieved }
      const bytes = Buffer.from(tampered.ct, 'base64')
      bytes[0] = bytes[0] ^ 0xff
      tampered.ct = bytes.toString('base64')
      await openDocument(tampered, kek)
      console.error('[FAILED] Security violation: Tampered ciphertext was accepted!')
      process.exitCode = 1
    } catch (tamperErr) {
      console.log(`[SUCCESS] Adversarial tamper detected and blocked by AES-GCM GMAC: ${tamperErr.name}${tamperErr.message ? ` (${tamperErr.message})` : ''} — decryption refused`)
    }

    console.log('\n KEY CONCEPT:')
    console.log('Zero-Trust Vaults combine Hedera fair ordering and consensus timestamps with')
    console.log('envelope encryption. The ledger stores only ciphertext in a standard HCS-1 file;')
    console.log('confidentiality and access stay off-chain with whoever holds the master key.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Never store unencrypted enterprise data on a public ledger. Compress before you')
    console.log('encrypt (ciphertext does not compress), and keep the master key in a store that')
    console.log('cannot export it.')

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
