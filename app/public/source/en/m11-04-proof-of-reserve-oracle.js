/**
 * ============================================================================
 * Lab 04: Proof-of-Reserve (PoR) Oracle & Circuit Breakers
 * [CONCEPT] Real-Time Collateral Attestation and De-Peg Prevention
 * ============================================================================
 * [ KEY CONCEPT ]
 * Cryptographic Solvency: Issuing stablecoins or tokenized gold without real-time
 * proof of underlying collateral leads to insolvency crises. Proof-of-Reserve (PoR)
 * feeds stream audited custodial balances onto Hedera. If the reserve ratio falls
 * below 100%, the issuer's oracle trips a circuit breaker: on Hedera that is a
 * native TokenPauseTransaction, after which the network refuses every operation on
 * the token (mint, burn, transfer) until it is unpaused.
 *
 * [ LEARNABLE MOMENT ]
 * The pause is enforced by the network, not by the issuer's app: once the token is paused, even the treasury's own mint is rejected with TOKEN_IS_PAUSED. The oracle only needs the token's pause key.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/tokenization/stablecoin
 *
 * [ LEARNING PATH ]
 * - Previous: M11 Lab 03: Stablecoin Roles on HTS (Stablecoin Studio Concepts)
 * - Next:     M11 Lab 05: Real-World Asset (RWA) Invoice Factoring Pipeline
 *
 * [ SIMULATED ]
 * The custodian reserve and supply figures are simulated (a demo custodian, not a real bank). The token, the mint, the pause, the refused mint, the unpause and the HCS attestations are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD); <0.1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M11_Hedera_Studios_RWA/04_proof_of_reserve_oracle.js
 * ============================================================================
 */

import {
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenPauseTransaction,
  TokenSupplyType,
  TokenType,
  TokenUnpauseTransaction,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, parsePrivateKey, reuseToken, reuseTopic, updateState } from '../M99_Utilities/index.js'

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
  const { client, operatorId, operatorKey } = getClient()
  const key = parsePrivateKey(operatorKey)
  let tokenId
  let paused = false

  try {
    // 1. The stablecoin (pause key = the oracle's circuit breaker) and the attestation topic
    console.log('[PROCESS] Preparing the reserve-backed token and the PoR attestation topic...')
    tokenId = await reuseToken('REUSE_M11_04_TOKEN', async () => {
      const receipt = await (await new TokenCreateTransaction()
        .setTokenName('Reserve-Backed Dollar (course demo)')
        .setTokenSymbol('tRSV')
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(2)
        .setInitialSupply(0)
        .setSupplyType(TokenSupplyType.Infinite)
        .setTreasuryAccountId(operatorId)
        .setAdminKey(key)
        .setSupplyKey(key)
        .setPauseKey(key)
        .execute(client)).getReceipt(client)
      return receipt.tokenId
    }, { check: (t) => !!t.pause_key })
    const porTopicId = (await reuseTopic('REUSE_M11_04_TOPIC', async () =>
      (await (await new TopicCreateTransaction().setTopicMemo('por:custodian_attestation_feed').execute(client)).getReceipt(client)).topicId
    )).toString()
    console.log(`[SUCCESS] Token ${tokenId} (pause key held by the oracle) | Attestation topic ${porTopicId}`)

    const oracle = new ProofOfReserveOracle(porTopicId, tokenId.toString())
    const attest = async (payload) => {
      const receipt = await (await new TopicMessageSubmitTransaction()
        .setTopicId(porTopicId)
        .setMessage(JSON.stringify({ ...payload, token: tokenId.toString(), custodian: 'DEMO_CUSTODIAN_BANK', timestamp: Date.now() }))
        .execute(client)).getReceipt(client)
      return receipt.topicSequenceNumber.toString()
    }
    const mint = async (units) => (await (await new TokenMintTransaction().setTokenId(tokenId).setAmount(units).execute(client)).getReceipt(client))

    // Cycle 1: healthy reserves -> the issuer mints
    console.log('\n--- ATTESTATION CYCLE 1: Normal Banking Hours ---')
    const supplyA = 1250000
    const custodianA = 1312500
    const resultA = oracle.evaluateSolvency(supplyA, custodianA)
    console.log(`[LOG] Supply: $${supplyA.toLocaleString()} | Custodian vault: $${custodianA.toLocaleString()} | Ratio: ${resultA.ratio}%`)
    const minted = await mint(10000) // 100.00 tRSV
    console.log(`[SUCCESS] Mint allowed: 100.00 tRSV issued (total supply now ${(Number(minted.totalSupply) / 100).toFixed(2)})`)
    console.log(`[SUCCESS] Attestation 1 anchored on HCS (sequence #${await attest({ cycle: 1, tokenSupply: supplyA, auditedReserve: custodianA, collateralRatio: `${resultA.ratio}%`, mintingStatus: 'ACTIVE' })})`)

    // Cycle 2: deficit -> the oracle pauses the token on-chain
    console.log('\n--- ATTESTATION CYCLE 2: Sudden Collateral Shock ---')
    const supplyB = 1250000
    const custodianB = 1050000
    const resultB = oracle.evaluateSolvency(supplyB, custodianB)
    console.log(`[ALERT] Ratio ${resultB.ratio}% (< 100%) -> ${resultB.circuitBreakerAction}`)
    const pauseRes = await new TokenPauseTransaction().setTokenId(tokenId).execute(client)
    await pauseRes.getReceipt(client)
    paused = true
    console.log(`[SUCCESS] Circuit breaker tripped on-chain: token ${tokenId} paused. ${getHashscanUrl(pauseRes)}`)
    let refused = null
    try { await mint(10000) } catch (error) { refused = String(error.status ?? error.message) }
    if (!refused) throw new Error('The paused token still accepted a mint')
    console.log(`[VERIFY] Minting now refused by the network: ${refused}`)
    console.log(`[SUCCESS] Emergency alert anchored on HCS (sequence #${await attest({ cycle: 2, tokenSupply: supplyB, auditedReserve: custodianB, collateralRatio: `${resultB.ratio}%`, mintingStatus: 'HALTED_CIRCUIT_BREAKER' })})`)

    // Cycle 3: recapitalized -> the oracle unpauses
    console.log('\n--- ATTESTATION CYCLE 3: Reserves Restored ---')
    const custodianC = 1300000
    const resultC = oracle.evaluateSolvency(supplyB, custodianC)
    console.log(`[LOG] Ratio ${resultC.ratio}% -> ${resultC.circuitBreakerAction}`)
    await (await new TokenUnpauseTransaction().setTokenId(tokenId).execute(client)).getReceipt(client)
    paused = false
    console.log(`[SUCCESS] Token ${tokenId} unpaused; minting is possible again.`)
    console.log(`[SUCCESS] Restoration anchored on HCS (sequence #${await attest({ cycle: 3, tokenSupply: supplyB, auditedReserve: custodianC, collateralRatio: `${resultC.ratio}%`, mintingStatus: 'ACTIVE' })})`)

    updateState('POR_TOPIC_ID', porTopicId)
    updateState('POR_TOKEN_ID', tokenId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('Proof-of-Reserve turns transparency into an automated defense: the attestations')
    console.log('are public on HCS, and the circuit breaker is a native token pause the network enforces.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Proof-of-Reserve oracle failed:', error.message)
    process.exitCode = 1
  } finally {
    // Never leave the demo token paused: the next run would have to create a new one.
    if (paused) {
      try { await (await new TokenUnpauseTransaction().setTokenId(tokenId).execute(client)).getReceipt(client) } catch (_) {}
    }
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
