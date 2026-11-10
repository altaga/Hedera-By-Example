/**
 * ============================================================================
 * Lab 07: BLS12-381 Aggregate Signatures with the Pectra Precompiles
 * [CONCEPT] EIP-2537 on Hedera: One Pairing Check Verifies a Whole Committee
 * ============================================================================
 * [ KEY CONCEPT ]
 * Release 77 brought Ethereum's Pectra EVM changes to Hedera (HIP-1341), including
 * the seven BLS12-381 precompiles of EIP-2537 at 0x0b-0x11. BLS signatures add up:
 * N signers' public keys (G1 points) sum to one key and their signatures (G2 points)
 * sum to one signature, and a single pairing check verifies all of them. This lab
 * signs a real checkpoint (the latest testnet block) with a 3-member committee and
 * verifies the aggregate inside a contract: G1ADD (0x0b) sums the keys, the message
 * is hashed to G2 on-chain (RFC 9380: SHA-256 + MODEXP, then MAP_FP2_TO_G2 0x11 and
 * G2ADD 0x0d), and PAIRING_CHECK (0x0f) checks e(pk, H(m)) == e(g1, sig).
 * *
 * [ LEARNABLE MOMENT ]
 * Aggregation is only safe for keys someone vetted: an attacker who registers a crafted key can make a "signature" for the whole group (a rogue-key attack). Production systems require a proof of possession for every key; here only the contract owner can set the committee.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-1341
 * - https://eips.ethereum.org/EIPS/eip-2537
 * - https://www.rfc-editor.org/rfc/rfc9380
 * - https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-bls-signature-05
 *
 * [ LEARNING PATH ]
 * - Previous: M12 Lab 06: ERC-4337 Paymaster Architecture & Gasless UserOperations
 * - Next:     M13 Lab 01: Cross-Ledger Protocol (CLPR) & Cryptographic State Proofs (HIP-1535)
 *
 * [ SEQUENCE ]
 * Lab -> Mirror Node: Latest block (the checkpoint to sign)
 * Note Lab: 3 committee members sign; keys and signatures are aggregated
 * Lab -> Contract: setCommittee(publicKeys) (owner only)
 * Lab -> Contract: hashToG2(message) (eth_call, compared with the off-chain hash)
 * Lab -> Contract: verifyAggregate(tampered message) (eth_call: false)
 * Lab -> Contract: submitCheckpoint(publicKeys, message, signature)
 * Contract -> Precompiles: G1ADD, SHA256, MODEXP, MAP_FP2_TO_G2, G2ADD, PAIRING_CHECK
 *
 * [ SIMULATED ]
 * The committee members are three keys generated in this script. The checkpoint data, the contract, every precompile call and the recorded checkpoint are real testnet operations.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it deploys the contract and submits the checkpoint).
 * - Cost: ~15 ℏ the first time (contract); about 0.5 ℏ per run after that (two contract calls).
 *
 * [ HOW TO RUN ]
 * node English/M12_Modern_EVM_Tooling/07_bls12381_pectra_precompiles.js
 * ============================================================================
 */

import fs from 'fs'
import solc from 'solc'
import { ethers } from 'ethers'
import { bls12_381 as bls } from '@noble/curves/bls12-381.js'
import { ContractCreateTransaction, ContractExecuteTransaction } from '@hiero-ledger/sdk'
import { getClient, reuseContract, executeWithGas, waitForMirror, getMirrorNodeBaseUrl, getJsonRpcUrl, getHashscanUrl, updateState, show } from '../M99_Utilities/index.js'

const COMMITTEE_SIZE = 3
const verifier = new ethers.Interface([
  'function setCommittee(bytes[] publicKeys)',
  'function committeeHash() view returns (bytes32)',
  'function aggregatePublicKeys(bytes[] publicKeys) view returns (bytes)',
  'function hashToG2(bytes message) view returns (bytes)',
  'function verifyAggregate(bytes[] publicKeys, bytes message, bytes signature) view returns (bool)',
  'function submitCheckpoint(bytes[] publicKeys, bytes message, bytes signature)',
  'function verifiedCount() view returns (uint256)',
  'event CheckpointVerified(bytes32 indexed checkpointHash, uint256 signers)'
])

// EIP-2537 encodings: each field element is 64 bytes (16 zero bytes + 48); Fp2 is c0 then c1.
const fp = (n) => n.toString(16).padStart(128, '0')
const encodeG1 = (point) => { const a = point.toAffine(); return '0x' + fp(a.x) + fp(a.y) }
const encodeG2 = (point) => { const a = point.toAffine(); return '0x' + fp(a.x.c0) + fp(a.x.c1) + fp(a.y.c0) + fp(a.y.c1) }

