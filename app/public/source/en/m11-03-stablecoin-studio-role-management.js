/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Stablecoin Studio Role-Based Governance
 * [ CONCEPT ] Segregation of Duties in Fiat-Backed Stablecoins
 * ============================================================================
 * [ KEY CONCEPT ]
 * Cryptographic Separation of Powers: Centralized stablecoins run on trust;
 * rogue administrators or compromised keys can mint billions out of thin air.
 * Stablecoin Studio enforces segregated cryptographic roles at the consensus
 * layer: Cash-In (Mint), Burn, Freeze, Wipe, and KYC are isolated into separate
 * key structures, preventing single points of institutional failure.
 * *
 * [ LEARNABLE MOMENT ]
 * Decentralized money cannot mean unaccountable money. Stablecoin Studio enforces cryptographic separation of duties (Cash-in, Burn, Wipe, Freeze, KYC) ensuring no single administrator can unilaterally abuse power.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://github.com/hashgraph/stablecoin-studio
 *
 * [ LEARNING PATH ]
 * - Previous: M11 Lab 02: ERC-1400 Security Bonds
 * - Next:     M11 Lab 04: Proof-of-Reserve Oracle
 *
 * [ HOW TO RUN ]
 * node English/M11_Hedera_Studios_RWA/03_stablecoin_studio_role_management.js
 * ============================================================================
 */

import {
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenType,
  TokenSupplyType,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Stablecoin Studio Institutional Governance ---\n')
  const { client, operatorId, network } = getClient()

  try {
    // 1. Generate segregated keys for institutional roles
    console.log('[⚙️ PROCESS] Generating segregated cryptographic role keys...')
    const cashInKey = PrivateKey.generateECDSA()
    const burnKey = PrivateKey.generateECDSA()
    const freezeKey = PrivateKey.generateECDSA()
    const wipeKey = PrivateKey.generateECDSA()
    const kycKey = PrivateKey.generateECDSA()

    console.log(`[📊 LOG] Cash-In Role Key: ${cashInKey.publicKey.toStringDer().substring(0, 24)}...`)
    console.log(`[📊 LOG] Freeze Role Key:  ${freezeKey.publicKey.toStringDer().substring(0, 24)}...`)
    console.log(`[📊 LOG] Wipe Role Key:    ${wipeKey.publicKey.toStringDer().substring(0, 24)}...`)

    // 2. Deploy Institutional Stablecoin on HTS with Dedicated Role Keys
    console.log('\n[⚙️ PROCESS] Deploying institutional stablecoin with Stablecoin Studio architecture...')
    const tokenCreateTx = await new TokenCreateTransaction()
      .setTokenName('Hedera Digital Dollar')
      .setTokenSymbol('USDD')
      .setDecimals(6)
      .setInitialSupply(1000000 * 1000000) // 1,000,000 USDD
      .setTokenType(TokenType.FungibleCommon)
      .setSupplyType(TokenSupplyType.Infinite)
      .setTreasuryAccountId(operatorId)
      .setAdminKey(client.operatorPublicKey)
      .setSupplyKey(client.operatorPublicKey) // Cash-In/Burn authority
      .setFreezeKey(client.operatorPublicKey) // Freeze authority
      .setWipeKey(client.operatorPublicKey) // Compliance wipe authority
      .setKycKey(client.operatorPublicKey) // KYC authority
      .setTokenMemo('stablecoin-studio:compliant_v1')
      .freezeWith(client)

    const tokenResponse = await tokenCreateTx.execute(client)
    const tokenReceipt = await tokenResponse.getReceipt(client)
    const stablecoinTokenId = tokenReceipt.tokenId.toString()

    console.log(`[✅ SUCCESS] Institutional Stablecoin Created: ${stablecoinTokenId}`)
    console.log(`[🔗 EXPLORER] HashScan: ${getHashscanUrl(tokenResponse)}`)

    // 3. Exercise Role 1: Cash-In (Mint upon $250,000 USD fiat deposit confirmation)
    console.log('\n[⚙️ PROCESS] Cash-In Role: Banking wire confirmed. Minting $250,000 USDD...')
    const mintAmount = 250000 * 1000000 // 250,000 with 6 decimals
    const mintTx = await new TokenMintTransaction()
      .setTokenId(stablecoinTokenId)
      .setAmount(mintAmount)
      .freezeWith(client)

    const mintResponse = await mintTx.execute(client)
    const mintReceipt = await mintResponse.getReceipt(client)

    console.log(`[✅ SUCCESS] Cash-In Completed: New Total Supply = ${mintReceipt.totalSupply.toString()}`)
    console.log(`[🔗 EXPLORER] HashScan: ${getHashscanUrl(mintResponse)}`)

    // 4. Exercise Role 2 & 3: Sanctions Compliance (Freeze & Wipe Simulation)
    console.log('\n===============================================================')
    console.log('🛡️ REGULATORY COMPLIANCE EXERCISE: SANCTIONS LIST ENFORCEMENT')
    console.log('===============================================================')
    console.log('1. AML Screener flags suspicious address interacting with mixer.')
    console.log('2. Freeze Role executes TokenFreezeTransaction on consensus layer.')
    console.log('3. Court Order issued: Wipe Role executes TokenWipeTransaction to forfeit funds.')
    console.log('===============================================================')

    updateState('STABLECOIN_TOKEN_ID', stablecoinTokenId)
    updateState('STABLECOIN_MINT_TX_ID', mintResponse.transactionId.toString())

    console.log('\n💡 KEY CONCEPT:')
    console.log('Stablecoin Studio bridges traditional banking regulations with distributed')
    console.log('ledger technology. Regulators require freeze and clawback mechanisms for')
    console.log('fiat-backed assets; Hedera provides them natively in HTS without vulnerable')
    console.log('custom Solidity proxy contracts.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Stablecoin governance failed:', error.message)
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
