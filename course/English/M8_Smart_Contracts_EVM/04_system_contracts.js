/**
 * ============================================================================
 * Lab 04: The Hedera System Oracle
 * [CONCEPT] Native Precompiles & System Interop
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Native Bridge: Usually, a smart contract is isolated in the EVM.
 * Hedera's System Contracts (0x167, 0x168, 0x169) act as "Native Oracles".
 * They allow your Solidity code to check the real-world HBAR exchange rate,
 * generate secure randomness (entropy), or even associate tokens using the
 * high-performance HTS layer. By using a system contract instead of a
 * third-party oracle, you save on gas and gain the security of the
 * network's own consensus mechanism.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Hedera System Contracts expose native ledger primitives (HTS token minting, transfers, and KYC) to Solidity smart contracts via precompiled contract addresses (0x167), bridging EVM logic with native performance.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/evm/hedera-services/system-contracts
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 03: Structural Differences and Rent Mechanics
 * - Next:     M8 Lab 05: Authorization Protocols and Allowances
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M3 Lab 01 (this lab reads what it saved).
 * - Cost: ~15 ℏ the first time (it creates a contract, about 1 USD); <1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M8_Smart_Contracts_EVM/04_system_contracts.js
 * ============================================================================
 */

import {
  ContractCreateTransaction, ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  ContractInfoQuery,
  PrivateKey, TokenId
} from '@hiero-ledger/sdk'
import solc from 'solc'
import { getClient, updateState, getState, executeWithGas } from '../M99_Utilities/index.js'

// --- 1. THE SYSTEM ORACLE SOURCE ---
const SOURCE_CODE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IExchangeRate {
    function tinycentsToTinybars(uint256 tinycents) external returns (uint256);
}
interface IPrng {
    function getPseudorandomSeed() external returns (bytes32);
}
interface IHederaTokenService {
    function associateTokens(address account, address[] memory tokens) external returns (int64 responseCode);
}

contract SystemOracle {
    address constant RATE_PRECOMPILE = address(0x168);
    address constant PRNG_PRECOMPILE = address(0x169);
    address constant HTS_PRECOMPILE  = address(0x167);

    function getLiveHbarRate(uint256 tinycents) external returns (uint256) {
        return IExchangeRate(RATE_PRECOMPILE).tinycentsToTinybars(tinycents);
    }
    function fetchNetworkEntropy() external returns (bytes32) {
        return IPrng(PRNG_PRECOMPILE).getPseudorandomSeed();
    }
    function associateAsset(address account, address token) external returns (int64) {
        address[] memory tokens = new address[](1);
        tokens[0] = token;
        return IHederaTokenService(HTS_PRECOMPILE).associateTokens(account, tokens);
    }
}
`

const compile = (contractName, source) => {
  console.log(`[PROCESS] Compiling ${contractName}.sol live...`)
  const input = {
    language: 'Solidity',
    sources: { [`${contractName}.sol`]: { content: source } },
    settings: { outputSelection: { '*': { '*': ['*'] } } }
  }
  const compiled = JSON.parse(solc.compile(JSON.stringify(input)))
  const contract = compiled.contracts[`${contractName}.sol`][contractName]
  return contract.evm.bytecode.object
}

const main = async () => {
  console.log('--- SESSION START: Hedera System Oracle Interactions ---\n')

  const { client, operatorKey } = getClient()
  const tokenIdStr = getState('FT_TOKEN_ID')
  const existingId = getState('ORACLE_CONTRACT_ID')

  try {
    let oracleId

    // Step 1: Provisioning / Persistence Check
    if (existingId) {
      console.log(`[INFO] Checking persisted Oracle: ${existingId}`)
      try {
        await new ContractInfoQuery().setContractId(existingId).execute(client)
        oracleId = existingId
        console.log('[SUCCESS] Reusing active Oracle (HBAR optimization).')
      } catch (e) {
        console.log('[INFO] Persisted Oracle inactive. Redeploying...')
      }
    }

    if (!oracleId) {
      const adminKey = PrivateKey.fromString(operatorKey)
      const bytecode = compile('SystemOracle', SOURCE_CODE)
      console.log('[PROCESS] Deploying Native Oracle to EVM runtime...')
      // Deploy the contract: the bytecode goes on-chain and the network returns its contract ID and EVM address.
      const contractTx = await executeWithGas((gas) => new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(gas)
        .setAdminKey(adminKey), client, { gas: 2500000 })

      // Wait for consensus: the receipt says whether the network accepted the transaction.
      const receipt = await contractTx.getReceipt(client)
      oracleId = receipt.contractId.toString()
      console.log(`[SUCCESS] Oracle ID: ${oracleId}`)
      updateState('ORACLE_CONTRACT_ID', oracleId)
    }

    console.log('')

    // Step 2: Market Telemetry (0x168)
    console.log('[PROCESS] Querying Market Rate (0x168 precompile)...')
    // Call the contract: a state-changing call is a transaction and pays gas.
    const rateTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(oracleId).setGas(gas)
      .setFunction('getLiveHbarRate', new ContractFunctionParameters().addUint256(100)), client, { gas: 1000000 })
    const rateRec = await rateTx.getRecord(client)
    console.log(`[LOG] EXCHANGE: 100 tinycents = ${rateRec.contractFunctionResult.getUint256(0)} tinybars`)

    // Step 3: Network Entropy (0x169)
    console.log('[PROCESS] Querying Network Entropy (0x169 precompile)...')
    const prngTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(oracleId).setGas(gas)
      .setFunction('fetchNetworkEntropy'), client, { gas: 1000000 })
    const prngRec = await prngTx.getRecord(client)
    const seed = Buffer.from(prngRec.contractFunctionResult.bytes).toString('hex')
    console.log(`[LOG] ENTROPY: Seed 0x${seed.substring(0, 16)}...`)

    // Step 4: Asset Bridging (0x167)
    if (tokenIdStr) {
      console.log(`\n[PROCESS] Bridging Asset ${tokenIdStr} via HTS Precompile (0x167)...`)
      const htsId = ContractId.fromString(oracleId)
      const htsTx = await executeWithGas((gas) => new ContractExecuteTransaction()
        .setContractId(oracleId).setGas(gas)
        .setFunction('associateAsset', new ContractFunctionParameters()
          .addAddress(htsId.toEvmAddress())
          .addAddress(TokenId.fromString(tokenIdStr).toEvmAddress())
        ), client, { gas: 1000000 })
      await htsTx.getReceipt(client)
      console.log('[SUCCESS] Asset associated successfully with the contract.')
    }

    console.log('\n KEY CONCEPT:')
    console.log('The Native Bridge: By using a system contract instead of a third-party')
    console.log("oracle, you save on gas and gain the security of the network's own")
    console.log('consensus mechanism. This is the "Secret Sauce" of a high-performance')
    console.log('hybrid application.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error(`\n[FAILED] Oracle Lifecycle Failed: ${error.message}`)
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
