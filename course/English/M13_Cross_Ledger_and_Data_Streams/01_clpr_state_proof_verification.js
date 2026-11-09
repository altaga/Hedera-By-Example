/**
 * ============================================================================
 * Lab 01: Cross-Ledger Protocol (CLPR) & Cryptographic State Proofs (HIP-1535)
 * [CONCEPT] Bridgeless Cross-Chain Communication via Cryptographic Inclusion
 * ============================================================================
 * [ KEY CONCEPT ]
 * Bridgeless Interoperability: Conventional cross-chain bridges rely on trusted
 * multi-sig validators holding locked tokens in honey-pot smart contracts.
 * CLPR (Linux Foundation Decentralized Trust / HIP-1535) replaces bridges by
 * utilizing native cryptographic state proofs and Threshold Signature Schemes (TSS).
 * A destination chain (e.g., Ethereum / Polygon) or client directly verifies
 * the Hedera consensus state proof without trusting any intermediary.
 *
 * [ LEARNABLE MOMENT ]
 * Several of the largest exploits in Web3 history (billions of dollars) targeted multi-sig bridges
 * (Ronin, Wormhole, Nomad). With CLPR there is no shared custodial escrow:
 * Hedera's consensus truth is verified mathematically on the destination EVM.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-1535
 * - https://hips.hedera.com/hip/hip-1056
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ LEARNING PATH ]
 * - Previous: M12 Lab 06: ERC-4337 Paymaster Architecture & Gasless UserOperations
 * - Next:     M13 Lab 02: Native Fee Sponsorship & Delegated Allowances (HIP-336)
 *
 * [ SIMULATED ]
 * The TSS council signatures and the HIP-1535 state proof are simulated (the protocol is not live yet). The HCS anchoring is real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M13_Cross_Ledger_and_Data_Streams/01_clpr_state_proof_verification.js
 * ============================================================================
 */

import crypto from 'crypto'
import { ethers } from 'ethers'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Computes a deterministic Keccak-256 Merkle root over a batch of cross-ledger leaves.
 *
 * @param {Array<string>} leaves - Message hashes
 * @returns {string} Merkle state root hex string
 */
const computeMerkleRoot = (leaves) => {
  if (leaves.length === 0) return ethers.ZeroHash
  let currentLayer = leaves.map(l => (l.startsWith('0x') ? l : '0x' + l))

  while (currentLayer.length > 1) {
    const nextLayer = []
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i]
      const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : left
      const combined = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [left, right])
      nextLayer.push(combined)
    }
    currentLayer = nextLayer
  }
  return currentLayer[0]
}

/**
 * [ARCHITECTURAL SIMULATION]
 * Builds a CLPR State Proof packet adhering to the HIP-1535 specification.
 * Note: While the cross-chain intent is anchored live on Hedera Testnet HCS,
 * the council TSS quorum signatures below are simulated locally using deterministic
 * validator keys to illustrate destination EVM verification logic.
 *
 * @param {object} params - Parameters including sequence number, payload, and TSS keys
 * @returns {object} CLPR State Proof packet
 */
const buildCLPRProof = ({ sourceChainId, destinationChainId, sequenceNumber, payload, consensusTimestamp, validatorKeys }) => {
  const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(payload)))
  const stateRoot = computeMerkleRoot([payloadHash, ethers.id(`seq:${sequenceNumber}`)])

  // Construct CLPR message commitment
  const commitment = ethers.solidityPackedKeccak256(
    ['uint256', 'uint256', 'uint64', 'bytes32', 'bytes32', 'string'],
    [sourceChainId, destinationChainId, sequenceNumber, payloadHash, stateRoot, consensusTimestamp]
  )

  // Simulate Threshold Signature Scheme (TSS) quorum (3 of 4 council signers)
  const signatures = validatorKeys.map((key) => {
    const wallet = new ethers.Wallet(key)
    const signature = wallet.signingKey.sign(commitment).serialized
    return {
      signer: wallet.address,
      signature
    }
  })

  return {
    version: '1.0.0-HIP-1535-SIM',
    sourceLedger: `hedera:${sourceChainId}`,
    destinationLedger: `eip155:${destinationChainId}`,
    sequenceNumber,
    consensusTimestamp,
    payload,
    payloadHash,
    stateRoot,
    commitment,
    tssQuorum: {
      threshold: 3,
      totalSigners: validatorKeys.length,
      signatures
    }
  }
}

/**
 * Verifies a CLPR proof against an expected council roster (destination EVM contract logic).
 *
 * @param {object} proof - The CLPR proof packet
 * @param {Array<string>} authorizedRoster - Expected validator EVM addresses
 * @returns {boolean} True if verified against the authorized roster
 */
