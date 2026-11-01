/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: DePIN High-Speed MQTTS Telemetry & Hardware Signing (Pacemaker)
 * [ CONCEPT ] Mission-Critical IoT Ingestion & Consensus Batching
 * ============================================================================
 * [ KEY CONCEPT ]
 * DePIN (Decentralized Physical Infrastructure Networks) connects physical
 * hardware to decentralized ledgers. In mission-critical healthcare (e.g. cardiac
 * pacemakers, insulin pumps), telemetry must stream at high frequency with zero-trust
 * cryptographic authenticity. By signing telemetry in the device's Secure Enclave
 * (Ed25519) and streaming over MQTTS (TLS 1.3), an ingestion gateway aggregates
 * routine frames into a Merkle root for HCS batching while immediately dispatching
 * acute arrhythmia alerts to Hedera Consensus in < 2 seconds.
 *
 * [ LEARNABLE MOMENT ]
 * Direct on-chain publication of every single heartbeat (50-100 Hz) would overwhelm
 * bandwidth and storage. DePIN best practice uses edge batching: aggregate thousands
 * of normal readings into a single cryptographic Merkle Root on HCS ($0.0001 USD),
 * but trigger instantaneous out-of-band consensus messages when life-critical
 * anomaly thresholds are breached.
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 10: Hashnet MCP Server & HOL Guard
 * - Next:     M15 Lab 02: DePIN Lightweight Cold-Chain Telemetry (API Key + HMAC)
 *
 * [ OFFICIAL REFERENCES ]
 * - Hedera Consensus Service: https://docs.hedera.com/hedera/services/consensus-service
 * - HIP-10 Zero-Fee HCS Topic Standards: https://hips.hedera.com/hip/hip-10
 * - NIST SP 800-140C Cryptographic Module Validation (Ed25519 Hardware Keystores)
 *
 * [ HOW TO RUN ]
 * node English/M15_DePIN_and_Future_Crypto/01_depin_mqtts_pacemaker_telemetry.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import crypto from 'node:crypto'
import { getClient, updateState, getHashscanUrl } from '../M99_Utilities/index.js'

/**
 * Emulated MedTech Hardware Device: Implantable Cardiac Pacemaker (PM-8821)
 * Equipped with an onboard Secure Enclave holding an isolated Ed25519 keypair.
 */
class PacemakerHardwareDevice {
  constructor (deviceId = 'URN:IOT:MEDTECH:PACEMAKER:PM-8821') {
    this.deviceId = deviceId
    // Generates simulated hardware-isolated Ed25519 cryptographic keypair
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    this.privateKey = privateKey
    this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
  }

  /**
   * Generates a signed cardiac telemetry frame.
   * @param {boolean} forceArrhythmia - Whether to simulate a life-threatening tachycardia event.
   */
  generateTelemetryFrame (forceArrhythmia = false) {
    const bpm = forceArrhythmia
      ? Math.floor(165 + Math.random() * 35)
      : Math.floor(65 + Math.random() * 12)

    const payload = {
      deviceId: this.deviceId,
      timestamp: Date.now(),
      metrics: {
        bpm,
        pacingImpedanceOhms: 520 + Math.floor(Math.random() * 15),
        batteryMillivolts: 2985,
        event: forceArrhythmia ? 'VENTRICULAR_TACHYCARDIA_ALERT' : 'NORMAL_SINUS_RHYTHM'
      }
    }

    const payloadBuffer = Buffer.from(JSON.stringify(payload))
    // On-chip hardware signature of the telemetry payload
    const signature = crypto.sign(null, payloadBuffer, this.privateKey)

    return {
      payload,
      signatureHex: signature.toString('hex'),
      publicKeyPem: this.publicKeyPem
    }
  }
}

/**
 * Computes a standard 2-layer Merkle Root from an array of buffer hashes.
 */
function computeMerkleRoot (hashes) {
  if (hashes.length === 0) return crypto.createHash('sha256').update('EMPTY').digest('hex')
  let currentLevel = [...hashes]

  while (currentLevel.length > 1) {
    const nextLevel = []
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left
      const combined = crypto.createHash('sha256').update(left + right).digest('hex')
      nextLevel.push(combined)
    }
    currentLevel = nextLevel
  }
  return currentLevel[0]
}

