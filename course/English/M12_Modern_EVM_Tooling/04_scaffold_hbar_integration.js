/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Scaffold-HBAR Full-Stack Architecture
 * [ CONCEPT ] Next.js, RainbowKit, Wagmi v2, and Hedera Integration
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Hackathon Super-Weapon: Building a full-stack dApp from scratch during
 * a 36-hour hackathon wastes precious hours on wallet connection modals, RPC
 * providers, and contract artifact syncing. Scaffold-HBAR (npm create scaffold-hbar@latest)
 * delivers a production-ready monorepo with RainbowKit, Wagmi v2, Viem, and
 * Hashio pre-configured out-of-the-box.
 * *
 * [ LEARNABLE MOMENT ]
 * Scaffold-HBAR streamlines full-stack Web3 application development on Hedera, connecting modern React/Next.js frontends with EVM contracts and native HTS token flows out-of-the-box.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://github.com/hashgraph/scaffold-hbar
 *
 * [ LEARNING PATH ]
 * - Previous: M12 Lab 03: Foundry & Hardhat Workflows
 * - Next:     M12 Lab 05: EIP-7702 Pectra Account Delegation
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M12_Modern_EVM_Tooling/04_scaffold_hbar_integration.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { getClient, updateState } from '../M99_Utilities/index.js'

// Standard Viem/Wagmi chain definition for Hedera Testnet
const HEDERA_TESTNET_CHAIN_DEFINITION = {
  id: 296,
  name: 'Hedera Testnet',
  network: 'hedera-testnet',
  nativeCurrency: {
    name: 'HBAR',
    symbol: 'HBAR',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: ['https://testnet.hashio.io/api']
    },
    public: {
      http: ['https://testnet.hashio.io/api']
    }
  },
  blockExplorers: {
    default: {
      name: 'HashScan',
      url: 'https://hashscan.io/testnet'
    }
  },
  testnet: true
}

const main = async () => {
  console.log('--- SESSION START: Scaffold-HBAR Full-Stack Architecture ---\n')
  const { client, operatorId, operatorKey } = getClient()

  try {
    console.log('[⚙️ PROCESS] Initializing Scaffold-HBAR architectural verification...')

    // 1. Validate Wagmi / Viem Chain Parameters
    console.log('\n[⚙️ PROCESS] Validating Wagmi v2 Chain Definition:')
    console.log(`[📊 LOG] Chain ID:           ${HEDERA_TESTNET_CHAIN_DEFINITION.id}`)
    console.log(`[📊 LOG] Network Name:       ${HEDERA_TESTNET_CHAIN_DEFINITION.name}`)
    console.log(`[📊 LOG] Native Currency:    ${HEDERA_TESTNET_CHAIN_DEFINITION.nativeCurrency.symbol} (${HEDERA_TESTNET_CHAIN_DEFINITION.nativeCurrency.decimals} decimals)`)
    console.log(`[📊 LOG] Primary RPC:        ${HEDERA_TESTNET_CHAIN_DEFINITION.rpcUrls.default.http[0]}`)
    console.log(`[📊 LOG] Explorer URL:       ${HEDERA_TESTNET_CHAIN_DEFINITION.blockExplorers.default.url}`)

    // 2. Test Live RPC Connectivity via Viem/Ethers Provider
    const provider = new ethers.JsonRpcProvider(HEDERA_TESTNET_CHAIN_DEFINITION.rpcUrls.default.http[0])
    const blockNumber = await provider.getBlockNumber()
    console.log(`\n[✅ SUCCESS] Scaffold-HBAR RPC Gateway Verified: Latest Block #${blockNumber}`)

    // 3. Display Quickstart Command for Hackathon Participants
    console.log('\n===============================================================')
    console.log('⚡ QUICKSTART: GENERATE FULL-STACK HEDERA DAPP')
    console.log('===============================================================')
    console.log('Run in your terminal:')
    console.log('  npx create-scaffold-hbar@latest')
    console.log('\nWhat this bootstraps out-of-the-box:')
    console.log('  1. packages/nextjs   -> Next.js 14 App Router + TailwindCSS + DaisyUI')
    console.log('  2. packages/hardhat  -> Smart contracts, deployment scripts & typechain')
    console.log('  3. Web3 Connectors  -> MetaMask, Coinbase Wallet, WalletConnect via RainbowKit')
    console.log('  4. Debug Contract UI -> Hot-reloading frontend to read/write smart contracts')
    console.log('===============================================================')

    updateState('SCAFFOLD_HBAR_VERIFIED', true)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Scaffold-HBAR is the ultimate hackathon accelerator. Teams that bootstrap')
    console.log('with Scaffold-HBAR have a fully functioning UI connected to MetaMask and')
    console.log('Hedera Testnet within 5 minutes, allowing them to focus 100% on their core bounty logic.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Scaffold-HBAR diagnostic failed:', error.message)
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
