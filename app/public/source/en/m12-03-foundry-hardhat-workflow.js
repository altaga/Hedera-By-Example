/**
 * ============================================================================
 * Lab 03: Foundry & Hardhat Automation Workflows
 * [CONCEPT] Compile with Foundry, Deploy Through the JSON-RPC Relay
 * ============================================================================
 * [ KEY CONCEPT ]
 * You do not need to rewrite Ethereum tooling for Hedera. Point Foundry or Hardhat
 * at the JSON-RPC relay (Hashio, chain ID 296 on testnet) and deploy as usual.
 * This lab does it for real:
 * 1. Writes a minimal Foundry project (foundry.toml + src/Counter.sol) to a temp dir.
 * 2. Runs `forge build` (falls back to solc-js if Foundry is not installed, and says so).
 * 3. Deploys the compiled bytecode through Hashio with ethers and an ECDSA alias signer.
 * 4. Calls `increment()` and reads `count()` back through the relay.
 *
 * [ LEARNABLE MOMENT ]
 * The relay maps EVM signers to Hedera accounts by EVM address, so deployments need an
 * ECDSA account with an EVM alias; ED25519 operators get a helper alias account.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/tutorials/smart-contracts/deploy-a-smart-contract-using-hardhat
 * - https://docs.hedera.com/hedera/tutorials/smart-contracts/foundry
 * - https://github.com/hiero-ledger/hiero-json-rpc-relay
 *
 * [ LEARNING PATH ]
 * - Previous: M12 Lab 02: JSON-RPC Relay via Ethers.js
 * - Next:     M12 Lab 04: Scaffold-HBAR Full-Stack Architecture (Intro)
 *
 * [SIMULATED]
 * The Hardhat config is printed but Hardhat itself is not run. Foundry compiles (or solc-js when Foundry is missing) and the deployment and calls are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (funds an ECDSA alias signer if the operator has none).
 * - Tools: Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`) — optional.
 * - Cost: ~5 ℏ (relay contract deployment gas; the signer is topped up to 5 ℏ).
 *
 * [ HOW TO RUN ]
 * node English/M12_Modern_EVM_Tooling/03_foundry_hardhat_workflow.js
 * ============================================================================
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ethers } from 'ethers'
import { getClient, getJsonRpcSigner, getJsonRpcUrl, updateState } from '../M99_Utilities/index.js'

const COUNTER_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Counter {
    uint256 public count;
    event Incremented(uint256 newCount);

    function increment() external {
        count += 1;
        emit Incremented(count);
    }
}
`

const FOUNDRY_CONFIG_BLUEPRINT = `
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
evm_version = "shanghai"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
hedera_testnet = "https://testnet.hashio.io/api"
hedera_mainnet = "https://mainnet.hashio.io/api"

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
      url: "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: process.env.OPERATOR_PRIVATE_KEY ? [process.env.OPERATOR_PRIVATE_KEY] : []
    },
    hedera_mainnet: {
      url: "https://mainnet.hashio.io/api",
      chainId: 295,
      accounts: process.env.OPERATOR_PRIVATE_KEY ? [process.env.OPERATOR_PRIVATE_KEY] : []
    }
  }
};
export default config;
`

const compile = (dir) => {
  try {
    const version = execFileSync('forge', ['--version'], { encoding: 'utf8' }).split('\n')[0]
    execFileSync('forge', ['build', '--root', dir], { stdio: 'pipe' })
    const out = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'Counter.sol', 'Counter.json'), 'utf8'))
    return { tool: version, abi: out.abi, bytecode: out.bytecode.object }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  // Foundry not installed: compile the same source with solc-js
  return import('solc').then(({ default: solc }) => {
    const input = { language: 'Solidity', sources: { 'Counter.sol': { content: COUNTER_SOL } }, settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } }
    const output = JSON.parse(solc.compile(JSON.stringify(input)))
    const c = output.contracts['Counter.sol'].Counter
    return { tool: `solc-js ${solc.version()} (Foundry not found)`, abi: c.abi, bytecode: c.evm.bytecode.object }
  })
}

const main = async () => {
  console.log('--- SESSION START: Foundry & Hardhat Automation Workflows ---\n')
  const { client, operatorKey } = getClient()

  try {
    // 1. Minimal Foundry project
    console.log('[PROCESS] Step 1: Writing a Foundry project (foundry.toml + src/Counter.sol)...')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbe-foundry-'))
    fs.mkdirSync(path.join(dir, 'src'))
    fs.writeFileSync(path.join(dir, 'foundry.toml'), FOUNDRY_CONFIG_BLUEPRINT.trim() + '\n')
    fs.writeFileSync(path.join(dir, 'src', 'Counter.sol'), COUNTER_SOL)
    console.log(`[LOG] Project: ${dir}`)

    // 2. Compile
    console.log('\n[PROCESS] Step 2: Compiling...')
    const { tool, abi, bytecode } = await compile(dir)
    console.log(`[SUCCESS] Compiled with ${tool} — ${bytecode.replace(/^0x/, '').length / 2} bytes of bytecode`)

    // 3. Deploy through the relay
    const rpcUrl = getJsonRpcUrl()
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    console.log(`\n[PROCESS] Step 3: Deploying through ${rpcUrl} (chain ID ${(await provider.getNetwork()).chainId})...`)
    const signerInfo = await getJsonRpcSigner(client, operatorKey, { minHbar: 5 })
    // NonceManager tracks nonces locally: the relay's nonce view can lag right after a deploy
    const wallet = new ethers.NonceManager(new ethers.Wallet('0x' + signerInfo.privateKey.toStringRaw(), provider))
    // Legacy gasPrice from the relay: ethers' EIP-1559 estimate can land below Hedera's minimum
    const gasPrice = BigInt(await provider.send('eth_gasPrice', []))
    const factory = new ethers.ContractFactory(abi, bytecode, wallet)
    const contract = await factory.deploy({ gasLimit: 400_000, gasPrice })
    const deployTx = contract.deploymentTransaction()
    await contract.waitForDeployment()
    const address = await contract.getAddress()
    console.log(`[SUCCESS] Counter at ${address} — tx ${deployTx.hash}`)
    console.log(`[EXPLORER] https://hashscan.io/testnet/contract/${address}`)

    // 4. Write + read
    console.log('\n[PROCESS] Step 4: increment() then count()...')
    const tx = await contract.increment({ gasLimit: 100_000, gasPrice })
    await tx.wait()
    console.log(`[SUCCESS] increment() — tx ${tx.hash} | count() = ${await contract.count()}`)

    console.log('\n[INFO] The same deploy with the Foundry CLI:')
    console.log(`forge create --rpc-url ${rpcUrl} --private-key <ECDSA key> --broadcast src/Counter.sol:Counter`)
    console.log('\n[INFO] Hardhat config for the same network (not executed here):')
    console.log(HARDHAT_CONFIG_BLUEPRINT.trim())

    updateState('FOUNDRY_COUNTER_ADDRESS', address)

    console.log('\n KEY CONCEPT:')
    console.log('Same Solidity, same tools: only the RPC URL and chain ID change for Hedera.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Foundry workflow failed:', error.message)
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
