/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Direct HTS Token ERC-20 Facade (Solidity Execution)
 * [ CONCEPT ] HIP-719 Direct Solidity ERC-20 Compatibility
 * ============================================================================
 * [ KEY CONCEPT ]
 * No More 0x167 Boilerplate: Historically, calling an HTS token from Solidity
 * required invoking the Hedera Token Service system contract at 0x167 with
 * specialized ABI encoding. Under HIP-719, every native HTS token exposes a
 * direct EVM address (derived from its 0.0.X ID). Solidity smart contracts can
 * treat native Hedera tokens as standard IERC20 instances seamlessly.
 * *
 * [ LEARNABLE MOMENT ]
 * You do not need to rewrite your Ethereum smart contracts to use HTS tokens. Standard ERC-20 contract interfaces interact directly with native Hedera Token Service tokens via system precompiles.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/tokens/token-evm-addresses
 *
 * [ LEARNING PATH ]
 * - Previous: M11 Lab 07: Institutional ERP Integration Bridge
 * - Next:     M12 Lab 02: JSON-RPC Relay via Ethers.js
 *
 * [ HOW TO RUN ]
 * node English/M12_Modern_EVM_Tooling/01_hts_direct_erc20_facade.js
 * ============================================================================
 */

import fs from 'fs'
import path from 'path'
import solc from 'solc'
import {
  ContractCreateFlow,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  ContractFunctionParameters
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

const compileSolidityContract = (sourcePath) => {
  console.log('[⚙️ PROCESS] Compiling Solidity smart contract with solc 0.8.20...')
  const sourceCode = fs.readFileSync(sourcePath, 'utf8')

  const input = {
    language: 'Solidity',
    sources: {
      'HtsTokenVault.sol': { content: sourceCode }
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode']
        }
      }
    }
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  if (output.errors) {
    const criticalErrors = output.errors.filter(e => e.severity === 'error')
    if (criticalErrors.length > 0) {
      throw new Error(`Solidity compilation failed: ${criticalErrors[0].formattedMessage}`)
    }
  }

  const contract = output.contracts['HtsTokenVault.sol'].HtsTokenVault
  return {
    abi: contract.abi,
    bytecode: contract.evm.bytecode.object
  }
}

const main = async () => {
  console.log('--- SESSION START: Direct HTS Token ERC-20 Facade ---\n')
  const { client, operatorId, network } = getClient()

  try {
    // 1. Create a native HTS fungible token
    console.log('[⚙️ PROCESS] Provisioning native HTS token...')
    const tokenCreateTx = await new TokenCreateTransaction()
      .setTokenName('Vault Collateral Token')
      .setTokenSymbol('VCT')
      .setDecimals(8)
      .setInitialSupply(100000000)
      .setTokenType(TokenType.FungibleCommon)
      .setSupplyType(TokenSupplyType.Infinite)
      .setTreasuryAccountId(operatorId)
      .setAdminKey(client.operatorPublicKey)
      .freezeWith(client)

    const tokenResponse = await tokenCreateTx.execute(client)
    const tokenReceipt = await tokenResponse.getReceipt(client)
    const htsTokenId = tokenReceipt.tokenId

    // Derive deterministic EVM address (HIP-719)
    const tokenEvmAddress = `0x${htsTokenId.toEvmAddress()}`
    console.log(`[✅ SUCCESS] Native HTS Token Created: ${htsTokenId.toString()}`)
    console.log(`[📊 LOG] Deterministic EVM Address: ${tokenEvmAddress}`)

    // 2. Compile Solidity Contract
    const currentDir = path.dirname(import.meta.filename)
    const solPath = path.join(currentDir, '01_hts_direct_erc20_facade.sol')
    const { bytecode, abi } = compileSolidityContract(solPath)
    console.log(`[✅ SUCCESS] Contract Compiled. Bytecode Size: ${bytecode.length / 2} bytes`)

    // 3. Deploy Contract to Hedera via ContractCreateFlow
    console.log('\n[⚙️ PROCESS] Deploying HtsTokenVault smart contract to Hedera Smart Contract Service...')
    const contractParams = new ContractFunctionParameters().addAddress(tokenEvmAddress)

    const contractDeployTx = await new ContractCreateFlow()
      .setBytecode(bytecode)
      .setGas(300000)
      .setConstructorParameters(contractParams)
      .execute(client)

    const contractReceipt = await contractDeployTx.getReceipt(client)
    const contractId = contractReceipt.contractId
    const contractEvmAddress = `0x${contractId.toEvmAddress()}`

    console.log(`[✅ SUCCESS] Contract Deployed to Hedera: ${contractId.toString()}`)
    console.log(`[📊 LOG] Contract EVM Address: ${contractEvmAddress}`)
    console.log(`[🔗 EXPLORER] HashScan: ${getHashscanUrl(contractDeployTx)}`)

    updateState('FACADE_HTS_TOKEN_ID', htsTokenId.toString())
    updateState('FACADE_HTS_EVM_ADDRESS', tokenEvmAddress)
    updateState('FACADE_CONTRACT_ID', contractId.toString())

    console.log('\n💡 KEY CONCEPT:')
    console.log('HIP-719 eliminates friction for Ethereum smart contract developers.')
    console.log('Your Solidity contracts can integrate directly with existing Hedera Token')
    console.log('Service assets using standard OpenZeppelin IERC20 interfaces.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Direct HTS facade deployment failed:', error.message)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ ERROR] Execution Failure:', error.message)
    process.exit(1)
  })
}
