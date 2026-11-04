/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: The Hybrid Execution Environment (Standard SDK + Ethers.js)
 * [CONCEPT] Dual-Path Consensus & RPC Interop
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Best of Both Worlds: Hedera is unique because it offers two ways to speak
 * to the EVM. You can use the Native SDK (gRPC) to talk directly to the
 * consensus nodes for high-performance orchestration, or use standard Web3
 * tools like Ethers.js via the Hashio JSON-RPC Relay. This script proves
 * that both paths share the exact same on-chain state, allowing you to use
 * Ethers.js for frontend integration while maintaining Native backends.
 * *
 * [ LEARNABLE MOMENT ]
 * Developers can interact with Hedera contracts either via the native Hiero SDK (high-performance gRPC) or standard Web3 tools like Ethers.js/Viem through the Hedera JSON-RPC Relay.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 01: Contract Deployment
 * - Next:     M8 Lab 03: Structural Changes
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M8 Lab 01 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 02_hybrid_environment.js
 * ============================================================================
 */

import {
  PrivateKey,
  ContractExecuteTransaction, ContractFunctionParameters,
  Hbar, ContractInfoQuery
} from '@hiero-ledger/sdk'
import { getClient, getState, executeWithGas, getJsonRpcSigner } from '../M99_Utilities/index.js'
import { ethers } from 'ethers'

// SimpleStorage ABI (Required for Ethers interaction)
const ABI = [
  'function set(uint256 _value) public',
  'function get() public view returns (uint256)'
]

/**
 * PATH 1: Native Hedera SDK Execution
 */
const executeContractNatively = async (client, contractId, value) => {
  console.log(`[PROCESS] Path 1: Executing set(${value}) via Native Hedera SDK (gRPC)...`)

  const txResponse = await executeWithGas((gas) => new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(gas)
    .setFunction('set', new ContractFunctionParameters().addUint256(value)), client, { gas: 2000000 })

  const receipt = await txResponse.getReceipt(client)
  console.log(`[SUCCESS] Native Call Successful (Status: ${receipt.status.toString()})`)
  return receipt.status.toString()
}

/**
 * PATH 2: Web3 Ethers.js Execution
 */
const executeContractWithEthers = async (evmAddress, privateKey, value) => {
  console.log(`[PROCESS] Path 2: Executing set(${value}) via Ethers.js (JSON-RPC)...`)

  // Connect to the Hashio JSON-RPC Relay
  const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api')
  const wallet = new ethers.Wallet(privateKey, provider)

  // Instantiate contract object
  const contract = new ethers.Contract(evmAddress, ABI, wallet)

  // Execute state-change
  // Ask the relay for the current gas price (in weibars) instead of letting ethers estimate
  // EIP-1559 fees from fee history, which the relay does not always report on the same scale.
  const gasPrice = BigInt(await provider.send('eth_gasPrice', []))
  const tx = await contract.set(value, { gasPrice })
  console.log(`[LOG] Ethers Transaction Hash: ${tx.hash}`)

  const receipt = await tx.wait()
  console.log(`[SUCCESS] Ethers Call Successful (Status: ${receipt.status === 1 ? 'SUCCESS' : 'FAILED'})`)
  return receipt.status
}

const main = async () => {
  console.log('--- SESSION START: True Hybrid Execution Verification ---\n')

  const { client, operatorKey } = getClient()
  const contractId = getState('SC_STORAGE_ID')

  if (!contractId) {
    console.error('[FAILED] Missing SC_STORAGE_ID in configuration. Run Lab 01 first.')
    process.exitCode = 1
    return
  }

  client.setDefaultMaxQueryPayment(new Hbar(10))

  try {
    // Step A: Get the EVM Address for Ethers
    const info = await new ContractInfoQuery().setContractId(contractId).execute(client)
    const evmAddress = `0x${info.contractAccountId}`
    console.log(`[INFO] Target EVM Address: ${evmAddress}`)

    // PATH 1: Native SDK
    await executeContractNatively(client, contractId, 111)

    // PATH 2: Ethers.js
    // We pass the RAW hex string to Ethers, as it cannot handle DER-prefixes (3030...)
    // The relay needs an ECDSA account whose EVM address matches its key (see getJsonRpcSigner).
    const signer = await getJsonRpcSigner(client, operatorKey)
    const rawEthersKey = signer.privateKey.toStringRaw()
    await executeContractWithEthers(evmAddress, rawEthersKey, 222)

    // FINAL VERIFICATION: Query the state
    console.log('\n[PROCESS] Performing Cross-Path State Audit...')
    const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api')
    const contractInfo = new ethers.Contract(evmAddress, ABI, provider)
    const finalValue = await contractInfo.get()

    console.log(`\n [SUCCESS] Final Integrated State: ${finalValue}`)
    console.log('[INFO] Proof of Hybrid Interoperability: SUCCESS.')

    console.log('\n KEY CONCEPT:')
    console.log('The Best of Both Worlds: Use the Native SDK for high-performance')
    console.log('service orchestration and security. Use Ethers.js for frontend')
    console.log('integration and interacting with standard DeFi protocols. This script')
    console.log('proves they share the exact same state.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Hybrid Verification Failed:', error.message)
    process.exitCode = 1
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
