/**
 * ============================================================================
 * Lab 02: JSON-RPC Relay with Pure Ethers.js v6
 * [CONCEPT] Standard Ethereum Web3 Interfaces on Hedera
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Ethereum Developer Illusion: You do not need the Hedera SDK to interact
 * with Hedera. Through the JSON-RPC Relay at https://testnet.hashio.io (Chain ID 296),
 * any standard Web3 library—Ethers.js, Web3.js, or Viem—can query balances, read
 * smart contract storage, and broadcast signed raw transactions identically to
 * Ethereum Mainnet or Arbitrum.
 * *
 * [ LEARNABLE MOMENT ]
 * The Hedera JSON-RPC Relay translates Ethereum JSON-RPC calls (eth_call, eth_sendRawTransaction) into high-performance Hedera gRPC consensus transactions under the hood.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://github.com/hiero-ledger/hiero-json-rpc-relay
 *
 * [ LEARNING PATH ]
 * - Previous: M12 Lab 01: Direct HTS Token ERC-20 Facade (Solidity Execution)
 * - Next:     M12 Lab 03: Foundry & Hardhat Automation Workflows
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M12_Modern_EVM_Tooling/02_json_rpc_relay_ethers.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { getClient, getJsonRpcUrl, updateState } from '../M99_Utilities/index.js'

const HEDERA_TESTNET_RPC = getJsonRpcUrl()
const HEDERA_TESTNET_CHAIN_ID = 296

const main = async () => {
  console.log('--- SESSION START: Pure Ethers.js v6 on Hedera JSON-RPC Relay ---\n')
  const { operatorKey } = getClient()

  try {
    // 1. Initialize Standard Ethers v6 JsonRpcProvider
    console.log(`[PROCESS] Connecting to Hedera JSON-RPC Relay: ${HEDERA_TESTNET_RPC}...`)
    const provider = new ethers.JsonRpcProvider(HEDERA_TESTNET_RPC, HEDERA_TESTNET_CHAIN_ID, {
      staticNetwork: true
    })

    // 2. Query Network Block & Gas Parameters
    const network = await provider.getNetwork()
    const blockNumber = await provider.getBlockNumber()
    const feeData = await provider.getFeeData()

    console.log('[SUCCESS] Connected to Network:')
    console.log(`[LOG] Chain ID:          ${network.chainId.toString()} (Hedera Testnet)`)
    console.log(`[LOG] Latest EVM Block:  #${blockNumber}`)
    console.log(`[LOG] Gas Price:         ${ethers.formatUnits(feeData.gasPrice || 0, 'gwei')} Gwei`)

    // 3. Connect Ethereum Signer (Wallet)
    console.log('\n[PROCESS] Initializing Ethers.js Wallet from operator private key...')
    // Normalize private key for ethers (32-byte hex)
    const rawKeyHex = operatorKey.startsWith('0x') ? operatorKey : `0x${operatorKey.slice(-64)}`
    const wallet = new ethers.Wallet(rawKeyHex, provider)

    console.log(`[LOG] Derived EVM Address: ${wallet.address}`)

    // 4. Query Balance using standard eth_getBalance
    console.log('\n[PROCESS] Querying account balance via JSON-RPC eth_getBalance...')
    const balanceWei = await provider.getBalance(wallet.address)
    const balanceHbar = ethers.formatEther(balanceWei)
    console.log(`[SUCCESS] EVM Account Balance: ${balanceHbar} HBAR (Tinybars converted: ${balanceWei.toString()})`)

    // 5. Construct Standard EVM Transaction
    console.log('\n[PROCESS] Simulating standard EVM transaction payload structure...')
    const txPayload = {
      to: wallet.address, // Self-transfer
      value: ethers.parseEther('0.01'),
      chainId: HEDERA_TESTNET_CHAIN_ID,
      gasLimit: 21000,
      gasPrice: feeData.gasPrice
    }

    console.log('[LOG] Standard EIP-155 Transaction Parameters:')
    console.dir({
      to: txPayload.to,
      value: `${ethers.formatEther(txPayload.value)} HBAR`,
      gasLimit: txPayload.gasLimit,
      chainId: txPayload.chainId
    })

    updateState('ETHERS_EVM_ADDRESS', wallet.address)
    updateState('ETHERS_LATEST_BLOCK', blockNumber)

    console.log('\n KEY CONCEPT:')
    console.log('Zero Hedera SDK code was required in this script. Tooling such as MetaMask,')
    console.log('WalletConnect, Hardhat, and Foundry speak standard Ethereum JSON-RPC.')
    console.log('Hashio transparently translates these into native Hedera consensus transactions.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] JSON-RPC Relay interaction failed:', error.message)
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
