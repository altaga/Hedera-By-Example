/**
 * ============================================================================
 * Lab 05: AWS KMS Enterprise Signer
 * [CONCEPT] Cloud Hardware Security Modules (HSM) & Air-Gapped Custody
 * ============================================================================
 * [ KEY CONCEPT ]
 * In enterprise banking, exchanges, and institutional custody (Fireblocks,
 * Anchorage, Copper), raw private keys NEVER reside in application memory
 * or plaintext environment files (.env). Instead, asymmetric keys
 * (ECC_SECG_P256K1, the curve of Hedera ECDSA accounts) are generated inside FIPS 140-2 Level 3
 * certified hardware (AWS KMS / Cloud HSM).
 *
 * The transaction payload is constructed client-side, hashed, and dispatched
 * via AWS KMS `SignCommand`. The resulting ASN.1 DER signature is decoded into
 * canonical 64-byte (r || s) format and attached to the Hedera transaction.
 * *
 * [ LEARNABLE MOMENT ]
 * Institutional custody keeps private keys off disk and out of application memory: with a cloud HSM/KMS the bytes are signed inside the module and the key never leaves it. The signWith callback is the seam that lets a Hedera transaction be signed that way.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.aws.amazon.com/kms/latest/developerguide/overview.html
 *
 * [ LEARNING PATH ]
 * - Previous: M0 Lab 04: Native Account Creation
 * - Next:     M0 Lab 06: OpenTelemetry Consensus Telemetry
 *
 * [ SIMULATED ]
 * The AWS KMS enclave is simulated in memory unless AWS credentials and AWS_KMS_KEY_ARN are set. The transaction it signs is real. In simulated mode the key IS in memory (it is your operator key). For live mode the KMS key must be the key of the paying account.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M0_Setup_and_Test/05_aws_kms_enterprise_signer.js
 * ============================================================================
 */

import { TransferTransaction, Hbar, PrivateKey } from '@hiero-ledger/sdk'
import { ethers } from 'ethers'
import { getClient, getHashscanUrl } from '../M99_Utilities/index.js'

/**
 * Enterprise DER to Canonical 64-byte (r || s) Converter.
 * AWS KMS returns ASN.1 DER encoded signatures for ECDSA_SHA_256.
 * Hedera consensus nodes require a raw 64-byte concatenated (r || s) buffer
 * with low-s normalization (BIP-62).
 *
 * @param {Uint8Array} derBytes - The DER encoded signature from AWS KMS
 * @returns {Buffer} 64-byte canonical signature buffer
 */
const unpackDerToRaw = (derBytes) => {
  let offset = 0
  if (derBytes[offset++] !== 0x30) throw new Error('Invalid ASN.1 DER: Expected SEQUENCE (0x30)')

  const len = derBytes[offset++]
  if (len & 0x80) offset += (len & 0x7f) // multi-byte length

  // Unpack R
  if (derBytes[offset++] !== 0x02) throw new Error('Invalid ASN.1 DER: Expected INTEGER (0x02) for R')
  const rLen = derBytes[offset++]
  let r = derBytes.subarray(offset, offset + rLen)
  offset += rLen

  // Unpack S
  if (derBytes[offset++] !== 0x02) throw new Error('Invalid ASN.1 DER: Expected INTEGER (0x02) for S')
  const sLen = derBytes[offset++]
  let s = derBytes.subarray(offset, offset + sLen)

  // Strip leading zero padding if 33 bytes
  if (r.length === 33 && r[0] === 0x00) r = r.subarray(1)
  if (s.length === 33 && s[0] === 0x00) s = s.subarray(1)

  // Pad to exact 32 bytes
  const rPadded = Buffer.alloc(32)
  Buffer.from(r).copy(rPadded, 32 - r.length)

  const sPadded = Buffer.alloc(32)
  Buffer.from(s).copy(sPadded, 32 - s.length)

  // Low-S Normalization for secp256k1 (BIP-62)
  const secp256k1N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141')
  const halfN = secp256k1N / 2n
  let sBig = BigInt('0x' + sPadded.toString('hex'))
  if (sBig > halfN) {
    sBig = secp256k1N - sBig
    const sNormalized = Buffer.from(sBig.toString(16).padStart(64, '0'), 'hex')
    return Buffer.concat([rPadded, sNormalized])
  }

  return Buffer.concat([rPadded, sPadded])
}

/**
 * AWS KMS Client Interface & Hardware Enclave Simulator.
 * Uses the same input and output shape as the AWS SDK v3 `@aws-sdk/client-kms` SignCommand.
 * Hedera ECDSA signs keccak-256(body bytes), so the lab sends that 32-byte digest with
 * MessageType 'DIGEST' (with 'RAW', KMS would hash with SHA-256 and the network would reject it).
 */