const compile = () => {
  const source = fs.readFileSync(new URL('./07_bls_checkpoint_verifier.sol', import.meta.url), 'utf8')
  // Pectra (HIP-1341): solc >= 0.8.31 targets prague; the precompiles need no special compiler support.
  const input = { language: 'Solidity', sources: { 'Bls.sol': { content: source } }, settings: { evmVersion: 'prague', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.bytecode.object'] } } } }
  const out = JSON.parse(solc.compile(JSON.stringify(input)))
  const fatal = (out.errors || []).filter((e) => e.severity === 'error')
  if (fatal.length) throw new Error(`Solidity compilation error: ${fatal[0].formattedMessage}`)
  return out.contracts['Bls.sol'].BlsCheckpointVerifier.evm.bytecode.object
}

const main = async () => {
  console.log('--- SESSION START: BLS12-381 Aggregate Signatures (EIP-2537 on Hedera) ---\n')
  const { client } = getClient()
  const provider = new ethers.JsonRpcProvider(getJsonRpcUrl(), 296)
  const view = async (address, fn, args) => verifier.decodeFunctionResult(fn, await provider.call({ to: address, data: verifier.encodeFunctionData(fn, args) }))[0]

  try {
    // 1. The checkpoint: the latest block the Mirror Node knows.
    const block = (await fetch(`${getMirrorNodeBaseUrl()}/api/v1/blocks?limit=1&order=desc`).then((r) => r.json())).blocks[0]
    const checkpoint = `hedera-testnet block ${block.number} ${block.hash}`
    const message = new TextEncoder().encode(checkpoint)
    console.log(`[LOG] Checkpoint: block ${block.number} (${new Date(Number(block.timestamp.to) * 1000).toISOString()}), hash ${block.hash.slice(0, 18)}...`)

    // 2. The committee signs it (min-pk scheme: keys in G1, signatures in G2), and everything is aggregated.
    const scheme = bls.longSignatures
    const secretKeys = Array.from({ length: COMMITTEE_SIZE }, () => bls.utils.randomSecretKey())
    const publicKeys = secretKeys.map((sk) => scheme.getPublicKey(sk))
    const hashed = scheme.hash(message)
    const signatures = secretKeys.map((sk) => scheme.sign(hashed, sk))
    const aggregatePk = scheme.aggregatePublicKeys(publicKeys)
    const aggregateSig = scheme.aggregateSignatures(signatures)
    console.log(`[SUCCESS] ${COMMITTEE_SIZE} members signed; off-chain check of the aggregate: ${scheme.verify(aggregateSig, hashed, aggregatePk)}`)
    const pkBytes = publicKeys.map(encodeG1)
    const sigBytes = encodeG2(aggregateSig)
    show.table(pkBytes.map((pk, i) => ({ member: i + 1, 'public key (G1, 128 bytes)': `${pk.slice(0, 22)}...${pk.slice(-8)}` })))

    // 3. Deploy (or reuse) the verifier and register the committee.
    console.log('\n[PROCESS] Deploying BlsCheckpointVerifier (compiled for prague)...')
    const bytecode = compile()
    const contractId = await reuseContract('REUSE_M12_07_BLS_VERIFIER', bytecode, async () => {
      const res = await executeWithGas((gas) => new ContractCreateTransaction().setBytecode(Buffer.from(bytecode, 'hex')).setGas(gas), client, { gas: 1_500_000 })
      return (await res.getReceipt(client)).contractId
    })
    const address = '0x' + contractId.toEvmAddress()
    console.log(`[SUCCESS] Verifier ${contractId} (${address})`)

    const setCommittee = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunctionParameters(Buffer.from(verifier.encodeFunctionData('setCommittee', [pkBytes]).slice(2), 'hex')), client, { gas: 150_000 })
    console.log(`[SUCCESS] setCommittee (owner only): ${setCommittee.transactionId}`)
    const expectedHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes[]'], [pkBytes]))
    await waitForMirror(async () => (await view(address, 'committeeHash', [])) === expectedHash, { timeoutMs: 30_000 })

    // 4. Free checks with eth_call: the contract's hash-to-curve and aggregate key match noble's.
    const onChainHash = await view(address, 'hashToG2', [message])
    console.log(`[SUCCESS] hashToG2 on-chain equals the RFC 9380 hash computed off-chain: ${onChainHash === encodeG2(hashed)}`)
    const onChainPk = await view(address, 'aggregatePublicKeys', [pkBytes])
    console.log(`[SUCCESS] G1ADD aggregate key equals the off-chain sum: ${onChainPk === encodeG1(aggregatePk)}`)
    const tampered = new TextEncoder().encode(checkpoint.replace(/.$/, (c) => (c === '0' ? '1' : '0')))
    console.log(`[SUCCESS] verifyAggregate with one character changed: ${await view(address, 'verifyAggregate', [pkBytes, tampered, sigBytes])} (rejected)`)

    // 5. The real transaction: the pairing check runs on consensus and the checkpoint is recorded.
    console.log('\n[PROCESS] submitCheckpoint: one pairing check for the whole committee...')
    const submit = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunctionParameters(Buffer.from(verifier.encodeFunctionData('submitCheckpoint', [pkBytes, message, sigBytes]).slice(2), 'hex')), client, { gas: 600_000 })
    const mirrorId = submit.transactionId.toString().replace('@', '-').replace(/\.(\d+)$/, '-$1')
    const result = await waitForMirror(async () => {
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/results/${mirrorId}`)
      return res.ok ? res.json() : null
    })
    const event = result?.logs?.map((log) => { try { return verifier.parseLog(log) } catch (_) { return null } }).find((e) => e?.name === 'CheckpointVerified')
    show.table([{ result: result?.result, 'gas used': result?.gas_used, event: event ? `CheckpointVerified(signers ${event.args.signers})` : '-' }])
    if (result?.result !== 'SUCCESS' || !event) throw new Error('the checkpoint was not recorded')
    console.log(`[SUCCESS] Checkpoint recorded; verified checkpoints so far: ${await view(address, 'verifiedCount', [])}`)
    console.log(`[EXPLORER] ${getHashscanUrl(submit)}`)
    updateState('M12_BLS_LAST_CHECKPOINT', checkpoint)

    console.log('\n KEY CONCEPT:')
    console.log('BLS keys and signatures add up: one pairing check verifies the whole committee.')
    console.log('\n LEARNABLE MOMENT:')
    console.log('Only aggregate keys you vetted (proof of possession), or a rogue key can forge for the group.')
    console.log('\n--- SESSION COMPLETE ---')
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
