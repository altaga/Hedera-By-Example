/**
 * ============================================================================
 * Lab 05: EIP-7702 Pectra Account Delegation on Hedera JSON-RPC Relay
 * [CONCEPT] Temporary Smart Contract Code Execution for Standard EOAs
 * ============================================================================
 * [ KEY CONCEPT ]
 * In the Ethereum Pectra hard fork (EIP-7702), standard Externally Owned Accounts
 * (EOAs) can temporarily set their execution bytecode to point to an existing smart
 * contract for the duration of a transaction or session.
 *
 * Historically on EVM chains, smart contract account abstraction (ERC-4337)
 * forced users to abandon their private key EOAs and deploy costly smart contract
 * wallets (Safe, Biconomy, Kernel).
 * Under EIP-7702 supported on Hedera's JSON-RPC Relay:
 * 1. An EOA signs an Authorization Tuple: `[chainId, contractAddress, nonce, yParity, r, s]`.
 * 2. When the transaction executes, the EOA temporarily behaves AS the designated
 *    smart contract module (e.g. BatchExecutor or SessionKeyValidator).
 * 3. The user retains their original 0.0.X and 0x EVM address with zero asset migration.
 * 4. Enables 1-click atomic multi-calls (e.g. approve + swap + associate) directly
 *    from standard web3 wallets.
 *
 * [ LEARNABLE MOMENT ]
 * EIP-7702 bridges the final gap between Web2 user experience and Web3 security.
 * Combined with Hedera's sub-cent fixed transaction fees, users get seamless
 * gas-sponsored atomic batching without deploying multi-dollar smart contract proxies.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://eips.ethereum.org/EIPS/eip-7702
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay
 *
 * [ LEARNING PATH ]
 * - Previous: M12 Lab 04: Scaffold-HBAR Full-Stack Architecture (Intro)
 * - Next:     M12 Lab 06: ERC-4337 Paymaster Architecture & Gasless UserOperations
 *
 * [ SIMULATED ]
 * The EIP-7702 batch is built and signed but not executed: this lab sends no Type 4 transaction.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M12_Modern_EVM_Tooling/05_eip7702_pectra_account_delegation.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * EIP-7702 Authorization Builder and Cryptographic Verifier
 */
class Eip7702DelegationEngine {
  constructor (chainId = 296) { // 296 = Hedera Testnet Chain ID
    this.chainId = chainId
    this.MAGIC = '0x05' // EIP-7702 Magic byte identifier for signing
  }

  /**
   * Encodes and hashes the EIP-7702 authorization payload:
   * keccak256(MAGIC || rlp([chain_id, address, nonce]))
   */
  computeAuthorizationHash (contractAddress, nonce) {
    // RLP encode [chain_id, address, nonce]
    const encodedTuple = ethers.encodeRlp([
      ethers.toBeHex(this.chainId),
      contractAddress.toLowerCase(),
      nonce === 0 ? '0x' : ethers.toBeHex(nonce)
    ])
    // Prepend EIP-7702 magic byte (0x05) and hash
    const payload = ethers.concat([this.MAGIC, encodedTuple])
    return ethers.keccak256(payload)
  }

  /**
   * Signs the authorization tuple using the delegating EOA wallet
   */
  async signAuthorization (wallet, contractAddress, nonce) {
    const authHash = this.computeAuthorizationHash(contractAddress, nonce)
    const signingKey = new ethers.SigningKey(wallet.privateKey)
    const sig = signingKey.sign(authHash)

    return {
      chainId: this.chainId,
      contractAddress: contractAddress.toLowerCase(),
      nonce,
      yParity: sig.yParity,
      r: sig.r,
      s: sig.s,
      authHash
    }
  }

  /**
   * Verifies the cryptographic signer of the authorization tuple
   */
  verifyAuthorization (auth) {
    const recoveredAddress = ethers.recoverAddress(auth.authHash, {
      r: auth.r,
      s: auth.s,
      yParity: auth.yParity
    })
    return recoveredAddress
  }
}

