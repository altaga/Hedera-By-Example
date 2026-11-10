/**
 * ============================================================================
 * Lab 01: Direct HTS Token ERC-20 Facade (Solidity Execution)
 * [CONCEPT] HIP-218/HIP-376 ERC-20 Facade for HTS Tokens (HIP-719 for associate)
 * ============================================================================
 * [ KEY CONCEPT ]
 * No More 0x167 Boilerplate: Historically, calling an HTS token from Solidity
 * required invoking the Hedera Token Service system contract at 0x167 with
 * specialized ABI encoding. Under HIP-218 (with HIP-376 for approve/allowance), every native HTS token exposes a
 * direct EVM address (derived from its 0.0.X ID). Solidity smart contracts can
 * treat native Hedera tokens as standard IERC20 instances seamlessly.
 * *
 * [ LEARNABLE MOMENT ]
 * You do not need to rewrite your Ethereum smart contracts to use HTS tokens. Standard ERC-20 contract interfaces interact directly with native Hedera Token Service tokens via system precompiles.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/evm/development/addresses
 * - https://hips.hedera.com/hip/hip-218
 * - https://hips.hedera.com/hip/hip-376
 * - https://hips.hedera.com/hip/hip-719
 *
 * [ LEARNING PATH ]
 * - Previous: M11 Lab 08: Corporate Actions & Mass Payout (Asset Tokenization Studio Concepts)
 * - Next:     M12 Lab 02: JSON-RPC Relay with Pure Ethers.js v6
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~30 ℏ the first time (token + contract at ~15 ℏ each on testnet); <1 ℏ when it reuses them.
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
  ContractFunctionParameters,
  ContractExecuteTransaction,
  ContractCallQuery,
  TransferTransaction,
  AccountId
} from '@hiero-ledger/sdk'
import { getClient, updateState, executeWithGas, reuseToken, reuseContract, getJsonRpcUrl } from '../M99_Utilities/index.js'

const compileSolidityContract = (sourcePath) => {
  console.log('[PROCESS] Compiling Solidity smart contract with solc 0.8.20...')
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

// Reads an address's bytecode from the JSON-RPC relay, retrying while a new token reaches it.
const readCode = async (address) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(getJsonRpcUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }) })
      const { result } = await res.json()
      if (result && result !== '0x') return result
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return null
}

const main = async () => {
  console.log('--- SESSION START: Direct HTS Token ERC-20 Facade ---\n')
  const { client, operatorId, network } = getClient()

  try {
    // 1. Create a native HTS fungible token
    console.log('[PROCESS] Provisioning native HTS token...')
    const htsTokenId = await reuseToken('REUSE_M12_01_TOKEN', async () => {
      // Create the token: its keys (admin, supply, KYC, freeze...) decide who can change it later.
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
      // Wait for consensus: the receipt says whether the network accepted the transaction.
      const tokenReceipt = await tokenResponse.getReceipt(client)
      return tokenReceipt.tokenId
    })

    // Derive the deterministic long-zero EVM address
    const tokenEvmAddress = `0x${htsTokenId.toEvmAddress()}`
    console.log(`[SUCCESS] Native HTS Token Created: ${htsTokenId.toString()}`)
    console.log(`[LOG] Deterministic EVM Address: ${tokenEvmAddress}`)

    // The token address holds no Solidity code of its own. Since Release 77 (HIP-1341) eth_getCode returns
    // the delegation indicator 0xef0100 + the HTS system contract address: ERC-20 calls run 0x167's code.
    const tokenCode = await readCode(tokenEvmAddress)
    console.log(`[LOG] eth_getCode(token): ${tokenCode || 'not on the relay yet'}`)
    if (tokenCode?.toLowerCase().startsWith('0xef0100')) {
      console.log(`[INFO] Delegation indicator 0xef0100 -> 0x${tokenCode.slice(8)} (HTS system contract 0x167)`)
    }

    // 2. Compile Solidity Contract
    const currentDir = path.dirname(import.meta.filename)
    const solPath = path.join(currentDir, '01_hts_direct_erc20_facade.sol')
    const { bytecode } = compileSolidityContract(solPath)
    console.log(`[SUCCESS] Contract Compiled. Bytecode Size: ${bytecode.length / 2} bytes`)

    // 3. Deploy Contract to Hedera via ContractCreateFlow
    console.log('\n[PROCESS] Deploying HtsTokenVault smart contract to Hedera Smart Contract Service...')
    const contractParams = new ContractFunctionParameters().addAddress(tokenEvmAddress)

    const contractId = await reuseContract('REUSE_M12_01_CONTRACT_V2', bytecode + tokenEvmAddress, async () => {
      // Deploy the contract: the bytecode goes on-chain and the network returns its contract ID and EVM address.
      const contractDeployTx = await executeWithGas((gas) => new ContractCreateFlow()
        .setBytecode(bytecode)
        .setGas(gas)
        .setMaxAutomaticTokenAssociations(1)
        .setConstructorParameters(contractParams), client, { gas: 1500000 })

      const contractReceipt = await contractDeployTx.getReceipt(client)
      return contractReceipt.contractId
    })
    const contractEvmAddress = `0x${contractId.toEvmAddress()}`

    console.log(`[SUCCESS] Contract Deployed to Hedera: ${contractId.toString()}`)
    console.log(`[LOG] Contract EVM Address: ${contractEvmAddress}`)
    console.log(`[EXPLORER] HashScan: ${`https://hashscan.io/testnet/contract/${contractId}`}`)

    // 4. Real ERC-20 facade calls (HIP-218): fund the vault, read balanceOf via the contract, pay out with transfer()
    const readVault = async () => (await new ContractCallQuery().setContractId(contractId).setGas(100000)
      .setFunction('getVaultBalance').execute(client)).getUint256(0).toString()
    await (await new TransferTransaction()
      .addTokenTransfer(htsTokenId, operatorId, -100)
      .addTokenTransfer(htsTokenId, contractId.toString(), 100)
      .execute(client)).getReceipt(client)
    console.log(`[SUCCESS] Vault balanceOf after funding 100 units (getVaultBalance): ${await readVault()}`)
    // Pay out to the operator's own EVM address (its alias if it has one, else the long-zero form)
    const acct = await (await fetch(`https://${network === 'mainnet' ? 'mainnet' : 'testnet'}.mirrornode.hedera.com/api/v1/accounts/${operatorId}`)).json()
    const operatorEvm = acct.evm_address || `0x${AccountId.fromString(operatorId.toString()).toEvmAddress()}`
    const payout = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId).setGas(gas)
      .setFunction('payoutYield', new ContractFunctionParameters().addAddress(operatorEvm).addUint256(40)), client, { gas: 200000 })
    await payout.getReceipt(client)
    console.log(`[SUCCESS] payoutYield(operator, 40) tx ${payout.transactionId}`)
    console.log(`[SUCCESS] Vault balanceOf after payout: ${await readVault()}`)
    updateState('FACADE_HTS_TOKEN_ID', htsTokenId.toString())
    updateState('FACADE_HTS_EVM_ADDRESS', tokenEvmAddress)
    updateState('FACADE_CONTRACT_ID', contractId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('HIP-218 eliminates friction for Ethereum smart contract developers.')
    console.log('Your Solidity contracts can integrate directly with existing Hedera Token')
    console.log('Service assets using standard OpenZeppelin IERC20 interfaces.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Direct HTS facade deployment failed:', error.message)
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
