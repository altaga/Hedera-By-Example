/**
 * ============================================================================
 * Lab 05: Autonomous Cross-Chain Intent Settlement Engine (CLPR + HIP-336)
 * [CONCEPT] Bridgeless Intent-Based Cross-Ledger Liquidity Router
 * ============================================================================
 * [ KEY CONCEPT ]
 * Intent-Based Cross-Ledger Architecture: Traditional bridging requires locking
 * funds in honeypots. With intent settlement engines, a user or agent simply
 * publishes an "intent" (e.g. "Swap 50 HBAR on Hedera for 100 USDC on Arbitrum").
 * A decentralized solver fills the order immediately using local liquidity,
 * while the Hedera settlement is proven cryptographically via CLPR (HIP-1535)
 * and executed gaslessly for the user via Sponsored Fees (HIP-336).
 *
 * [ LEARNABLE MOMENT ]
 * Users do not want to wait 20 minutes or buy gas on multiple networks just to
 * move liquidity. Intents shift execution risk to professional solvers while
 * Hedera guarantees atomic final settlement in 2.5 seconds for fractions of a cent.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-1535
 * - https://github.com/hiero-ledger/hiero-improvement-proposals/blob/main/HIP/hip-336.md
 * - https://eips.ethereum.org/EIPS/eip-7683
 *
 * [ LEARNING PATH ]
 * - Previous: M13 Lab 04: Block Node Discovery & Decentralized Data Lake (HIP-1081 / HIP-1137)
 * - Next:     M13 Lab 06: Block Stream Protobuf Encoder/Parser with the Official HAPI Schemas
 *
 * [ SEQUENCE ]
 * Trader -> Relayer: Grant an HBAR allowance (HIP-336)
 * Trader -> Hedera: Signed intent on HCS (fees sponsored)
 * Relayer -> Other Chain: Fill the foreign leg
 * Note Relayer: State proof of the foreign fill (simulated CLPR)
 * Relayer -> Hedera: Settle the Hedera leg via the allowance
 *
 * [ SIMULATED ]
 * The Arbitrum fill and the CLPR proof are simulated. The allowance, the HCS intent and the Hedera settlement are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Spender: ACCOUNT_1 from .env if set, otherwise a throwaway account (0.5 ℏ) funded by the operator.
 * - Cost: ~1 ℏ (network fees and the accounts it creates).
 *
 * [ HOW TO RUN ]
 * node English/M13_Cross_Ledger_and_Data_Streams/05_cross_chain_intent_settlement_engine.js
 * ============================================================================
 */

import crypto from 'crypto'
import { ethers } from 'ethers'
import {
  AccountId,
  AccountAllowanceApproveTransaction,
  AccountCreateTransaction,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransactionId,
  TransferTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, sleep, updateState, createClient, ensureFunded, createLabAccount, parsePrivateKey } from '../M99_Utilities/index.js'

/**
 * Queries account balance in HBAR using Hedera Mirror Node REST API.
 *
 * @param {string} accountId - Target Account ID
 * @param {string} network - 'testnet' | 'mainnet'
 * @returns {Promise<number>} Balance in HBAR
 */
const queryBalanceNumber = async (accountId, network = 'testnet') => {
  const res = await fetch(`https://${network}.mirrornode.hedera.com/api/v1/accounts/${accountId}`)
  if (!res.ok) return 0
  const data = await res.json()
  return (data.balance?.balance || 0) / 1e8
}

/**
 * Builds an intent commitment adhering to cross-chain solver standards.
 *
 * @param {object} intent - Intent specification
 * @returns {string} Keccak256 commitment hash
 */
const hashIntent = (intent) => {
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(intent)))
}

