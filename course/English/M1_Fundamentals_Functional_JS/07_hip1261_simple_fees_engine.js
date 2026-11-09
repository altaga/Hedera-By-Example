/**
 * ============================================================================
 * Lab 07: HIP-1261 Simple Fees & Deterministic Pricing Engine
 * [CONCEPT] Predictable Hedera Fee Modeling (Node, Network, Service)
 * ============================================================================
 * [ KEY CONCEPT ]
 * Unlike Ethereum gas auctions where prices spike 100x during network congestion,
 * Hedera uses a deterministic, USD-pegged fee schedule governed by HIP-1261.
 *
 * Every transaction fee is the sum of three components:
 * 1. Node Fee: pays the consensus node that received the transaction.
 * 2. Network Fee: pays the nodes for gossip and consensus ordering.
 * 3. Service Fee: pays for the state change (here, a CryptoTransfer).
 * Together they make the published USD price; for a basic HBAR transfer that is $0.0001.
 *
 * This lab interrogates the live Hedera exchange rate file, converts the published
 * USD price to tinybars before broadcasting, executes the transaction, and compares
 * the quote with the fee the network actually charged.
 * *
 * [ LEARNABLE MOMENT ]
 * Unlike variable gas price auctions that can price users out during network congestion, Hedera fees are set in USD in a published schedule (a basic HBAR transfer is $0.0001) and converted to HBAR with the network's exchange rate, so the HBAR amount moves only with that rate.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-1261
 *
 * [ LEARNING PATH ]
 * - Previous: M1 Lab 06: Native Staking (HIP-406)
 * - Next:     M1 Lab 08: HBAR Allowances & Sponsored Spending (HIP-336)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M1_Fundamentals_Functional_JS/07_hip1261_simple_fees_engine.js
 * ============================================================================
 */

import { TransferTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getMirrorNodeBaseUrl, updateState } from '../M99_Utilities/index.js'

/**
 * Queries the live USD/HBAR exchange rate file from the Hedera Mirror Node.
 *
 * @param {string} mirrorBase - Mirror node base URL
 * @returns {Promise<Object>} { cents, hbarEquiv, rateUsdPerHbar, expiration }
 */
const fetchExchangeRate = async (mirrorBase) => {
  // Read from the Mirror Node REST API: free, but a few seconds behind consensus.
  const response = await fetch(`${mirrorBase}/api/v1/network/exchangerate`)
  if (!response.ok) {
    throw new Error(`Mirror node exchange rate API error: ${response.statusText}`)
  }
  const data = await response.json()
  const { current_rate: current } = data
  const rateUsdPerHbar = (current.cent_equivalent / current.hbar_equivalent) / 100

  return {
    cents: current.cent_equivalent,
    hbarEquiv: current.hbar_equivalent,
    rateUsdPerHbar,
    expiration: new Date(current.expiration_time * 1000).toISOString()
  }
}

/**
 * Calculates the exact tinybar cost for a target USD fee based on HIP-1261.
 *
 * @param {number} feeUsd - Fee in USD
 * @param {number} cents - Cents equivalent from network exchange rate
 * @param {number} hbarEquiv - HBAR equivalent from network exchange rate
 * @returns {number} Cost in tinybars (1 HBAR = 100,000,000 tinybars)
 */
const calculateTinybars = (feeUsd, cents, hbarEquiv) => {
  const tinybars = Math.round((feeUsd * 100 * hbarEquiv * 100_000_000) / cents)
  return tinybars
}

const main = async () => {
  console.log('--- SESSION START: HIP-1261 Simple Fees Pricing Engine ---\n')

  const { client, operatorId } = getClient()
  const mirrorBase = getMirrorNodeBaseUrl()

  try {
    console.log('[PROCESS] Step 1: Interrogating live network exchange rate from Mirror Node...')
    const rateInfo = await fetchExchangeRate(mirrorBase)

    console.log('\n---  HEDERA ON-CHAIN EXCHANGE RATE ---')
    console.log(`USD Rate per HBAR:   $${rateInfo.rateUsdPerHbar.toFixed(4)}`)
    console.log(`HBAR Equivalent:     ${rateInfo.hbarEquiv} ℏ`)
    console.log(`Cent Equivalent:     ${rateInfo.cents} ¢`)
    console.log(`Rate Expiration:     ${rateInfo.expiration}`)

    console.log('\n[PROCESS] Step 2: Deconstructing HIP-1261 Fee Schedule for CryptoTransfer...')

    // Published USD price of a basic HBAR transfer (node + network + service fees together).
    const TOTAL_STANDARD_FEE_USD = 0.0001
    const totalPredictedTinybars = calculateTinybars(TOTAL_STANDARD_FEE_USD, rateInfo.cents, rateInfo.hbarEquiv)

    console.log('\n---  FEE QUOTE (published price) ---')
    console.log(`Total Quote:  $${TOTAL_STANDARD_FEE_USD.toFixed(4)} USD -> ${totalPredictedTinybars.toLocaleString()} tinybars (~${(totalPredictedTinybars / 1e8).toFixed(6)} ℏ)`)

    console.log('\n[PROCESS] Step 3: Executing live CryptoTransfer to verify consensus billing...')

    // Benchmark transaction: transfer 0 HBAR to self
    const transaction = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(0))
      .freezeWith(client)

    const response = await transaction.execute(client)
    const record = await response.getRecord(client)
    const actualFeeTinybars = record.transactionFee.toTinybars().toNumber()
    const actualFeeUsd = (actualFeeTinybars / 1e8) * rateInfo.rateUsdPerHbar

    console.log('\n---  CONSENSUS BILLING VERIFICATION ---')
    console.log(`Consensus Status:  ${record.receipt.status.toString()}`)
    console.log(`Transaction ID:    ${response.transactionId.toString()}`)
    console.log(`Actual Fee Charged:${actualFeeTinybars.toLocaleString()} tinybars (${record.transactionFee.toString()})`)
    console.log(`Actual Fee in USD: $${actualFeeUsd.toFixed(6)} USD`)
    console.log(`Variance vs Quote: ${Math.abs(actualFeeTinybars - totalPredictedTinybars).toLocaleString()} tinybars`)
    console.log(`[EXPLORER] View on HashScan: ${getHashscanUrl(response)}`)

    updateState('HIP1261_LAST_TX_ID', response.transactionId.toString())
    updateState('HIP1261_ACTUAL_FEE_TINYBARS', actualFeeTinybars)
    updateState('HIP1261_RATE_USD_PER_HBAR', rateInfo.rateUsdPerHbar)

    console.log('\n KEY CONCEPT:')
    console.log('No Gas Auctions: on Hedera, fees are set in USD and do not depend on demand.')
    console.log(`This transfer was quoted at $${TOTAL_STANDARD_FEE_USD} and charged $${actualFeeUsd.toFixed(6)}; any`)
    console.log('difference comes from extras such as signatures and transaction size.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error(`\n[FAILED] Fee Engine Calculation Failed: ${error.message}`)
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
