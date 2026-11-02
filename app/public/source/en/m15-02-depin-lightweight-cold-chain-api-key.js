/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: DePIN Lightweight Cold-Chain Telemetry (API Key + HMAC-SHA256)
 * [ CONCEPT ] Low-Power Logistics Monitoring & Automated SLA Slashing
 * ============================================================================
 * [ KEY CONCEPT ]
 * Low-power IoT devices (cellular asset trackers, cold-chain biologics containers,
 * ambient environmental probes) cannot maintain continuous TLS sockets due to strict
 * battery budgets. Instead, they wake from deep sleep, issue an HTTP REST request with
 * a pre-shared API Key and an HMAC-SHA256 signature over the payload, and return to sleep.
 * An enterprise ingestion gateway authenticates the HMAC signature and continuously audits
 * Service Level Agreements (SLAs) against Hedera Consensus Service.
 *
 * [ LEARNABLE MOMENT ]
 * Cryptographic signatures over HTTP headers (`X-HMAC-SHA256`) prevent Man-in-the-Middle
 * spoofing and replay attacks without requiring heavy TLS handshakes or complex certificate
 * authorities on constrained microcontrollers (ESP32 / Nordic nRF9160). When an SLA breach
 * is detected (e.g., vaccine temperature exceeding +8°C), anchoring the breach directly to
 * HCS provides indisputable legal proof for insurance and automated carrier slashing.
 *
 * [ LEARNING PATH ]
 * - Previous: M15 Lab 01: DePIN High-Speed MQTTS Telemetry & Hardware Signing
 * - Next:     M15 Lab 03: Intent-Based DeFi Settlement Solver (ERC-7683)
 *
 * [ OFFICIAL REFERENCES ]
 * - Hedera Consensus Service Overview: https://docs.hedera.com/hedera/services/consensus-service
 * - RFC 2104: HMAC: Keyed-Hashing for Message Authentication
 * - WHO Technical Report 961: Temperature & Humidity Monitoring in Cold Chains
 *
 * [ SIMULATED ]
 * The IoT tracker and its HTTP requests are emulated. The HMAC checks and the HCS records are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M15_DePIN_and_Future_Crypto/02_depin_lightweight_cold_chain_api_key.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import crypto from 'node:crypto'
import { getClient, updateState, getHashscanUrl, show } from '../M99_Utilities/index.js'

/**
 * Emulated Battery-Constrained IoT Tracker (Cold Chain Vaccine Container)
 */
class ColdChainSensorDevice {
  constructor (deviceId, apiKey, sharedHmacSecret) {
    this.deviceId = deviceId
    this.apiKey = apiKey
    this.sharedHmacSecret = sharedHmacSecret
  }

  /**
   * Simulates an HTTP POST telemetry packet with HMAC-SHA256 authentication headers.
   */
  createTelemetryRequest (temperatureCelsius, humidityPct, locationGeo) {
    const body = {
      deviceId: this.deviceId,
      timestamp: Date.now(),
      metrics: {
        temperatureCelsius,
        humidityPct,
        batteryPercent: 94
      },
      location: locationGeo
    }

    const bodyString = JSON.stringify(body)
    // Compute HMAC-SHA256 signature using the shared secret
    const hmacSignature = crypto
      .createHmac('sha256', this.sharedHmacSecret)
      .update(bodyString)
      .digest('hex')

    return {
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': this.deviceId,
        'X-API-Key': this.apiKey,
        'X-HMAC-Signature': hmacSignature
      },
      rawBody: bodyString,
      parsedBody: body
    }
  }
}

/**
 * Gateway SLA Verifier & Ingestion Engine
 */
class LogisticsSLAGateway {
  constructor (validDevices, tempMinC = 2.0, tempMaxC = 8.0) {
    this.validDevices = validDevices // Map: deviceId -> { apiKey, sharedHmacSecret }
    this.tempMinC = tempMinC
    this.tempMaxC = tempMaxC
  }

