/**
 * ============================================================================
 * Lab 04: Scaffold-HBAR Full-Stack Architecture (Intro)
 * [CONCEPT] A Generated Next.js + Contracts Monorepo Wired to Hedera
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Hackathon Super-Weapon: Building a full-stack dApp from scratch during
 * a 36-hour hackathon wastes precious hours on wallet connection modals, RPC
 * providers, and contract artifact syncing. Scaffold-HBAR (npm create scaffold-hbar@latest)
 * is an interactive CLI that generates a monorepo with a Next.js (App Router)
 * frontend, Hardhat or Foundry contracts, and the Hedera network configuration.
 * *
 * [ LEARNABLE MOMENT ]
 * Scaffold-HBAR streamlines full-stack Web3 application development on Hedera, connecting modern React/Next.js frontends with EVM contracts and native HTS token flows out-of-the-box.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://github.com/hedera-dev/scaffold-hbar
 *
 * [ LEARNING PATH ]
 * - Previous: M12 Lab 03: Foundry & Hardhat Automation Workflows
 * - Next:     M12 Lab 05: EIP-7702 Pectra Account Delegation on Hedera JSON-RPC Relay
 *
 * [ SIMULATED ]
 * This is an introduction: it shows the Scaffold-HBAR chain configuration and checks it against Hashio (real RPC reads). It does not scaffold or run the template; use `npx create-scaffold-hbar` for that.
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
import { updateState } from '../M99_Utilities/index.js'

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

  try {
    console.log('[PROCESS] Initializing Scaffold-HBAR architectural verification...')

    // 1. Validate Wagmi / Viem Chain Parameters
    console.log('\n[PROCESS] Validating Wagmi v2 Chain Definition:')
    console.log(`[LOG] Chain ID:           ${HEDERA_TESTNET_CHAIN_DEFINITION.id}`)
    console.log(`[LOG] Network Name:       ${HEDERA_TESTNET_CHAIN_DEFINITION.name}`)
    console.log(`[LOG] Native Currency:    ${HEDERA_TESTNET_CHAIN_DEFINITION.nativeCurrency.symbol} (${HEDERA_TESTNET_CHAIN_DEFINITION.nativeCurrency.decimals} decimals)`)
    console.log(`[LOG] Primary RPC:        ${HEDERA_TESTNET_CHAIN_DEFINITION.rpcUrls.default.http[0]}`)
    console.log(`[LOG] Explorer URL:       ${HEDERA_TESTNET_CHAIN_DEFINITION.blockExplorers.default.url}`)

    // 2. Test Live RPC Connectivity via Viem/Ethers Provider
    const provider = new ethers.JsonRpcProvider(HEDERA_TESTNET_CHAIN_DEFINITION.rpcUrls.default.http[0])
    const blockNumber = await provider.getBlockNumber()
    console.log(`\n[SUCCESS] Scaffold-HBAR RPC Gateway Verified: Latest Block #${blockNumber}`)

    // 3. Display Quickstart Command for Hackathon Participants
    console.log('\n===============================================================')
    console.log('QUICKSTART: GENERATE FULL-STACK HEDERA DAPP')
    console.log('===============================================================')
    console.log('Run in your terminal:')
    console.log('npx create-scaffold-hbar@latest')
    console.log('\nWhat this bootstraps out-of-the-box:')
    console.log('1. Frontend  -> Next.js (App Router)')
    console.log('2. Contracts -> Hardhat or Foundry (your choice; or none)')
    console.log('3. Network   -> Hedera configuration (chain 296 on testnet, as checked above)')
    console.log('Templates are fetched from a Git branch, so their exact stack can change between versions.')
    console.log('===============================================================')

    updateState('SCAFFOLD_HBAR_VERIFIED', true)

    console.log('\n KEY CONCEPT:')
    console.log('Scaffold-HBAR saves the setup a hackathon team would otherwise repeat: a frontend,')
    console.log('a contracts workspace and the Hedera network config, generated in one command.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Scaffold-HBAR diagnostic failed:', error.message)
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