async function main () {
  console.log('====================================================================')
  console.log('🔬 DEPIN LAB 01: MQTTS HIGH-SPEED CRITICAL TELEMETRY (PACEMAKER)')
  console.log('====================================================================\n')

  const { client, operatorId, network } = getClient()

  try {
    console.log(`[📡 OPERATOR] Authenticated as ${operatorId} on Hedera ${network.toUpperCase()}`)

    // 1. Provision HCS Telemetry Topic
    console.log('\n[1/5] Creating Dedicated MedTech HCS Telemetry Topic...')
    const topicCreateTx = await new TopicCreateTransaction()
      .setTopicMemo('DePIN MedTech Telemetry & Pacemaker Alert Feed')
      .execute(client)

    const topicReceipt = await topicCreateTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[✅ TOPIC CREATED] ID: ${topicId}`)
    console.log(`[🔗 EXPLORER] https://hashscan.io/${network}/topic/${topicId}`)

    // 2. Initialize Emulated Pacemaker Hardware
    console.log('\n[2/5] Initializing Implantable Pacemaker Device (Ed25519 Keystore)...')
    const device = new PacemakerHardwareDevice()
    console.log(`[🩺 DEVICE ID] ${device.deviceId}`)
    console.log('[🔑 HARDWARE KEY] Secure Enclave Ed25519 Keypair generated.')

    // 3. Emulate High-Frequency MQTTS Telemetry Stream
    console.log('\n[3/5] Streaming High-Speed MQTTS Telemetry Frames...')
    const routineBatch = []
    let emergencyAlertFrame = null

    for (let frameIndex = 1; frameIndex <= 8; frameIndex++) {
      // Simulate frame 6 as an acute cardiac arrhythmia spike
      const isCritical = frameIndex === 6
      const frame = device.generateTelemetryFrame(isCritical)

      // Gateway zero-trust verification of hardware signature
      const payloadBuf = Buffer.from(JSON.stringify(frame.payload))
      const isValid = crypto.verify(
        null,
        payloadBuf,
        frame.publicKeyPem,
        Buffer.from(frame.signatureHex, 'hex')
      )

      if (!isValid) {
        throw new Error(`Hardware signature verification failed for frame #${frameIndex}`)
      }

      const frameHash = crypto.createHash('sha256').update(payloadBuf).digest('hex')

      if (isCritical) {
        console.log(`   🚨 [FRAME #${frameIndex}] CRITICAL ARREST/TACHYCARDIA: ${frame.payload.metrics.bpm} BPM | Hardware Sig: Verified ✅`)
        emergencyAlertFrame = frame
      } else {
        console.log(`   💓 [FRAME #${frameIndex}] Normal Heartbeat: ${frame.payload.metrics.bpm} BPM | Hash: ${frameHash.substring(0, 16)}... | Sig: ✅`)
        routineBatch.push(frameHash)
      }
    }

    // 4. Anchor Normal Telemetry as Merkle Batch on HCS
    console.log('\n[4/5] Anchoring Aggregated Merkle Batch to Hedera Consensus...')
    const merkleRoot = computeMerkleRoot(routineBatch)
    const batchMessage = {
      p: 'depin-telemetry-v1',
      op: 'merkle_batch',
      deviceId: device.deviceId,
      sampleCount: routineBatch.length,
      merkleRoot,
      windowMs: 8000,
      timestamp: Date.now()
    }

    const batchSubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(batchMessage))
      .execute(client)

    const batchReceipt = await batchSubmitTx.getReceipt(client)
    console.log(`[✅ BATCH ANCHORED] Merkle Root: ${merkleRoot}`)
    console.log(`[📊 CONSENSUS] Sequence #${batchReceipt.topicSequenceNumber} on HCS`)
    console.log(`[🔗 EXPLORER] ${getHashscanUrl(batchSubmitTx.transactionId.toString())}`)

    // 5. Immediate Out-of-Band Critical Arrhythmia Consensus Submission
    console.log('\n[5/5] Submitting Emergency High-Priority Pacemaker Alert to HCS...')
    const emergencyMessage = {
      p: 'depin-telemetry-v1',
      op: 'critical_emergency_alert',
      deviceId: emergencyAlertFrame.payload.deviceId,
      event: emergencyAlertFrame.payload.metrics.event,
      bpm: emergencyAlertFrame.payload.metrics.bpm,
      hardwareSignature: emergencyAlertFrame.signatureHex,
      timestamp: emergencyAlertFrame.payload.timestamp
    }

    const emergencySubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(emergencyMessage))
      .execute(client)

    const emergencyReceipt = await emergencySubmitTx.getReceipt(client)
    console.log(`[🚨 EMERGENCY NOTARIZED] Sequence #${emergencyReceipt.topicSequenceNumber} verified in Consensus!`)
    console.log(`[🔗 EXPLORER] ${getHashscanUrl(emergencySubmitTx.transactionId.toString())}`)

    // Persist State
    updateState('DEPIN_PACEMAKER_TOPIC_ID', topicId)
    updateState('DEPIN_PACEMAKER_DEVICE_ID', device.deviceId)
    updateState('DEPIN_PACEMAKER_MERKLE_ROOT', merkleRoot)

    console.log('\n💡 KEY CONCEPT:')
    console.log('DePIN combines IoT hardware cryptography with Hedera high-throughput consensus.')
    console.log('Normal operations are batched off-chain to minimize overhead, while life-critical')
    console.log('alerts achieve immutable consensus ordering in under 2 seconds.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Never post individual raw sensor frames if you can batch via Merkle proofs.')
    console.log('Always design event-driven circuit breakers that prioritize life-safety alerts.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Pacemaker DePIN Execution Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ ERROR] Execution Failure:', error.message)
    process.exit(1)
  })
}
