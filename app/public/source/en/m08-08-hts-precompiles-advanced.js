/**
 * ============================================================================
 * Lab 08: Advanced HTS Precompiles
 * [CONCEPT] EVM Smart Contracts Controlling Native Assets
 * ============================================================================
 * [ KEY CONCEPT ]
 * Smart Contracts on Hedera can interact with the native Hedera Token Service
 * (HTS) using the 0x167 precompile. This means a Solidity contract can MINT,
 * BURN, or TRANSFER native Hedera tokens at 10,000 TPS speeds, combining EVM
 * programmability with HTS performance.
 * To achieve this, the Smart Contract ID must be set as the Supply Key of the token.
 * *
 * [ LEARNABLE MOMENT ]
 * Invoking advanced precompiles allows Solidity contracts to wipe, freeze, or pause tokens directly from EVM code, giving decentralized governance contracts sovereign control over native token supply.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/system-contracts/hedera-token-service
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 07: USDC Association
 * - Next:     M8 Lab 09: Zero-Knowledge Privacy Pool
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~30 ℏ the first time (it creates a token and a contract, about 2 USD); <0.1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node 08_hts_precompiles_advanced.js
 * ============================================================================
 */

import {
  ContractCreateTransaction,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  TokenCreateTransaction,
  PrivateKey
} from '@hiero-ledger/sdk'
import solc from 'solc'
import fs from 'fs'
import { getClient, executeWithGas, reuseContract, reuseToken } from '../M99_Utilities/index.js'

const compile = (contractName, source) => {
  console.log(`[PROCESS] Compiling ${contractName}.sol...`)
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
  console.log('--- SESSION START: Advanced HTS Precompiles ---\n')

  const { client, operatorKey, operatorId } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    // 1. Compile & Deploy the Smart Contract
    const sourceCode = fs.readFileSync(new URL('./08_hts_precompiles_advanced.sol', import.meta.url), 'utf8')
    const bytecode = compile('AdvancedHTS', sourceCode)

    console.log('[PROCESS] Deploying AdvancedHTS Contract to the EVM...')
    const contractId = await reuseContract('REUSE_M8_08_CONTRACT', bytecode, async () => {
      const contractTx = await executeWithGas((gas) => new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(gas)
        .setAdminKey(adminKey), client, { gas: 1500000 })
      const receipt = await contractTx.getReceipt(client)
      return receipt.contractId
    })
    console.log(`[SUCCESS] Contract deployed with ID: ${contractId.toString()}`)

    // 2. Create an HTS Token and set the Contract as the Supply Key
    console.log('\n[PROCESS] Creating Native Token with Contract as Supply Key...')
    // The token's supply key is this contract: reuse the token only together with it.
    const tokenId = await reuseToken(`REUSE_M8_08_TOKEN_${contractId}`, async () => {
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('Precompile Coin')
        .setTokenSymbol('PRC')
        .setDecimals(2)
        .setInitialSupply(0)
        .setTreasuryAccountId(operatorId)
        // THIS GIVES THE SMART CONTRACT THE POWER TO MINT:
        .setSupplyKey(contractId)
        .freezeWith(client)

      const signTx = await tokenTx.sign(adminKey)
      const submitTx = await signTx.execute(client)
      const tokenReceipt = await submitTx.getReceipt(client)
      return tokenReceipt.tokenId
    })
    console.log(`[SUCCESS] Token created: ${tokenId.toString()}`)

    // 3. Execute the Smart Contract function to MINT tokens natively
    console.log('\n[PROCESS] Calling Smart Contract to Mint 1000 Tokens (0x167 Precompile)...')
    const mintAmount = 1000

    const execTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('mintFungibleToken', new ContractFunctionParameters()
        .addAddress(tokenId.toEvmAddress()) // The Token Address
        .addUint64(mintAmount) // The Amount to Mint
      ), client, { gas: 2000000 })

    const execRecord = await execTx.getRecord(client)

    // The responseCode 22 means SUCCESS in HTS
    const responseCode = Number(execRecord.contractFunctionResult.getInt256(0)) // BigNumber -> number
    console.log(`[LOG] Precompile Response Code: ${responseCode} (22 = SUCCESS)`)

    if (responseCode === 22) {
      console.log('[SUCCESS] Smart Contract successfully minted native tokens!')
    } else {
      console.log('[FAILED] Smart Contract failed to mint tokens.')
    }

    console.log('\n KEY CONCEPT:')
    console.log('By setting a ContractId as a key on a native Hedera entity, you')
    console.log('give that EVM contract direct authorization over base-layer operations,')
    console.log('merging EVM logic with native speeds.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Execution Error:', error.message)
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
