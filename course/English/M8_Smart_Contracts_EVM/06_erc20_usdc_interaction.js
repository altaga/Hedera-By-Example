/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Advanced USDC Token Interactions (ERC-20)
 * [ CONCEPT ] High-Value Asset Telemetry
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
 * - https://docs.hedera.com/hedera/core-concepts/tokens/token-evm-addresses
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 05: Authorization Protocols
 * - Next:     M8 Lab 07: USDC Association
 *
 * [ HOW TO RUN ]
 * node 06_erc20_usdc_interaction.js
 * ============================================================================
 */

import {
  AccountId, TokenId,
  ContractExecuteTransaction, ContractFunctionParameters,
  ContractCallQuery, ContractId
} from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Advanced USDC Ecosystem ---')
  console.log('[ℹ️ INFO] EXECUTION TARGET: ERC-20 COMPATIBILITY\n')

  const { client } = getClient()
  const USDC_TOKEN_ID = '0.0.429274'
  const ownerEVM = process.env.OPERATOR_EVM_ADDRESS

  // Spender: Using ACCOUNT_1 to avoid self-approval reverts
  const spenderIdStr = process.env.ACCOUNT_1_ID
  const usdcSolidityAddress = '0x' + TokenId.fromString(USDC_TOKEN_ID).toEvmAddress()

  if (!ownerEVM || !spenderIdStr) {
    console.error('[❌ FAILED] Missing OPERATOR_EVM_ADDRESS or ACCOUNT_1_ID in configuration.')
    return
  }

  try {
    // --- STAGE 1: TOKEN FACT SHEET (Metadata) ---
    console.log('[⚙️ PROCESS] Stage 1: Extracting Token Metadata via ERC-20 interface...')

    const contractId = ContractId.fromString(USDC_TOKEN_ID)

    // Name
    const nameQuery = await new ContractCallQuery()
      .setContractId(contractId).setGas(100000)
      .setFunction('name').execute(client)
    const name = nameQuery.getString(0)

    // Symbol
    const symbolQuery = await new ContractCallQuery()
      .setContractId(contractId).setGas(100000)
      .setFunction('symbol').execute(client)
    const symbol = symbolQuery.getString(0)

    // Decimals
    const decimalsQuery = await new ContractCallQuery()
      .setContractId(contractId).setGas(100000)
      .setFunction('decimals').execute(client)
    const decimals = decimalsQuery.getUint8(0)

    console.log('\n--- TOKEN FACT SHEET ---')
    console.log(`🔹 NAME:      ${name}`)
    console.log(`🔹 SYMBOL:    ${symbol}`)
    console.log(`🔹 DECIMALS:  ${decimals}`)
    console.log(`🔹 ADDRESS:   ${usdcSolidityAddress}\n`)

    // --- STAGE 2: BALANCE TELEMETRY ---
    console.log('[⚙️ PROCESS] Stage 2: Fetching live balance telemetry...')
    const balanceTx = await new ContractExecuteTransaction()
      .setContractId(contractId).setGas(1000000)
      .setFunction('balanceOf', new ContractFunctionParameters().addAddress(ownerEVM))
      .execute(client)
    const balanceRec = await balanceTx.getRecord(client)
    const rawBalance = balanceRec.contractFunctionResult.getUint256(0)
    const formattedBalance = Number(rawBalance) / Math.pow(10, decimals)

    console.log(`[📊 LOG] LIVE BALANCE: $${formattedBalance.toFixed(decimals)} ${symbol}`)

    // --- STAGE 3: AUTHORIZATION (The Contract Spend Pattern) ---
    const amountToAuthorize = 1 * Math.pow(10, decimals) // $1.00 USDC
    const spenderSolidity = '0x' + AccountId.fromString(spenderIdStr).toEvmAddress()

    console.log('\n[⚙️ PROCESS] Stage 3: Securing spender allowance ($1.00)...')
    console.log(`[ℹ️ INFO] Target Spender: ${spenderIdStr} (${spenderSolidity})`)

    try {
      const approveTx = await new ContractExecuteTransaction()
        .setContractId(contractId).setGas(2000000)
        .setFunction('approve', new ContractFunctionParameters()
          .addAddress(spenderSolidity)
          .addUint256(amountToAuthorize)
        )
        .execute(client)
      await approveTx.getReceipt(client)
      console.log('[✅ SUCCESS] Spender authorized successfully.')
    } catch (e) {
      console.log(`\n[WARNING] Authorization Skipped: ${e.message}`)
      console.log('[ℹ️ INFO] Tip: This often happens if the balance is $0.00.')
    }

    // --- STAGE 4: ALLOWANCE AUDIT ---
    console.log('\n[⚙️ PROCESS] Stage 4: Auditing active ledger-side allowance...')
    const allowanceQuery = await new ContractCallQuery()
      .setContractId(contractId).setGas(100000)
      .setFunction('allowance', new ContractFunctionParameters()
        .addAddress(ownerEVM)
        .addAddress(spenderSolidity)
      )
      .execute(client)

    const activeAllowance = Number(allowanceQuery.getUint256(0)) / Math.pow(10, decimals)
    console.log(`[✅ SUCCESS] ACTIVE ALLOWANCE: $${activeAllowance.toFixed(2)} USDC available.`)

    console.log('\n💡 KEY CONCEPT:')
    console.log('The Precision Rule: When dealing with financial assets, never hardcode')
    console.log('decimals. Always query the ledger (Stage 1) to ensure your')
    console.log("calculations are 100% accurate. This script proves that Hedera's EVM")
    console.log("is identical to Ethereum's ERC-20 interface.")

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error(`\n[❌ FAILED] USDC Interaction Failed: ${error.message}`)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ FAILED] Execution Error:', error.message)
    process.exit(1)
  })
}