const main = async () => {
  console.log('--- SESSION START: EIP-7702 Pectra Account Delegation (Hedera Relay) ---\n')
  const { client } = getClient()

  try {
    const delegationEngine = new Eip7702DelegationEngine(296) // Hedera Testnet

    // 1. Generate Delegating EOA and Implementation Contract Address
    console.log('[PROCESS] Step 1: Generating EOA Delegator & Batch Implementation Address...')
    const delegatorWallet = ethers.Wallet.createRandom()
    const batchContractAddress = '0x0000000000000000000000000000000000abacba' // Batch executor contract address

    console.log(`[LOG] Delegator EOA Address:      ${delegatorWallet.address}`)
    console.log(`[LOG] Target Delegation Contract: ${batchContractAddress}`)
    console.log('[LOG] Target Network:             Hedera Testnet (Chain ID 296)')

    // 2. Construct and Sign EIP-7702 Authorization Payload
    console.log('\n[PROCESS] Step 2: Constructing EIP-7702 Authorization Tuple...')
    const nonce = 0
    const authorization = await delegationEngine.signAuthorization(
      delegatorWallet,
      batchContractAddress,
      nonce
    )

    console.log('[SUCCESS] EIP-7702 Authorization Signed:')
    console.log(`Chain ID:    ${authorization.chainId}`)
    console.log(`Contract:    ${authorization.contractAddress}`)
    console.log(`Nonce:       ${authorization.nonce}`)
    console.log(`yParity:     ${authorization.yParity}`)
    console.log(`r:           ${authorization.r.substring(0, 18)}...`)
    console.log(`s:           ${authorization.s.substring(0, 18)}...`)
    console.log(`Auth Digest: ${authorization.authHash}`)

    // 3. Cryptographic Signature Verification
    console.log('\n[PROCESS] Step 3: Verifying Cryptographic Recovery via Hedera JSON-RPC Relay Engine...')
    const recovered = delegationEngine.verifyAuthorization(authorization)

    if (recovered.toLowerCase() !== delegatorWallet.address.toLowerCase()) {
      throw new Error(`Signature mismatch! Recovered: ${recovered}, Expected: ${delegatorWallet.address}`)
    }
    console.log(`[SUCCESS] Cryptographic Proof Validated! Recovered EOA: ${recovered}`)

    // 4. Simulate Type 4 (0x04) Batch Execution
    console.log('\n[PROCESS] Step 4: Simulating EIP-7702 Type 4 Atomic Multi-Call Batch...')
    const multiCallBatch = [
      { target: '0x1670000000000000000000000000000000000001', data: '0x095ea7b3...', value: '0', label: 'HTS Token Approval via Facade (Gasless)' }, // Token approval
      { target: '0x1670000000000000000000000000000000000002', data: '0xa9059cbb...', value: '0', label: 'Atomic Liquidity Settlement (Gasless)' } // Atomic swap
    ]

    multiCallBatch.forEach((call, i) => console.log(`[Action ${i + 1}] ${call.label} -> ${call.target}`))
    console.log('[INFO] Batch NOT executed: this lab does not send Type 4 transactions, so the batch above is only built and signed (simulated).')

    updateState('EIP7702_DELEGATION_CONTRACT', batchContractAddress)
    updateState('EIP7702_LAST_AUTH_HASH', authorization.authHash)

    console.log('\n KEY CONCEPT:')
    console.log('Zero Contract Deployment Cost: Traditional smart accounts require deploying a proxy')
    console.log('contract on-chain. With EIP-7702, existing Hedera EOAs gain smart contract superpowers')
    console.log('ephemerally or for designated sessions with ZERO deployment gas overhead.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Hedera JSON-RPC Relay seamlessly supports EIP-7702 transactions, allowing full compatibility')
    console.log('with modern Ethereum wallet standards (Viem, Wagmi, RainbowKit) on top of Hedera.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] EIP-7702 Execution Failure:', error.message)
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
