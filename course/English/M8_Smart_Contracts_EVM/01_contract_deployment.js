/**
 * ============================================================================
 * Lab 01: Smart Contract Deployment (Integrated Compiler)
 * [CONCEPT] EVM Bytecode & Direct Deployment
 * ============================================================================
 * [ KEY CONCEPT ]
 * Direct Bytecode: Unlike some environments that require the SDK to "bundle"
 * your contract, here we are interacting with the ledger at the byte level.
 * This gives you absolute control over the deployment cost and configuration.
 * Hedera is 100% EVM-compatible, meaning you gain the performance and finality
 * of Hashgraph while using industry-standard Solidity code.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Hedera EVM uses the exact same bytecode format as Ethereum, but smart contracts execute with deterministic gas fees converted to tinybars at the on-chain exchange rate, eliminating fee volatility.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/smart-contracts/create-a-smart-contract
 *
 * [ LEARNING PATH ]
 * - Previous: M7 Lab 08: Enterprise Timelock Governance Controller & Security Council Veto
 * - Next:     M8 Lab 02: The Hybrid Execution Environment (Standard SDK + Ethers.js)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a contract, about 1 USD); ~3 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M8_Smart_Contracts_EVM/01_contract_deployment.js
 * ============================================================================
 */

import {
  ContractCallQuery,
  ContractCreateTransaction, ContractExecuteTransaction,
  ContractFunctionParameters, Hbar,
  PrivateKey
} from '@hiero-ledger/sdk'
import solc from 'solc'
import { getClient, updateState, executeWithGas, withGasRetry, reuseContract, getHashscanUrl } from '../M99_Utilities/index.js'

// --- 1. SOLIDITY SOURCE CODE ---
const SOURCE_CODE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleStorage {
    uint256 public value;

    function set(uint256 _value) public {
        value = _value;
    }

    function get() public view returns (uint256) {
        return value;
    }
}
`

// --- 2. COMPILATION HELPER ---
const compileContract = (contractName, source) => {
  console.log(`[PROCESS] Compiling ${contractName}.sol live...`)

  const input = {
    language: 'Solidity',
    sources: {
      [`${contractName}.sol`]: {
        content: source
      }
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['*']
        }
      }
    }
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input)))

  if (output.errors) {
    output.errors.forEach(err => {
      if (err.severity === 'error') throw new Error(err.message)
      console.warn(`[WARNING] ${err.message}`)
    })
  }

  const contract = output.contracts[`${contractName}.sol`][contractName]
  return {
    bytecode: contract.evm.bytecode.object,
    abi: contract.abi
  }
}

const main = async () => {
  console.log('--- SESSION START: Smart Contract Compilation & Deployment ---\n')

  const { client, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)
  client.setDefaultMaxQueryPayment(new Hbar(10))

  try {
    // Step A: Compilation
    const { bytecode } = compileContract('SimpleStorage', SOURCE_CODE)
    console.log(`[SUCCESS] Compiled Successfully! Bytecode Length: ${bytecode.length} chars`)

    // Step B: Direct Bytecode Deployment
    console.log('\n[PROCESS] Deploying to Hedera Consensus Nodes (Direct Bytecode)...')
    const contractId = await reuseContract('REUSE_M8_01_CONTRACT', bytecode, async () => {
      const contractResponse = await executeWithGas((gas) => new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(gas)
        .setAdminKey(adminKey) // Sets the Operator as admin to allow updates (like rent)
        .freezeWith(client), client, { gas: 2000000 })
      const contractReceipt = await contractResponse.getReceipt(client)
      console.log(`[LOG] Deployment tx on HashScan: ${getHashscanUrl(contractResponse)}`)
      return contractReceipt.contractId
    })

    console.log(`\n[SUCCESS] Contract Created: ${contractId}`)
    console.log(`[LOG] Contract on HashScan: https://hashscan.io/testnet/contract/${contractId}`)

    console.log('[INFO] Synchronizing state.json with Contract ID...')
    updateState('SC_STORAGE_ID', contractId.toString())

    // Step C: Interact (Set)
    console.log("\n[PROCESS] Calling 'set(42)' via native HAPI call...")
    const setTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('set', new ContractFunctionParameters().addUint256(42)), client, { gas: 2000000 })
    const setReceipt = await setTx.getReceipt(client)
    console.log(`[LOG] set(42) tx on HashScan: ${getHashscanUrl(setTx)}`)
    console.log(`[SUCCESS] set(42) accepted: ${setReceipt.status.toString()}`)

    // Step D: Query (Get)
    console.log("\n[PROCESS] Querying 'get()' value from on-chain state...")
    const getQuery = await withGasRetry((gas) => new ContractCallQuery()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('get')
      .execute(client), { gas: 2000000 })
    const value = getQuery.getUint256(0)
    console.log(`[LOG] Retrieved Value: ${value}`)

    console.log('\n KEY CONCEPT:')
    console.log('Direct Bytecode: Unlike some environments that require the SDK to')
    console.log('"bundle" your contract, here we are interacting with the ledger at the')
    console.log('byte level. This gives you absolute control over the deployment cost')
    console.log('and configuration.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Deployment Lifecycle Failed:', error.message)
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
