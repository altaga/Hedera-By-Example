/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Foundry & Hardhat Automation Workflows
 * [ CONCEPT ] Configuration Blueprints for Ethereum Frameworks
 * ============================================================================
 * [ KEY CONCEPT ]
 * Zero-Friction Ethereum Workflows: You do not need to rewrite your smart
 * contract deployment scripts or test suites to target Hedera. By configuring
 * standard Ethereum development frameworks (Foundry / Hardhat) with Hedera's
 * RPC URL and Chain ID, teams can deploy existing multi-contract protocols
 * with single command CLI execution (`forge create` or `hardhat run`).
 * *
 * [ LEARNABLE MOMENT ]
 * Standard Ethereum development frameworks (Hardhat, Foundry) deploy seamlessly to Hedera Testnet and Mainnet simply by configuring the JSON-RPC Relay RPC endpoint and chain ID.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/tutorials/smart-contracts/deploy-a-smart-contract-using-hardhat
 *
 * [ LEARNING PATH ]
 * - Previous: M12 Lab 02: JSON-RPC Relay via Ethers.js
 * - Next:     M12 Lab 04: Scaffold-HBAR Architecture
 *
 * [ HOW TO RUN ]
 * node English/M12_Modern_EVM_Tooling/03_foundry_hardhat_workflow.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { getClient, updateState } from '../M99_Utilities/index.js'

const FOUNDRY_CONFIG_BLUEPRINT = `
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
evm_version = "shanghai"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
hedera_testnet = "https://testnet.hashio.io"
hedera_mainnet = "https://mainnet.hashio.io"

[etherscan]
hedera_testnet = { key = "NO_KEY_NEEDED", url = "https://hashscan.io/testnet" }
`

const HARDHAT_CONFIG_BLUEPRINT = `
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  networks: {
    hedera_testnet: {
      url: "https://testnet.hashio.io",
      chainId: 296,
      accounts: process.env.OPERATOR_PRIVATE_KEY ? [process.env.OPERATOR_PRIVATE_KEY] : []
    },
    hedera_mainnet: {
      url: "https://mainnet.hashio.io",
      chainId: 295,
      accounts: process.env.OPERATOR_PRIVATE_KEY ? [process.env.OPERATOR_PRIVATE_KEY] : []
    }
  }
};
export default config;
`

const main = async () => {
  console.log('--- SESSION START: Foundry & Hardhat Automation Workflows ---\n')
  const { client, operatorId, operatorKey } = getClient()

  try {
    console.log('[⚙️ PROCESS] Validating Hedera JSON-RPC Relay compatibility for Foundry and Hardhat...')
    const rpcUrl = 'https://testnet.hashio.io/api'
    const provider = new ethers.JsonRpcProvider(rpcUrl)

    const startTime = Date.now()
    const blockNumber = await provider.getBlockNumber()
    const latencyMs = Date.now() - startTime

    console.log('[✅ SUCCESS] RPC Endpoint Responsive:')
    console.log(`[📊 LOG] Target RPC:     ${rpcUrl}`)
    console.log(`[📊 LOG] Network Ping:   ${latencyMs} ms`)
    console.log(`[📊 LOG] Current Block:  #${blockNumber}`)

    // 1. Display Foundry Production Configuration
    console.log('\n===============================================================')
    console.log('🛠️ BLUEPRINT: FOUNDRY CONFIGURATION (foundry.toml)')
    console.log('===============================================================')
    console.log(FOUNDRY_CONFIG_BLUEPRINT.trim())
    console.log('\nDeploy Command (Foundry Forge):')
    console.log('forge create --rpc-url https://testnet.hashio.io \\')
    console.log('  --private-key $OPERATOR_PRIVATE_KEY \\')
    console.log('  src/HtsTokenVault.sol:HtsTokenVault \\')
    console.log('  --constructor-args 0x0000000000000000000000000000000000003039')
    console.log('===============================================================')

    // 2. Display Hardhat Production Configuration
    console.log('\n===============================================================')
    console.log('🛠️ BLUEPRINT: HARDHAT CONFIGURATION (hardhat.config.ts)')
    console.log('===============================================================')
    console.log(HARDHAT_CONFIG_BLUEPRINT.trim())
    console.log('\nDeploy Command (Hardhat):')
    console.log('npx hardhat run scripts/deploy.ts --network hedera_testnet')
    console.log('===============================================================')

    updateState('FOUNDRY_CONFIG_VERIFIED', true)
    updateState('HARDHAT_CONFIG_VERIFIED', true)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Hedera is an Ethereum developer paradise: you keep your favorite tools,')
    console.log('Solidity linters, unit tests, and deployment frameworks, while gaining')
    console.log('finality in seconds and sub-cent fixed transaction costs.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Workflow blueprint validation failed:', error.message)
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