class EnterpriseKmsAdapter {
  constructor (config = {}) {
    this.region = config.region || process.env.AWS_REGION || 'us-east-1'
    // Simulated mode: a placeholder ARN in AWS's format (no such key exists).
    this.keyArn = config.keyArn || process.env.AWS_KMS_KEY_ARN || 'arn:aws:kms:us-east-1:000000000000:key/00000000-0000-0000-0000-000000000000'
    this.isLiveAws = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_KMS_KEY_ARN)
    this._isolatedKey = config.isolatedKey
  }

  /**
   * Executes SignCommand matching AWS SDK v3 specifications.
   *
   * @param {Object} commandInput - AWS KMS SignCommandInput
   * @returns {Promise<Object>} AWS KMS SignCommandOutput
   */
  async sign (commandInput) {
    const { KeyId, Message, MessageType, SigningAlgorithm } = commandInput

    if (this.isLiveAws) {
      console.log(`[ AWS KMS LIVE] Dispatching SignCommand to AWS KMS HSM (${this.region})...`)
      const { KMSClient, SignCommand } = await import('@aws-sdk/client-kms')
      const kms = new KMSClient({ region: this.region })
      const res = await kms.send(new SignCommand(commandInput))
      return {
        Signature: res.Signature,
        SigningAlgorithm: res.SigningAlgorithm,
        KeyId: res.KeyId
      }
    }

    // Simulated enclave: what KMS does for MessageType DIGEST + ECDSA_SHA_256 on an
    // ECC_SECG_P256K1 key: sign the 32-byte digest as given, return a DER-encoded signature.
    console.log(`[ ENCLAVE HSM] Simulating AWS KMS Hardware Enclave for Key: ${KeyId.substring(0, 36)}...`)
    console.log(`[LOG] Algorithm: ${SigningAlgorithm} | MessageType: ${MessageType} | Payload: ${Message.length} bytes`)
    if (MessageType !== 'DIGEST' || SigningAlgorithm !== 'ECDSA_SHA_256' || Message.length !== 32) {
      throw new Error('ValidationException: this enclave signs 32-byte digests with ECDSA_SHA_256')
    }
    const sig = new ethers.SigningKey('0x' + this._isolatedKey.toStringRaw()).sign(Message)
    const derInt = (hex) => {
      let bytes = Buffer.from(hex.slice(2), 'hex')
      while (bytes.length > 1 && bytes[0] === 0 && !(bytes[1] & 0x80)) bytes = bytes.subarray(1)
      return (bytes[0] & 0x80) ? Buffer.concat([Buffer.from([0x00]), bytes]) : bytes
    }
    const r = derInt(sig.r)
    const sv = derInt(sig.s)
    const derSig = Buffer.concat([Buffer.from([0x30, 4 + r.length + sv.length, 0x02, r.length]), r, Buffer.from([0x02, sv.length]), sv])

    return {
      KeyId,
      Signature: new Uint8Array(derSig),
      SigningAlgorithm
    }
  }
}

// Entry point: Initialize AWS KMS client and execute custody workflow
const main = async () => {
  console.log('--- SESSION START: AWS KMS Enterprise Signer ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const custodyKey = PrivateKey.fromStringDer(operatorKey)
  const isECDSA = custodyKey.publicKey.toStringDer().startsWith('302d300706052b8104000a')
  const kmsLive = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_KMS_KEY_ARN)

  console.log(`[SECURITY] Custody Mode: ${kmsLive ? 'AWS KMS signer (live)' : 'Simulated KMS signer (key in memory)'}`)
  console.log(`[LOG] Account ID:        ${operatorId.toString()}`)
  console.log(`[LOG] Public Key (DER):  ${custodyKey.publicKey.toStringDer().substring(0, 32)}...`)
  console.log(`[LOG] Key Algorithm:     ${isECDSA ? 'ECC_SECG_P256K1 (ECDSA)' : 'ED25519'}`)
  if (!isECDSA) {
    console.error('[FAILED] This lab signs with an AWS KMS ECC_SECG_P256K1 key, so the account needs an ECDSA (secp256k1) key.')
    process.exitCode = 1
    return
  }

  // Initialize AWS KMS Adapter (Zero external programs needed; supports live AWS KMS seamlessly)
  const kmsAdapter = new EnterpriseKmsAdapter({ isolatedKey: custodyKey })

  try {
    console.log('\n[PROCESS] Step 1: Constructing raw, un-signed transaction...')

    // Construct a benign state ping transfer transaction (0 HBAR to self)
    const transaction = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(0))
      .freezeWith(client)

    console.log('[PROCESS] Step 2: Delegating signature callback to AWS KMS HSM Enclave...')

    // Sign using Hedera's asynchronous signWith callback
    await transaction.signWith(custodyKey.publicKey, async (transactionBodyBytes) => {
      // Hedera ECDSA signs keccak-256 of the body bytes: send KMS that digest.
      const digest = ethers.getBytes(ethers.keccak256(transactionBodyBytes))
      const kmsResponse = await kmsAdapter.sign({
        KeyId: kmsAdapter.keyArn,
        Message: digest,
        MessageType: 'DIGEST',
        SigningAlgorithm: 'ECDSA_SHA_256'
      })

      // KMS returns ASN.1 DER (and does not normalize s): convert to Hedera's 64-byte r||s, low-s.
      const rawSignature = unpackDerToRaw(kmsResponse.Signature)
      console.log(`[SUCCESS] DER Signature decoded to canonical 64 bytes: ${rawSignature.toString('hex').substring(0, 24)}...`)
      return rawSignature
    })

    console.log('\n[PROCESS] Step 3: Broadcasting KMS-signed transaction to Hedera consensus nodes...')
    const txResponse = await transaction.execute(client)
    const receipt = await txResponse.getReceipt(client)

    console.log(`\n[SUCCESS] Consensus Status: ${receipt.status.toString()}`)
    console.log(`[LOG] Transaction ID:     ${txResponse.transactionId.toString()}`)
    console.log(`[EXPLORER] View on HashScan: ${getHashscanUrl(txResponse)}`)

    console.log('\n KEY CONCEPT:')
    if (kmsAdapter.isLiveAws) {
      console.log('Zero Key Exposure: the transaction bytes were signed by AWS KMS and the')
      console.log('application never held the private key. Hedera accepted the signature.')
    } else {
      console.log('The signing went through the same KMS-shaped callback, but the "enclave" was')
      console.log('simulated in memory with your operator key. With AWS credentials and')
      console.log('AWS_KMS_KEY_ARN set, the same code asks AWS KMS to sign and the key never')
      console.log('enters this process.')
    }

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error(`\n[FAILED] KMS Signing Error: ${error.message}`)
    process.exitCode = 1
    if (client) client.close()
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
