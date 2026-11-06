/**
 * ============================================================================
 * Lab 10: System Contracts Deep-Dive: 0x168 Exchange Rate & 0x16a HAS Precompile
 * [CONCEPT] On-Chain Ledger Oracles & Universal Account Authorization
 * ============================================================================
 * [ KEY CONCEPT ]
 * Most EVM blockchains require off-chain oracle networks (Chainlink, Pyth) to
 * provide asset prices, introducing oracle delays, subscription fees, and
 * multi-signature bridge vulnerabilities.
 *
 * Hedera provides System Precompiles directly inside the EVM kernel:
 * 1. 0x168 (Exchange Rate Precompile): The consensus network itself publishes
 *    the official, governing HBAR/USD exchange rate directly into EVM memory.
 *    Any smart contract can convert between tinycents (USD) and tinybars (HBAR)
 *    in 1 opcode with zero external oracle costs or lag.
 * 2. 0x16a (Hedera Account Service - HAS): Smart contracts can cryptographically
 *    verify account signatures across ALL Hedera key types (ED25519, secp256k1 ECDSA,
 *    and threshold KeyLists) natively via `isAuthorized(address, message, signature)`.
 *
 * [ LEARNABLE MOMENT ]
 * By utilizing Hedera's native 0x168 precompile, decentralized finance protocols
 * (lending markets, algorithmic stablecoins, fee distributors) eliminate external
 * oracle dependencies and eliminate the risk of flash-loan oracle manipulation.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/evm/hedera-services/system-contracts
 * - https://hips.hedera.com/hip/hip-475
 * - https://hips.hedera.com/hip/hip-351
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 09: Zero-Knowledge Privacy Pool on Hedera EVM (Groth16 zk-SNARK)
 * - Next:     M8 Lab 11: Solidity Autonomous HSS Cron Precompile (0x16b)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a contract, about 1 USD); <0.1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M8_Smart_Contracts_EVM/10_system_contracts_exchange_and_has.js
 * ============================================================================
 */

import fs from 'node:fs'
import {
  ContractId,
  ContractCreateTransaction,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState, updateState, executeWithGas } from '../M99_Utilities/index.js'
import solc from 'solc'

const compileSystemContractsFacade = () => {
  console.log('[PROCESS] Compiling 10_system_contracts_exchange_and_has.sol with solc 0.8.20...')
  const contractPath = new URL('./10_system_contracts_exchange_and_has.sol', import.meta.url)
  const sourceCode = fs.readFileSync(contractPath, 'utf8')

  const input = {
    language: 'Solidity',
    sources: {
      'SystemContractsFacade.sol': {
        content: sourceCode
      }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      outputSelection: {
        '*': {
          '*': ['*']
        }
      }
    }
  }

  const compiled = JSON.parse(solc.compile(JSON.stringify(input)))
  if (compiled.errors) {
    const fatal = compiled.errors.filter(e => e.severity === 'error')
    if (fatal.length > 0) {
      throw new Error(`Solidity compilation error: ${fatal[0].formattedMessage}`)
    }
  }

  const contract = compiled.contracts['SystemContractsFacade.sol'].SystemContractsFacade
  return {
    bytecode: contract.evm.bytecode.object,
    abi: contract.abi
  }
}

const main = async () => {
  console.log('--- SESSION START: Hedera EVM System Contracts (0x168 & 0x16a) ---\n')
  const { client, operatorKey } = getClient()
  const adminKey = PrivateKey.fromStringDer(operatorKey)

  try {
    let contractIdStr = getState('SYSTEM_CONTRACTS_FACADE_ID')
    let contractId

    if (contractIdStr) {
      contractId = ContractId.fromString(contractIdStr)
      console.log(`[SUCCESS] Reusing deployed SystemContractsFacade Contract ID: ${contractIdStr}`)
    } else {
      const { bytecode } = compileSystemContractsFacade()
      console.log(`[SUCCESS] Contract Compiled! Bytecode Length: ${bytecode.length} hex chars`)

      console.log('\n[PROCESS] Step 1: Deploying SystemContractsFacade to Hedera EVM...')
      // Deploy the contract: the bytecode goes on-chain and the network returns its contract ID and EVM address.
      const deployTx = await executeWithGas((gas) => new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(gas)
        .setAdminKey(adminKey), client, { gas: 1500000 })

      // Wait for consensus: the receipt says whether the network accepted the transaction.
      const deployReceipt = await deployTx.getReceipt(client)
      contractId = deployReceipt.contractId
      contractIdStr = contractId.toString()
      updateState('SYSTEM_CONTRACTS_FACADE_ID', contractIdStr)

      console.log(`[SUCCESS] SystemContractsFacade Deployed at Contract ID: ${contractIdStr}`)
      console.log(`[LOG] EVM Address: 0x${contractId.toEvmAddress()}`)
      console.log(`[EXPLORER] View on HashScan: ${getHashscanUrl(deployTx)}`)
    }

    // 2. Query On-Chain Exchange Rate Precompile (0x168)
    console.log('\n[PROCESS] Step 2: Inquiring 0x168 Exchange Rate System Precompile directly from EVM...')
    const oneUsdTinycents = 100000000 // 1 USD = 10^8 tinycents

    // Call the contract: a state-changing call is a transaction and pays gas.
    const execTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('getTinybarsForTinycents', new ContractFunctionParameters().addUint256(oneUsdTinycents)), client, { gas: 200000 })

    const record = await execTx.getRecord(client)
    const functionResult = record.contractFunctionResult
    const tinybarsPerDollar = functionResult.getUint256(0)
    const hbarPriceUsd = (1e8 / Number(tinybarsPerDollar)).toFixed(4)

    console.log('[SUCCESS] On-Chain Exchange Rate Query Resolved!')
    console.log(`[LOG] 1 USD ($1.00) in Tinybars: ${tinybarsPerDollar.toString()} tinybars`)
    console.log(`[LOG] Implied Consensus Price:   $${hbarPriceUsd} USD / HBAR`)
    console.log(`[EXPLORER] View on HashScan:     ${getHashscanUrl(execTx)}`)
    console.log('[INFO] Price obtained directly from consensus state in 1 call with zero oracle fees.')

    // 3. Inspect Hedera Account Service (HAS 0x16a) Architecture
    console.log('\n[PROCESS] Step 3: Verifying HAS Precompile (0x16a) Capabilities...')
    console.log('Precompile Address: 0x000000000000000000000000000000000000016a')
    console.log('HIP Specification:  HIP-632 & HIP-906')
    console.log('Feature: Allows EVM contracts to verify signatures of any Hedera account')
    console.log('Supported Formats:  ED25519, secp256k1 ECDSA, and Threshold KeyLists')

    updateState('EXCHANGE_RATE_TINYBARS_PER_USD', tinybarsPerDollar.toString())
    updateState('EXCHANGE_RATE_IMPLIED_PRICE_USD', hbarPriceUsd)

    console.log('\n KEY CONCEPT:')
    console.log('Native Consensus Precompiles: Hedera EVM contracts are directly bridged to')
    console.log('the underlying network state. Contracts can read native asset exchange rates (0x168),')
    console.log('verify multi-curve account signatures (0x16a), and execute native token precompiles (0x167).')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Zero Oracle Exploits: Protocols built with 0x168 are mathematically immune to')
    console.log('manipulation from decentralized exchange spot pool drains, because the exchange rate')
    console.log('is governed by the weighted median of the Hedera Governing Council consensus nodes.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] System Contracts Execution Failure:', error.message)
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
