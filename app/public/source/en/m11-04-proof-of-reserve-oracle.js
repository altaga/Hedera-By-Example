/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Proof-of-Reserve (PoR) Oracle & Circuit Breakers
 * [ CONCEPT ] Real-Time Collateral Attestation and De-Peg Prevention
 * ============================================================================
 * [ KEY CONCEPT ]
 * Cryptographic Solvency: Issuing stablecoins or tokenized gold without real-time
 * proof of underlying collateral leads to insolvency crises. Proof-of-Reserve (PoR)
 * feeds stream audited custodial balances onto Hedera. If the reserve ratio falls
 * below 100%, an automated on-chain circuit breaker trips, freezing minting
 * until full capitalization is restored.
 * *
 * [ LEARNABLE MOMENT ]
 * To avoid catastrophic stablecoin de-pegging, automated Proof-of-Reserve oracles verify bank collateral before allowing mint transactions, tripping an on-chain circuit breaker if reserves fall below 100%.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/tokenization/stablecoin
 *
 * [ LEARNING PATH ]
 * - Previous: M11 Lab 03: Stablecoin Studio Roles
 * - Next:     M11 Lab 05: RWA Invoice Factoring
 *
 * [ SIMULATED ]
 * The custodian reserve figures are simulated. The on-chain reactions to them are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M11_Hedera_Studios_RWA/04_proof_of_reserve_oracle.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

class ProofOfReserveOracle {
  constructor (topicId, targetTokenId) {
    this.topicId = topicId
    this.targetTokenId = targetTokenId
    this.mintingEnabled = true
  }

  evaluateSolvency (onChainSupplyUsd, auditedCustodianBalanceUsd) {
    const collateralRatio = (auditedCustodianBalanceUsd / onChainSupplyUsd) * 100
    const isSolvent = collateralRatio >= 100.0

    if (!isSolvent && this.mintingEnabled) {
      this.mintingEnabled = false
      return {
        solvent: false,
        ratio: collateralRatio.toFixed(2),
        circuitBreakerAction: 'TRIPPED_EMERGENCY_MINT_PAUSE',
        alert: `CRITICAL DEFICIT: Reserves at ${collateralRatio.toFixed(2)}%. Minting halted.`
      }
    }

    if (isSolvent && !this.mintingEnabled) {
      this.mintingEnabled = true
      return {
        solvent: true,
        ratio: collateralRatio.toFixed(2),
        circuitBreakerAction: 'RESTORED_NORMAL_OPERATIONS',
        alert: `RESERVE RESTORED: Collateral at ${collateralRatio.toFixed(2)}%. Minting resumed.`
      }
    }

    return {
      solvent: isSolvent,
      ratio: collateralRatio.toFixed(2),
      circuitBreakerAction: 'MAINTAIN_CURRENT_STATE',
      alert: 'Solvency nominal. Reserves healthy.'
    }
  }
}

const main = async () => {
  console.log('--- SESSION START: Proof-of-Reserve (PoR) Attestation Oracle ---\n')
  const { client, operatorId, network } = getClient()

  try {
    // 1. Create dedicated HCS topic for Proof-of-Reserve Attestations
    console.log('[⚙️ PROCESS] Initializing Proof-of-Reserve Consensus Feed...')
    // Create the topic: an ordered, timestamped message log; a submit key would restrict who can write.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('por:custodian_attestation_feed')
      .freezeWith(client)

    const topicResponse = await topicTx.execute(client)
    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const topicReceipt = await topicResponse.getReceipt(client)
    const porTopicId = topicReceipt.topicId.toString()
    console.log(`[✅ SUCCESS] PoR Attestation Topic Created: ${porTopicId}`)

    const oracle = new ProofOfReserveOracle(porTopicId, '0.0.999123')

    // Scenario A: Over-Collateralized (Healthy)
    console.log('\n--- ATTESTATION CYCLE 1: Normal Banking Hours ---')
    const supplyA = 1250000 // $1.25M USDD in circulation
    const custodianA = 1312500 // $1.31M cash held in BNY Mellon
    const resultA = oracle.evaluateSolvency(supplyA, custodianA)

    console.log(`[📊 LOG] On-Chain Supply:    $${supplyA.toLocaleString()} USDD`)
    console.log(`[📊 LOG] Custodian Vault:    $${custodianA.toLocaleString()} USD`)
    console.log(`[📊 LOG] Collateral Ratio:   ${resultA.ratio}%`)
    console.log(`[📊 LOG] Minting Permitted:  ${oracle.mintingEnabled ? 'YES' : 'NO'}`)

    // Submit attestation to HCS
    const attestationMsgA = JSON.stringify({
      cycle: 1,
      custodian: 'BNY_MELLON_TRUST',
      tokenSupply: supplyA,
      auditedReserve: custodianA,
      collateralRatio: `${resultA.ratio}%`,
      mintingStatus: oracle.mintingEnabled ? 'ACTIVE' : 'HALTED',
      timestamp: Date.now()
    })

    // Publish: consensus gives the message a sequence number and a timestamp everyone agrees on.
    const msgTxA = await new TopicMessageSubmitTransaction()
      .setTopicId(porTopicId)
      .setMessage(attestationMsgA)
      .freezeWith(client)
    await msgTxA.execute(client)
    console.log('[✅ SUCCESS] Attestation 1 Anchored to Hedera Consensus.')

    // Scenario B: Bank Run / Sudden Deficit (Stress Event)
    console.log('\n--- ATTESTATION CYCLE 2: Sudden Collateral Shock ---')
    const supplyB = 1250000
    const custodianB = 1050000 // Only $1.05M remains (Deficit!)
    const resultB = oracle.evaluateSolvency(supplyB, custodianB)

    console.log(`[📊 LOG] On-Chain Supply:    $${supplyB.toLocaleString()} USDD`)
    console.log(`[📊 LOG] Custodian Vault:    $${custodianB.toLocaleString()} USD`)
    console.log(`[🚨 ALERT] Collateral Ratio: ${resultB.ratio}% (< 100%)`)
    console.log(`[🚨 ALERT] Circuit Breaker:  ${resultB.circuitBreakerAction}`)
    console.log(`[🚨 ALERT] Minting Status:   ${oracle.mintingEnabled ? 'ACTIVE' : 'HALTED'}`)

    const attestationMsgB = JSON.stringify({
      cycle: 2,
      custodian: 'BNY_MELLON_TRUST',
      tokenSupply: supplyB,
      auditedReserve: custodianB,
      collateralRatio: `${resultB.ratio}%`,
      mintingStatus: 'HALTED_CIRCUIT_BREAKER',
      timestamp: Date.now()
    })

    const msgTxB = await new TopicMessageSubmitTransaction()
      .setTopicId(porTopicId)
      .setMessage(attestationMsgB)
      .freezeWith(client)
    await msgTxB.execute(client)
    console.log('[✅ SUCCESS] Emergency Alert Anchored to Hedera Consensus.')

    updateState('POR_TOPIC_ID', porTopicId)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Proof-of-Reserve turns transparency into an automated defense system.')
    console.log('By streaming certified reserve audits to HCS, stablecoin issuers eliminate')
    console.log('bank-run panic and prove mathematical solvency around the clock.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Proof-of-Reserve oracle simulation failed:', error.message)
    process.exit(1)
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