  /**
   * Validates API Key, verifies HMAC-SHA256 signature, and inspects SLA compliance.
   */
  processPacket (request) {
    const { 'X-Device-Id': deviceId, 'X-API-Key': apiKey, 'X-HMAC-Signature': signature } = request.headers
    const record = this.validDevices[deviceId]

    if (!record || record.apiKey !== apiKey) {
      return { status: 401, error: 'Unauthorized: Invalid Device ID or API Key' }
    }

    // Verify HMAC-SHA256
    const expectedSig = crypto
      .createHmac('sha256', record.sharedHmacSecret)
      .update(request.rawBody)
      .digest('hex')

    if (expectedSig !== signature) {
      return { status: 403, error: 'Forbidden: HMAC signature mismatch / payload tampered' }
    }

    const { temperatureCelsius } = request.parsedBody.metrics
    const isSlaBreached = temperatureCelsius < this.tempMinC || temperatureCelsius > this.tempMaxC

    return {
      status: 200,
      deviceId,
      temperatureCelsius,
      isSlaBreached,
      slaThresholds: { min: this.tempMinC, max: this.tempMaxC },
      timestamp: request.parsedBody.timestamp
    }
  }
}

async function main () {
  console.log('====================================================================')
  console.log('❄️ DEPIN LAB 02: LIGHTWEIGHT COLD-CHAIN TELEMETRY & SLA SLASHING')
  console.log('====================================================================\n')

  const { client, operatorId, network } = getClient()

  try {
    console.log(`[📡 OPERATOR] Authenticated as ${operatorId} on Hedera ${network.toUpperCase()}`)

    // 1. Provision HCS Topic for Cold Chain SLA Tracking
    console.log('\n[1/5] Creating Dedicated Logistics Cold-Chain HCS Topic...')
    const topicCreateTx = await new TopicCreateTransaction()
      .setTopicMemo('DePIN Cold-Chain Vaccine SLA & Temperature Audit Trail')
      .execute(client)

    const topicReceipt = await topicCreateTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[✅ TOPIC CREATED] ID: ${topicId}`)
    console.log(`[🔗 EXPLORER] https://hashscan.io/${network}/topic/${topicId}`)

    // 2. Provision Gateway and Device Credentials
    console.log('\n[2/5] Configuring Zero-Trust Device Credentials & Gateway...')
    const deviceId = 'URN:IOT:LOGISTICS:COLDCHAIN:BOX-882'
    const apiKey = 'hcs_live_sec_' + crypto.randomBytes(16).toString('hex')
    const sharedHmacSecret = crypto.randomBytes(32).toString('hex')

    const device = new ColdChainSensorDevice(deviceId, apiKey, sharedHmacSecret)
    const gateway = new LogisticsSLAGateway({
      [deviceId]: { apiKey, sharedHmacSecret }
    }, 2.0, 8.0)

    console.log(`[📦 SENSOR] Assigned Device ID: ${deviceId}`)
    console.log(`[🔑 API KEY] ${apiKey.substring(0, 20)}...`)
    console.log(`[🔒 HMAC SECRET] ${sharedHmacSecret.substring(0, 16)}...`)
    console.log('[📋 SLA TARGET] Vaccine Storage Requirement: +2.0°C to +8.0°C')

    // 3. Emulate Telemetry Lifecycle: 3 Compliant Readings + 1 Critical Excursion
    console.log('\n[3/5] Emulating Sensor Wakeup & Telemetry Submissions...')
    const readings = [
      { temp: 4.2, hum: 55, geo: 'Mumbai Port Hub (18.9388° N, 72.8354° E)' },
      { temp: 4.8, hum: 56, geo: 'Transit Corridor NH-48 (19.0760° N, 72.8777° E)' },
      { temp: 5.6, hum: 58, geo: 'Regional Distribution Center (19.2183° N, 72.9781° E)' },
      { temp: 14.8, hum: 78, geo: 'Local Depo - COMPRESSOR POWER CUT (19.2403° N, 73.1305° E)' }
    ]

    let slaBreachEvent = null
    const tempSeries = []

    for (let i = 0; i < readings.length; i++) {
      const r = readings[i]
      const request = device.createTelemetryRequest(r.temp, r.hum, r.geo)
      const evaluation = gateway.processPacket(request)
      tempSeries.push({ x: i + 1, y: r.temp, ...(evaluation.isSlaBreached ? { status: 'critical', label: `${r.temp} °C` } : {}) })
      show.chart({ id: 'temp', type: 'line', title: 'Vaccine container temperature', unit: '°C', xLabel: 'Report', yLabel: '°C', points: tempSeries, threshold: { value: 8, label: 'SLA max +8 °C' } })

      if (evaluation.status !== 200) {
        throw new Error(`Gateway rejected packet #${i + 1}: ${evaluation.error}`)
      }

      if (evaluation.isSlaBreached) {
        console.log(`   🚨 [REPORT #${i + 1}] Temp: ${r.temp}°C | SLA VIOLATION! (Limits: +2°C to +8°C) | Loc: ${r.geo}`)
        slaBreachEvent = { ...evaluation, geo: r.geo }
      } else {
        console.log(`   ❄️ [REPORT #${i + 1}] Temp: ${r.temp}°C | SLA Compliant ✅ | HMAC: Verified | Loc: ${r.geo}`)
      }
    }

    // 4. Notarize Periodic Audit Checkpoint to HCS
    console.log('\n[4/5] Notarizing Compliant Transit Interval to HCS Consensus...')
    const compliantAuditMessage = {
      p: 'depin-coldchain-v1',
      op: 'periodic_sla_audit',
      deviceId,
      compliantSamples: 3,
      avgTemperatureC: 4.86,
      slaStatus: 'COMPLIANT',
      timestamp: Date.now()
    }

    const auditSubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(compliantAuditMessage))
      .execute(client)

    const auditReceipt = await auditSubmitTx.getReceipt(client)
    console.log(`[✅ AUDIT ANCHORED] Sequence #${auditReceipt.topicSequenceNumber} on HCS`)
    console.log(`[🔗 EXPLORER] ${getHashscanUrl(auditSubmitTx.transactionId.toString())}`)

    // 5. Trigger Immutable SLA Breach Event & Slashing Notice
    console.log('\n[5/5] Notarizing SLA Breach & Bond Slashing Notice to HCS...')
    const breachAuditMessage = {
      p: 'depin-coldchain-v1',
      op: 'sla_breach_slashing_notice',
      deviceId,
      temperatureCelsius: slaBreachEvent.temperatureCelsius,
      allowedRange: slaBreachEvent.slaThresholds,
      location: slaBreachEvent.geo,
      action: 'FREEZE_CARRIER_PAYOUT_AND_SLASH_DEPOSIT',
      penaltyUnits: '1,500_USDC_BOND_FORFEIT',
      timestamp: slaBreachEvent.timestamp
    }

    const breachSubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(breachAuditMessage))
      .execute(client)

    const breachReceipt = await breachSubmitTx.getReceipt(client)
    console.log(`[🚨 BREACH ANCHORED] Sequence #${breachReceipt.topicSequenceNumber} on HCS!`)
    console.log(`[🔗 EXPLORER] ${getHashscanUrl(breachSubmitTx.transactionId.toString())}`)

    // Persist State
    updateState('DEPIN_COLDCHAIN_TOPIC_ID', topicId)
    updateState('DEPIN_COLDCHAIN_DEVICE_ID', deviceId)
    updateState('DEPIN_COLDCHAIN_BREACH_TEMP', `${slaBreachEvent.temperatureCelsius}°C`)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Low-power IoT nodes save energy with lightweight HTTP + HMAC-SHA256 signatures.')
    console.log('When an enterprise gateway detects an SLA breach, anchoring the event to HCS provides')
    console.log('verifiable evidence that automates bond slashing and prevents insurance fraud.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Always authenticate both device identity (API Key) and payload integrity (HMAC).')
    console.log('A signed payload prevents relay attacks and proves the physical custody chain.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Cold Chain DePIN Execution Failure:', error.message)
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
