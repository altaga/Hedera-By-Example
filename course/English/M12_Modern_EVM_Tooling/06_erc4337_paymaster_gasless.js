/**
 * ============================================================================
 * Lab 06: ERC-4337 Paymaster Architecture & Gasless UserOperations
 * [CONCEPT] Verifying Paymaster Gas Sponsorship on Hedera JSON-RPC Relay
 * ============================================================================
 * [ KEY CONCEPT ]
 * In mainstream web3 onboarding and autonomous AI agent operations, end users
 * and software agents do not have native cryptocurrency (HBAR or ETH) in their
 * newly generated wallets. Forcing users to purchase crypto before their first
 * interaction is one of the biggest onboarding barriers.
 *
 * ERC-4337 Account Abstraction solves this via Paymaster Gas Sponsorship:
 * 1. UserOperation Struct: The user or agent signs a pseudo-transaction struct
 *    containing execution payload, call limits, and sender nonce.
 * 2. Enterprise Paymaster: An institutional sponsor (or promotional dApp)
 *    evaluates the UserOperation against sponsorship policies (e.g. KYC, daily quotas).
 * 3. Paymaster Signature: The Paymaster signs the UserOperation and appends its
 *    address and authorization data to `paymasterAndData`.
 * 4. Zero-Gas Onboarding: The Bundler submits the UserOperation to the EntryPoint
 *    contract on Hedera. The Paymaster pays the gas fees while the user/agent
 *    enjoys completely gasless, seamless onboarding.
 *
 * [ LEARNABLE MOMENT ]
 * Hedera's fees are fixed in USD, so a Paymaster can budget its sponsorship
 * exactly instead of absorbing gas-price spikes. The signatures are what make the
 * scheme safe: the EntryPoint only spends the Paymaster's deposit for a
 * UserOperation the Paymaster itself signed.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://eips.ethereum.org/EIPS/eip-4337
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay
 *
 * [ LEARNING PATH ]
 * - Previous: M12 Lab 05: EIP-7702 Pectra Account Delegation on Hedera JSON-RPC Relay
 * - Next:     M13 Lab 01: Cross-Ledger Protocol (CLPR) & Cryptographic State Proofs (HIP-1535)
 *
 * [ SIMULATED ]
 * No bundler runs and nothing is submitted or charged. The lab builds and signs a real
 * ERC-4337 (v0.6) UserOperation, verifies both signatures the way an EntryPoint would,
 * and asks the Mirror Node whether an EntryPoint contract exists on Hedera testnet.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: none (only a Mirror Node read).
 * - Cost: free (no transactions are sent).
 *
 * [ HOW TO RUN ]
 * node English/M12_Modern_EVM_Tooling/06_erc4337_paymaster_gasless.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { getMirrorNodeBaseUrl, updateState } from '../M99_Utilities/index.js'

/**
 * ERC-4337 Paymaster & UserOperation Packaging Engine
 */
class Erc4337PaymasterEngine {
  constructor (entryPointAddress, chainId = 296) {
    this.entryPoint = entryPointAddress.toLowerCase()
    this.chainId = chainId
  }

  /**
   * Computes the canonical ERC-4337 UserOperation Hash:
   * keccak256(keccak256(pack(userOp)) || entryPoint || chainId)
   */
  getUserOpHash (userOp) {
    const packed = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        'address',
        'uint256',
        'bytes32',
        'bytes32',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
        'bytes32'
      ],
      [
        userOp.sender,
        userOp.nonce,
        ethers.keccak256(userOp.initCode),
        ethers.keccak256(userOp.callData),
        userOp.callGasLimit,
        userOp.verificationGasLimit,
        userOp.preVerificationGas,
        userOp.maxFeePerGas,
        userOp.maxPriorityFeePerGas,
        ethers.keccak256(userOp.paymasterAndData)
      ]
    )

    const userOpDigest = ethers.keccak256(packed)
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'address', 'uint256'],
        [userOpDigest, this.entryPoint, this.chainId]
      )
    )
  }

  /**
   * Signs the sponsorship and builds paymasterAndData (a real Paymaster applies its policy first)
   */
  async sponsorUserOp (paymasterWallet, userOp, validUntil, validAfter) {
    // Pack paymaster validation data: [paymasterAddress(20) || validUntil(6) || validAfter(6)]
    const timeRange = ethers.solidityPacked(
      ['uint48', 'uint48'],
      [validUntil, validAfter]
    )

    // Paymaster hash for signing: keccak256(userOpHash || validUntil || validAfter)
    const baseHash = this.getUserOpHash(userOp)
    const paymasterDigest = ethers.keccak256(
      ethers.solidityPacked(
        ['bytes32', 'uint48', 'uint48'],
        [baseHash, validUntil, validAfter]
      )
    )

    // Sign paymaster digest
    const signingKey = new ethers.SigningKey(paymasterWallet.privateKey)
    const sig = signingKey.sign(paymasterDigest)
    const compactSig = ethers.concat([sig.r, sig.s, ethers.toBeHex(sig.v, 1)])

    // paymasterAndData = paymasterAddress || validUntil || validAfter || signature
    const paymasterAndData = ethers.concat([
      paymasterWallet.address,
      timeRange,
      compactSig
    ])

    return {
      paymasterAndData,
      paymasterDigest,
      validUntil,
      validAfter
    }
  }
}