const verifyCLPRProof = (proof, authorizedRoster) => {
  const { commitment, tssQuorum } = proof
  const rosterSet = new Set(authorizedRoster.map(a => a.toLowerCase()))
  const seenSigners = new Set()
  let validSignatures = 0

  for (const item of tssQuorum.signatures) {
    const recovered = ethers.recoverAddress(commitment, item.signature).toLowerCase()
    if (rosterSet.has(recovered) && !seenSigners.has(recovered)) {
      seenSigners.add(recovered)
      validSignatures++
    }
  }

  return validSignatures >= tssQuorum.threshold
}

const main = async () => {
  console.log('--- SESSION START: CLPR & State Proof Verification (HIP-1535) ---\n')
  const { client, operatorId } = getClient()

  try {
    console.log('[PROCESS] Initializing LIVE on-chain anchor topic for cross-ledger events...')
    // Create the topic: an ordered, timestamped message log; a submit key would restrict who can write.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('CLPR:Cross-Ledger:StateProof:HIP-1535')
      .execute(client)

    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[SUCCESS] CLPR Anchor Topic Created on Testnet: ${topicId}`)

    // Cross-ledger event payload (e.g., token burn on Hedera to unlock on Polygon)
    const crossLedgerPayload = {
      action: 'BURN_AND_UNLOCK',
      senderHedera: operatorId.toString(),
      recipientEVM: '0x71C8360f08Ab14a36214C4aC08d91c7847F8Ec89',
      assetSymbol: 'HBAR_SYNTH',
      amountUnits: '100000000',
      nonce: crypto.randomBytes(8).toString('hex')
    }

    console.log('\n[PROCESS] Submitting cross-chain intent to Hedera Consensus Service...')
    // Publish: consensus gives the message a sequence number and a timestamp everyone agrees on.
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(crossLedgerPayload))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    const consensusSequence = submitReceipt.topicSequenceNumber.toString()
    console.log(`[SUCCESS] Live Consensus Reached! Sequence Number: #${consensusSequence}`)

    // [ARCHITECTURAL SIMULATION] Synthesize validator roster for TSS verification
    console.log('\n[PROCESS] [ARCHITECTURAL SIMULATION] Generating HIP-1535 TSS state proof...')
    // Throwaway validator council keys, new on every run (never hardcode keys).
    const councilPrivateKeys = Array.from({ length: 4 }, () => ethers.Wallet.createRandom().privateKey)
    const authorizedCouncilRoster = councilPrivateKeys.map(k => new ethers.Wallet(k).address)

    const clprProof = buildCLPRProof({
      sourceChainId: 296, // Hedera Testnet
      destinationChainId: 137, // Polygon Mainnet
      sequenceNumber: Number(consensusSequence),
      payload: crossLedgerPayload,
      consensusTimestamp: new Date().toISOString(),
      validatorKeys: councilPrivateKeys
    })

    console.log('[LOG] CLPR State Proof Packet Built:')
    console.log(`[LOG] Protocol:         ${clprProof.version}`)
    console.log(`[LOG] Source Ledger:    ${clprProof.sourceLedger}`)
    console.log(`[LOG] Dest Ledger:      ${clprProof.destinationLedger}`)
    console.log(`[LOG] Merkle StateRoot: ${clprProof.stateRoot}`)
    console.log(`[LOG] State Commitment: ${clprProof.commitment}`)
    console.log(`[LOG] TSS Quorum:       ${clprProof.tssQuorum.signatures.length}/${clprProof.tssQuorum.totalSigners} signatures (Threshold: ${clprProof.tssQuorum.threshold})`)

    console.log('\n[PROCESS] Destination chain verifier checking proof against authorized roster...')
    const isValid = verifyCLPRProof(clprProof, authorizedCouncilRoster)

    if (!isValid) {
      throw new Error('CLPR State Proof verification failed cryptographic threshold!')
    }

    console.log('[SUCCESS] Cryptographic State Proof Verified Against Council Roster!')
    console.log('[INFO] No bridge multisig, custodial relayer, or wrapped token honeypot was required.')

    // Persist state for downstream labs
    updateState('CLPR_TOPIC_ID', topicId)
    updateState('CLPR_SEQUENCE_NUMBER', consensusSequence)
    updateState('CLPR_COMMITMENT_HASH', clprProof.commitment)
    updateState('CLPR_PAYLOAD_HASH', clprProof.payloadHash)

    console.log('\n KEY CONCEPT:')
    console.log('Under HIP-1535 (CLPR), cross-ledger settlements are secured by mathematics,')
    console.log('not centralized escrow bridges. A recipient smart contract on Ethereum or')
    console.log('Polygon verifies the TSS consensus signature directly to release native assets.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Without a custodial escrow there is no pot of locked funds for an attacker to drain:')
    console.log('the destination trusts a signature it can check, not a bridge operator.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] CLPR State Proof Failure:', error.message)
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