const main = async () => {
  console.log('╔═══════════════════════════════════════════════════════════════════════╗')
  console.log('║   AUTONOMOUS CROSS-CHAIN INTENT SETTLEMENT ENGINE (CLPR + HIP-336)   ║')
  console.log('╚═══════════════════════════════════════════════════════════════════════╝\n')

  const { client, operatorId, operatorKey, network } = getClient()
  const solverAccountId = AccountId.fromString(operatorId)
  const solverKey = parsePrivateKey(operatorKey)
  // ACCOUNT_1 from .env if set; otherwise a throwaway account funded by the operator
  const relayer = process.env.ACCOUNT_1_ID && process.env.ACCOUNT_1_PRIVATE_KEY
    ? { accountId: AccountId.fromString(process.env.ACCOUNT_1_ID), privateKey: parsePrivateKey(process.env.ACCOUNT_1_PRIVATE_KEY) }
    : await createLabAccount(client, { hbar: 0.5 })
  const relayerAccountId = relayer.accountId
  const relayerKey = relayer.privateKey

  try {
    // 1. Setup Intent Actor Accounts: Trader (0.0000 HBAR), Solver (Sponsor), and Relayer (Spender)
    console.log('[PROCESS] Initializing Cross-Chain Market Actors...')
    const traderKey = PrivateKey.generateED25519()
    const traderCreateTx = await new AccountCreateTransaction()
      .setKeyWithoutAlias(traderKey.publicKey)
      .setInitialBalance(new Hbar(0)) // Strict 0.0000 HBAR gasless Trader!
      .execute(client)

    const traderReceipt = await traderCreateTx.getReceipt(client)
    const traderId = traderReceipt.accountId

    await sleep(3000)
    const initialTraderBal = await queryBalanceNumber(traderId.toString(), network)

    console.log(`[ACTOR] Gasless Trader:   ${traderId.toString()} (Initial Balance: ${initialTraderBal.toFixed(8)} HBAR)`)
    console.log(`[ACTOR] Liquidity Solver: ${operatorId.toString()} (Sponsor & Liquidity Vault)`)
    console.log(`[ACTOR] Settlement Relay: ${relayerAccountId.toString()} (Approved Allowance Spender)`)

    // 2. Sponsor Fee & Settlement Allowance Delegation (HIP-336)
    console.log('\n[PROCESS] Establishing HIP-336 Delegated Settlement Allowance...')
    const settlementAllowance = new Hbar(2)
    await new AccountAllowanceApproveTransaction()
      .approveHbarAllowance(solverAccountId, relayerAccountId, settlementAllowance)
      .execute(client)
    console.log(`[SUCCESS] Solver granted ${settlementAllowance.toString()} allowance to Settlement Relayer (${relayerAccountId.toString()})!`)

    // 3. Define the Cross-Chain Intent (Signed by 0-HBAR Trader)
    const intentNonce = crypto.randomBytes(12).toString('hex')
    const crossChainIntent = {
      intentId: `intent_0x${intentNonce}`,
      sourceLedger: 'hedera:testnet',
      destinationLedger: 'eip155:42161', // Arbitrum One
      traderSourceAddress: traderId.toString(),
      traderDestAddress: '0x8b3017fbca76428d08cb585ebf9fe31e0730b62e',
      sourceCommitment: { asset: 'HBAR', amount: '0.25' },
      targetFill: { asset: 'USDC', amount: '12.50' },
      expiry: Date.now() + 600000,
      protocol: 'CLPR-INTENT-v1'
    }

    const intentDigest = hashIntent(crossChainIntent)
    console.log('\n[ INTENT DECLARED]')
    console.log(`[LOG] Intent ID:       ${crossChainIntent.intentId}`)
    console.log(`[LOG] Route:           ${crossChainIntent.sourceLedger} ➔ ${crossChainIntent.destinationLedger}`)
    console.log(`[LOG] Offer:           ${crossChainIntent.sourceCommitment.amount} ${crossChainIntent.sourceCommitment.asset}`)
    console.log(`[LOG] Expectation:     ${crossChainIntent.targetFill.amount} ${crossChainIntent.targetFill.asset}`)
    console.log(`[LOG] Commitment Hash: ${intentDigest}`)

    // 4. Anchor Intent into Hedera Consensus Stream via Sponsored TransactionId
    console.log('\n[PROCESS] Creating HCS Orderbook Topic (with Trader SubmitKey)...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('INTENT:CLPR:ORDERBOOK')
      .setSubmitKey(traderKey.publicKey)
      .execute(client)
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()

    console.log('[PROCESS] Submitting Trader-signed Intent via Sponsored TransactionId (0 HBAR Trader Gas)...')
    const sponsoredIntentTx = await new TopicMessageSubmitTransaction()
      .setTransactionId(TransactionId.generate(solverAccountId))
      .setTopicId(topicId)
      .setMessage(JSON.stringify(crossChainIntent))
      .freezeWith(client)

    // Co-signed by 0-HBAR Trader (authorizes Topic submitKey) and Solver (pays network fee)
    const traderSignedIntent = await sponsoredIntentTx.sign(traderKey)
    const fullySignedIntent = await traderSignedIntent.sign(solverKey)
    const submitIntentResponse = await fullySignedIntent.execute(client)
    const submitReceipt = await submitIntentResponse.getReceipt(client)
    const consensusSequence = submitReceipt.topicSequenceNumber.toString()
    console.log(`[SUCCESS] Intent Anchored at Consensus Sequence #${consensusSequence} on Topic ${topicId}`)

    // 5. [ARCHITECTURAL SIMULATION] Solver Fills Intent on Arbitrum & Generates CLPR Proof (HIP-1535)
    console.log('\n[ SOLVER EXECUTION] [ARCHITECTURAL SIMULATION] Liquidity solver fills order on Arbitrum...')
    const solverFillTxHash = '0x' + crypto.randomBytes(32).toString('hex')
    console.log(`[SUCCESS] Simulated Destination Fill on Arbitrum! TxHash: ${solverFillTxHash}`)

    console.log('\n[PROCESS] [ARCHITECTURAL SIMULATION] Generating CLPR State Proof (HIP-1535)...')
    const tssValidators = [
      ethers.Wallet.createRandom(),
      ethers.Wallet.createRandom(),
      ethers.Wallet.createRandom()
    ]

    const settlementPayload = ethers.solidityPackedKeccak256(
      ['bytes32', 'bytes32', 'uint64'],
      [intentDigest, solverFillTxHash, Number(consensusSequence)]
    )

    const tssSignatures = tssValidators.map(v => ({
      validator: v.address,
      sig: v.signingKey.sign(settlementPayload).serialized
    }))

    console.log('[SUCCESS] CLPR Settlement Proof Assembled:')
    console.log(`[LOG] Proof Digest:   ${settlementPayload}`)
    // Each signature is checked by recovering its signer from the digest.
    const verifiedSignatures = tssSignatures.filter(({ validator, sig }) => ethers.recoverAddress(settlementPayload, sig) === validator).length
    if (verifiedSignatures < 3) throw new Error(`Only ${verifiedSignatures}/3 council signatures verified`)
    console.log(`[LOG] TSS Quorum:     ${verifiedSignatures}/3 council signatures verified (simulated council keys)`)

    // 6. Live Delegated Allowance Settlement on Hedera Testnet
    console.log('\n[PROCESS] Relayer settling Hedera leg via Approved Allowance (`addApprovedHbarTransfer`)...')
    // ACCOUNT_1 pays the fees of its own transactions here; keep it funded.
    await ensureFunded(client, relayerAccountId, 1)
    const relayerClient = createClient()
    relayerClient.setOperator(relayerAccountId, relayerKey)

    const settlementTx = await new TransferTransaction()
      .addApprovedHbarTransfer(solverAccountId, new Hbar(-0.25)) // Pulled from Solver's approved allowance
      .addHbarTransfer(traderId, new Hbar(0.25)) // Credited to Trader on Hedera
      .setTransactionMemo(`CLPR:RESOLVE:${crossChainIntent.intentId}`)
      .execute(relayerClient)
    await settlementTx.getReceipt(relayerClient)
    relayerClient.close()

    console.log(`[SUCCESS] Cross-Chain Settlement Finalized on Hedera! Tx: ${settlementTx.transactionId.toString()}`)

    // 7. Post-Execution Telemetry Dashboard (Measured Dynamically from Mirror Node)
    await sleep(3500)
    const finalTraderBalNum = await queryBalanceNumber(traderId.toString(), network)
    const finalSolverBalNum = await queryBalanceNumber(operatorId.toString(), network)
    const traderGasSpent = Math.max(0, initialTraderBal - Math.max(0, finalTraderBalNum - 0.25))

    console.log('\n┌────────────────────────────────────────────────────────────────────────┐')
    console.log('│                   CROSS-CHAIN INTENT SETTLEMENT AUDIT                  │')
    console.log('├────────────────────────────────────────────────────────────────────────┤')
    console.log('│ Intent Status:          SETTLED ON HEDERA (Arbitrum leg simulated)     │')
    console.log('│ Proof:                  CLPR-style TSS proof (simulated council)       │')
    console.log('│ Fee Mechanism:          Native Delegated Sponsorship (HIP-336)        │')
    console.log(`│ Destination Fill Tx:    ${solverFillTxHash.slice(0, 22)}... (simulated)│`)
    console.log(`│ Trader Spent Gas:       ${traderGasSpent.toFixed(8)} HBAR ${traderGasSpent === 0 ? '(100% sponsored)' : '(not fully sponsored)'}               │`)
    console.log(`│ Trader Final Balance:   ${(finalTraderBalNum.toFixed(4) + 'HBAR').padEnd(30)} │`)
    console.log(`│ Solver Final Balance:   ${(finalSolverBalNum.toFixed(4) + 'HBAR').padEnd(30)} │`)
    console.log('└────────────────────────────────────────────────────────────────────────┘')

    // Persist state
    updateState('CLPR_ENGINE_INTENT_ID', crossChainIntent.intentId)
    updateState('CLPR_ENGINE_PROOF_DIGEST', settlementPayload)
    updateState('CLPR_ENGINE_SOLVER_TX', solverFillTxHash)

    console.log('\n KEY CONCEPT:')
    console.log('By fusing CLPR (HIP-1535) state proofs with HIP-336 allowances and payer-sponsored fees,')
    console.log('Hedera becomes the highest-throughput, lowest-friction settlement hub in Web3.')
    console.log('Zero bridge honeypots, zero gas barriers, finality in seconds.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Modern cross-chain applications should never force end users to acquire gas')
    console.log('tokens on multiple networks. Hedera abstracts the chain completely via intents')
    console.log('and native co-signed fee sponsorship.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Intent Settlement Engine Failure:', error.message)
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