const main = async () => {
  console.log('--- SESSION START: ERC-4337 Paymaster Gasless Architecture ---\n')

  try {
    const ENTRY_POINT_ADDRESS = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' // Canonical ERC-4337 EntryPoint v0.6 (matches this UserOperation format)
    const engine = new Erc4337PaymasterEngine(ENTRY_POINT_ADDRESS, 296) // Hedera Testnet

    // 1. Provision User Smart Account & Institutional Paymaster Sponsor
    console.log('[PROCESS] Step 1: Provisioning User Smart Account & Institutional Paymaster...')
    const userWallet = ethers.Wallet.createRandom()
    const paymasterWallet = ethers.Wallet.createRandom()

    console.log(`[LOG] User Account (Sender):   ${userWallet.address}`)
    console.log(`[LOG] Paymaster Sponsor:       ${paymasterWallet.address}`)
    console.log(`[LOG] ERC-4337 EntryPoint:     ${ENTRY_POINT_ADDRESS}`)

    // 2. Assemble UserOperation Struct
    console.log('\n[PROCESS] Step 2: Assembling ERC-4337 UserOperation for Gasless Transfer...')
    const sampleCallData = ethers.hexlify(ethers.toUtf8Bytes('demo: gasless call'))

    const userOp = {
      sender: userWallet.address,
      nonce: 0,
      initCode: '0x',
      callData: sampleCallData,
      callGasLimit: 100000,
      verificationGasLimit: 150000,
      preVerificationGas: 50000,
      maxFeePerGas: ethers.parseUnits('20', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
      paymasterAndData: '0x',
      signature: '0x'
    }

    // 3. The Paymaster signs its sponsorship
    console.log('\n[PROCESS] Step 3: The Paymaster signs its sponsorship (with a validity window)...')
    const validUntil = Math.floor(Date.now() / 1000) + 3600 // 1 hour validity
    const validAfter = Math.floor(Date.now() / 1000)

    const sponsorship = await engine.sponsorUserOp(
      paymasterWallet,
      userOp,
      validUntil,
      validAfter
    )

    userOp.paymasterAndData = sponsorship.paymasterAndData
    console.log('[SUCCESS] Paymaster signed the sponsorship (a real one would first apply its own policy: KYC, quotas...).')
    console.log(`[LOG] Paymaster Digest: ${sponsorship.paymasterDigest}`)
    console.log(`[LOG] Sponsorship Window: ${validAfter} ➔ ${validUntil}`)
    console.log(`[LOG] paymasterAndData Length: ${ethers.dataLength(userOp.paymasterAndData)} bytes`)

    // 4. User Signs the Sponsored UserOperation
    console.log('\n[PROCESS] Step 4: User Signs Final UserOperation Hash...')
    const finalUserOpHash = engine.getUserOpHash(userOp)
    const userSigningKey = new ethers.SigningKey(userWallet.privateKey)
    const userSig = userSigningKey.sign(finalUserOpHash)
    userOp.signature = ethers.concat([userSig.r, userSig.s, ethers.toBeHex(userSig.v, 1)])

    console.log('[SUCCESS] UserOperation Cryptographically Sealed!')
    console.log(`[LOG] Final UserOp Hash: ${finalUserOpHash}`)
    console.log(`[LOG] User Signature:   ${userOp.signature.substring(0, 24)}...`)

    // 5. Check it the way the EntryPoint would, then say plainly what is not done here
    console.log('\n[PROCESS] Step 5: Verifying both signatures, as the EntryPoint would...')
    const signer = ethers.recoverAddress(finalUserOpHash, userOp.signature)
    if (signer !== userWallet.address) throw new Error('The UserOperation signature does not match the sender')
    console.log(`[VERIFY] User signature recovers ${signer}: the sender.`)
    const paymasterSignature = ethers.dataSlice(userOp.paymasterAndData, 32) // after address (20) + validUntil (6) + validAfter (6)
    const sponsor = ethers.recoverAddress(sponsorship.paymasterDigest, paymasterSignature)
    if (sponsor !== paymasterWallet.address) throw new Error('The paymaster signature does not match the paymaster')
    console.log(`[VERIFY] Paymaster signature recovers ${sponsor}: the paymaster, valid until ${new Date(validUntil * 1000).toISOString()}.`)

    const entryPoint = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/${ENTRY_POINT_ADDRESS}`)
    console.log(entryPoint.ok
      ? `[LOG] Mirror Node: an EntryPoint contract exists at ${ENTRY_POINT_ADDRESS} on Hedera testnet (${(await entryPoint.json()).contract_id}).`
      : `[LOG] Mirror Node: no contract at ${ENTRY_POINT_ADDRESS} on Hedera testnet (HTTP ${entryPoint.status}); a bundler would need an EntryPoint deployed first.`)
    console.log('[INFO] No bundler runs in this lab, so nothing was submitted or charged. A bundler would send this')
    console.log('UserOperation to the EntryPoint (handleOps), which charges the gas to the Paymaster\'s deposit.')
    updateState('ERC4337_PAYMASTER_ADDRESS', paymasterWallet.address)
    updateState('ERC4337_LAST_USEROP_HASH', finalUserOpHash)

    console.log('\n KEY CONCEPT:')
    console.log('Universal Gasless Web3: Users never have to acquire native tokens or pay network fees.')
    console.log('Enterprise applications, game studios, and AI agent frameworks can absorb all operational')
    console.log('gas costs behind the scenes through ERC-4337 Paymaster sponsorship.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Hedera fees are fixed in USD, so a Paymaster can budget sponsorship exactly. The signatures')
    console.log('you just verified are what stop anyone from spending the Paymaster\'s deposit without consent.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] ERC-4337 Paymaster Failure:', error.message)
    process.exit(1)
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
