/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Advanced USDC Token Interactions (ERC-20)
 * [CONCEPT] High-Value Asset Telemetry
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Precision Rule: When dealing with financial assets, never hardcode
 * decimals. Always query the ledger (Stage 1) to ensure your calculations
 * are 100% accurate. This script demonstrates how to dynamically extract
 * metadata (Decimals, Symbol) and audit allowances for USDC (0.0.429274).
 * It proves that Hedera's EVM is identical to Ethereum's ERC-20 interface,
 * making it the foundation for professional DeFi.
 * *
 * [ LEARNABLE MOMENT ]
 * Native HTS tokens (like Circle USDC on Hedera) are automatically accessible via standard ERC-20 contract interfaces at their derived EVM addresses, enabling seamless drop-in DeFi compatibility.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/evm/development/addresses
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 05: Authorization Protocols
 * - Next:     M8 Lab 07: USDC Association
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: ~2 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 06_erc20_usdc_interaction.js
 * ============================================================================
 */

import {
  AccountId, TokenId,
  ContractExecuteTransaction, ContractFunctionParameters,
  ContractCallQuery, ContractId, TokenAssociateTransaction
} from '@hiero-ledger/sdk'
import { getClient, executeWithGas, withGasRetry, getAccountEvmAddress } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Advanced USDC Ecosystem ---')
  console.log('[INFO] EXECUTION TARGET: ERC-20 COMPATIBILITY\n')

  const { client, operatorId } = getClient()
  const USDC_TOKEN_ID = '0.0.429274'
  // The address the network actually uses for the operator (alias or long-zero).
  // Deriving it from the key only works for accounts created from an EVM address.
  const ownerEVM = await getAccountEvmAddress(operatorId)

  // Spender: Using ACCOUNT_1 to avoid self-approval reverts
  const spenderIdStr = process.env.ACCOUNT_1_ID
  const usdcSolidityAddress = '0x' + TokenId.fromString(USDC_TOKEN_ID).toEvmAddress()

  if (!ownerEVM || !spenderIdStr) {
    console.error('[FAILED] Missing OPERATOR_EVM_ADDRESS or ACCOUNT_1_ID in configuration.')
    process.exitCode = 1
    return
  }

  try {
    // --- STAGE 1: TOKEN FACT SHEET (Metadata) ---
    console.log('[PROCESS] Stage 1: Extracting Token Metadata via ERC-20 interface...')

    const contractId = ContractId.fromString(USDC_TOKEN_ID)

    // Name
    const nameQuery = await withGasRetry((gas) => new ContractCallQuery()
      .setContractId(contractId).setGas(gas)
      .setFunction('name').execute(client), { gas: 100000 })
    const name = nameQuery.getString(0)

    // Symbol
    const symbolQuery = await withGasRetry((gas) => new ContractCallQuery()
      .setContractId(contractId).setGas(gas)
      .setFunction('symbol').execute(client), { gas: 100000 })
    const symbol = symbolQuery.getString(0)

    // Decimals
    const decimalsQuery = await withGasRetry((gas) => new ContractCallQuery()
      .setContractId(contractId).setGas(gas)
      .setFunction('decimals').execute(client), { gas: 100000 })
    const decimals = decimalsQuery.getUint8(0)

    console.log('\n--- TOKEN FACT SHEET ---')
    console.log(`NAME:      ${name}`)
    console.log(`SYMBOL:    ${symbol}`)
    console.log(`DECIMALS:  ${decimals}`)
    console.log(`ADDRESS:   ${usdcSolidityAddress}\n`)

    // The operator must be associated with USDC to hold or approve it. Associating
    // twice returns TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT, which is fine.
    try {
      await (await new TokenAssociateTransaction()
        .setAccountId(operatorId)
        .setTokenIds([TokenId.fromString(USDC_TOKEN_ID)])
        .execute(client)).getReceipt(client)
      console.log('[SUCCESS] Operator associated with USDC.')
    } catch (error) {
      if (!/TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT/.test(error.message)) throw error
    }

    // --- STAGE 2: BALANCE TELEMETRY ---
    console.log('[PROCESS] Stage 2: Fetching live balance telemetry...')
    const balanceTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId).setGas(gas)
      .setFunction('balanceOf', new ContractFunctionParameters().addAddress(ownerEVM)), client, { gas: 1000000 })
    const balanceRec = await balanceTx.getRecord(client)
    const rawBalance = balanceRec.contractFunctionResult.getUint256(0)
    const formattedBalance = Number(rawBalance) / Math.pow(10, decimals)

    console.log(`[LOG] LIVE BALANCE: $${formattedBalance.toFixed(decimals)} ${symbol}`)

    // --- STAGE 3: AUTHORIZATION (The Contract Spend Pattern) ---
    const amountToAuthorize = 1 * Math.pow(10, decimals) // $1.00 USDC
    const spenderSolidity = '0x' + AccountId.fromString(spenderIdStr).toEvmAddress()

    console.log('\n[PROCESS] Stage 3: Securing spender allowance ($1.00)...')
    console.log(`[INFO] Target Spender: ${spenderIdStr} (${spenderSolidity})`)

    try {
      const approveTx = await executeWithGas((gas) => new ContractExecuteTransaction()
        .setContractId(contractId).setGas(gas)
        .setFunction('approve', new ContractFunctionParameters()
          .addAddress(spenderSolidity)
          .addUint256(amountToAuthorize)
        ), client, { gas: 2000000 })
      await approveTx.getReceipt(client)
      console.log('[SUCCESS] Spender authorized successfully.')
    } catch (e) {
      console.log(`\n[WARNING] Authorization Skipped: ${e.message}`)
      console.log('[INFO] Tip: This often happens if the balance is $0.00.')
    }

    // --- STAGE 4: ALLOWANCE AUDIT ---
    console.log('\n[PROCESS] Stage 4: Auditing active ledger-side allowance...')
    const allowanceQuery = await withGasRetry((gas) => new ContractCallQuery()
      .setContractId(contractId).setGas(gas)
      .setFunction('allowance', new ContractFunctionParameters()
        .addAddress(ownerEVM)
        .addAddress(spenderSolidity)
      )
      .execute(client), { gas: 100000 })

    const activeAllowance = Number(allowanceQuery.getUint256(0)) / Math.pow(10, decimals)
    console.log(`[SUCCESS] ACTIVE ALLOWANCE: $${activeAllowance.toFixed(2)} USDC available.`)

    console.log('\n KEY CONCEPT:')
    console.log('The Precision Rule: When dealing with financial assets, never hardcode')
    console.log('decimals. Always query the ledger (Stage 1) to ensure your')
    console.log("calculations are 100% accurate. This script proves that Hedera's EVM")
    console.log("is identical to Ethereum's ERC-20 interface.")

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error(`\n[FAILED] USDC Interaction Failed: ${error.message}`)
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
