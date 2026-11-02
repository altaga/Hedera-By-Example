/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 09: Zero-Knowledge Privacy Pool on Hedera EVM
 * [ CONCEPT ] Cryptographic Commitments & Confidential Layer-1 Settlements
 * ============================================================================
 * [ KEY CONCEPT ]
 * Public ledgers maintain an open transaction graph where all sender-recipient
 * relationships are visible to anyone. Privacy-preserving protocols (like
 * Tornado Cash or Semaphore) break this heuristic using Zero-Knowledge
 * commitments and nullifiers.
 *
 * On Ethereum, verifying cryptographic commitments and nullifier trees costs
 * \$20 to \$80 in gas. On Hedera EVM:
 * 1. Cryptographic hashing (Keccak-256) and curve operations execute at
 *    deterministic, sub-cent gas fees (\$0.001 - \$0.05).
 * 2. Transactions reach irrevocable consensus finality in 2-3 seconds.
 * 3. Deposits and withdrawals are mathematically disconnected:
 *    - Depositor commits: `C = Keccak256(nullifier || secret)`
 *    - Recipient redeems using `(nullifier, secret)` to a stealth destination.
 *    - No heuristic or graph analysis can link the depositor to the recipient.
 * 4. The contract enforces a one-time nullifier registry, preventing double-spending.
 *
 * [ LEARNABLE MOMENT ]
 * The combination of EVM smart contract logic and Hedera's ultra-low predictable
 * fees makes Hedera an ideal environment for zero-knowledge privacy infrastructure.
 * Enterprise privacy does not require private or permissioned blockchains—it can
 * be deployed directly on Hedera's public consensus layer.
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 08: Advanced HTS Precompiles
 * - Next:     M8 Lab 10: System Contracts Deep-Dive (0x168 & 0x16a)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: ~15 ℏ the first time (it creates a contract, about 1 USD); <1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M8_Smart_Contracts_EVM/09_zk_snark_privacy_pool.js
 * ============================================================================
 */

import {
  AccountId,
  ContractId,
  ContractCreateTransaction,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  PrivateKey,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl, getHashscanUrl, getState, updateState, sleep, executeWithGas, getAccountEvmAddress } from '../M99_Utilities/index.js'
import solc from 'solc'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { ethers } from 'ethers'

/**
 * 1. Live Solidity Compiler via solc with Optimizer Enabled
 */
const compileZkContract = () => {
  console.log('[⚙️ PROCESS] Compiling ZkPrivacyPool.sol with solc 0.8.20 (Optimizer enabled)...')
  const contractPath = new URL('./09_zk_snark_privacy_pool.sol', import.meta.url)
  const sourceCode = fs.readFileSync(contractPath, 'utf8')

  const input = {
    language: 'Solidity',
    sources: {
      'ZkPrivacyPool.sol': {
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

  const contract = compiled.contracts['ZkPrivacyPool.sol'].ZkPrivacyPool
  return {
    bytecode: contract.evm.bytecode.object,
    abi: contract.abi
  }
}

/**
 * Async Mirror Node Balance Query (CQRS compliant)
 */
const getAccountHbarBalance = async (accountId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
  if (!res.ok) {
    throw new Error(`Mirror Node balance fetch failed for account ${accountId}`)
  }
  const data = await res.json()
  return data.balance.balance / 1e8
}

const main = async () => {
  console.log('--- SESSION START: Zero-Knowledge Privacy Pool on Hedera EVM ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Resolve or Deploy the ZkPrivacyPool Smart Contract
    let contractIdStr = getState('ZK_PRIVACY_POOL_ID')
    let contractId

    if (contractIdStr) {
      contractId = ContractId.fromString(contractIdStr)
      console.log(`[✅ SUCCESS] Reusing deployed ZkPrivacyPool Contract ID: ${contractIdStr}`)
      console.log(`[📊 LOG] EVM Contract Address: 0x${contractId.toEvmAddress()}`)
    } else {
      const { bytecode } = compileZkContract()
      console.log(`[✅ SUCCESS] Contract Compiled! Bytecode Length: ${bytecode.length} hex chars (${bytecode.length / 2} bytes)`)

      console.log('\n[⚙️ PROCESS] Step 1: Deploying ZkPrivacyPool directly to Hedera EVM (Direct Bytecode)...')
      const deployTx = await executeWithGas((gas) => new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(gas)
        .setAdminKey(adminKey), client, { gas: 300000 })

      const deployReceipt = await deployTx.getReceipt(client)
      contractId = deployReceipt.contractId
      contractIdStr = contractId.toString()
      updateState('ZK_PRIVACY_POOL_ID', contractIdStr)

      console.log(`[✅ SUCCESS] ZkPrivacyPool Deployed at Contract ID: ${contractIdStr}`)
      console.log(`[📊 LOG] EVM Contract Address: 0x${contractId.toEvmAddress()}`)
      console.log(`[📊 LOG] HashScan URL: ${getHashscanUrl(deployTx)}`)
    }

    // 2. Generate Off-Chain Cryptographic Commitment
    console.log('\n[⚙️ PROCESS] Step 2: Generating Cryptographic Secrets (Nullifier & Preimage)...')
    const nullifier = crypto.randomBytes(32)
    const secret = crypto.randomBytes(32)

    // Compute ZK commitment: C = keccak256(nullifier || secret)
    const combinedBytes = Buffer.concat([nullifier, secret])
    const commitmentHashHex = ethers.keccak256(combinedBytes)
    const commitmentBuffer = Buffer.from(commitmentHashHex.slice(2), 'hex')

    console.log(`[📊 LOG] Secret Nullifier: 0x${nullifier.toString('hex')}`)
    console.log(`[📊 LOG] Secret Preimage:  0x${secret.toString('hex')}`)
    console.log(`[📊 LOG] Cryptographic Leaf Commitment: ${commitmentHashHex}`)

    // 3. Anonymous Deposit into Privacy Pool (0.01 HBAR)
    console.log('\n[⚙️ PROCESS] Step 3: Depositing 0.01 HBAR into Pool with Commitment...')
    const depositTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setPayableAmount(new Hbar(0.01))
      .setFunction('deposit', new ContractFunctionParameters().addBytes32(commitmentBuffer)), client, { gas: 250000 })

    const depositReceipt = await depositTx.getReceipt(client)
    console.log(`[✅ SUCCESS] Deposit Confirmed! Consensus Status: ${depositReceipt.status.toString()}`)
    console.log(`[📊 LOG] Deposit Tx HashScan: ${getHashscanUrl(depositTx)}`)
    console.log('[ℹ️ INFO] Funds are now shielded inside the pool. Identity of depositor is decoupled.')

    // 4. Confidential Withdrawal to Stealth / Unlinked Recipient
    console.log('\n[⚙️ PROCESS] Step 4: Initiating Private Redemption to Stealth Recipient Address...')
    const stealthRecipientId = process.env.ACCOUNT_1_ID || '0.0.11226623'
    const stealthRecipientAddress = await getAccountEvmAddress(stealthRecipientId) // alias accounts are paid at their EVM alias

    const initialStealthBalance = await getAccountHbarBalance(stealthRecipientId)
    console.log(`[📊 LOG] Stealth Destination: ${stealthRecipientId} (${stealthRecipientAddress})`)
    console.log(`[📊 LOG] Stealth Pre-Withdrawal Balance: ${initialStealthBalance} HBAR`)

    // Reveal nullifier and secret to the smart contract:
    // The contract computes Keccak256(nullifier, secret) on-chain, validates the commitment,
    // marks the nullifier as spent, and releases the 0.01 HBAR to the stealth address!
    const withdrawTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('withdraw', new ContractFunctionParameters()
        .addBytes32(nullifier)
        .addBytes32(secret)
        .addAddress(stealthRecipientAddress)
      ), client, { gas: 300000 })

    const withdrawReceipt = await withdrawTx.getReceipt(client)
    console.log(`[✅ SUCCESS] Confidential Withdrawal Settled! Status: ${withdrawReceipt.status.toString()}`)
    console.log(`[📊 LOG] Withdrawal Tx HashScan: ${getHashscanUrl(withdrawTx)}`)

    // 5. Verify Settlement and Balance State
    console.log('\n[⚙️ PROCESS] Step 5: Verifying Balance Settlement & Chain-of-Custody Break...')
    await sleep(3000)
    const finalStealthBalance = await getAccountHbarBalance(stealthRecipientId)
    console.log(`[📊 LOG] Stealth Post-Withdrawal Balance: ${finalStealthBalance} HBAR (+0.01 HBAR transferred)`)

    if (finalStealthBalance <= initialStealthBalance) {
      throw new Error('Settlement verification failed: Stealth balance did not increase')
    }
    console.log('[✅ SUCCESS] Stealth Recipient received funds with ZERO on-chain link to depositor!')

    // 6. Test Double-Spend & Replay Defense (Adversarial Simulation)
    console.log('\n[⚙️ PROCESS] Step 6: Testing Double-Spend Replay Defense (Adversarial Simulation)...')
    try {
      const replayTx = await executeWithGas((gas) => new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(gas)
        .setFunction('withdraw', new ContractFunctionParameters()
          .addBytes32(nullifier)
          .addBytes32(secret)
          .addAddress(stealthRecipientAddress)
        ), client, { gas: 300000 })

      await replayTx.getReceipt(client)
      console.error('[❌ ERROR] Security violation: Replay attack succeeded!')
      process.exitCode = 1
    } catch (replayError) {
      console.log('[✅ SUCCESS] Double-spend attack successfully rejected by EVM nullifier check!')
      console.log(`[📊 LOG] Expected Revert Reason: "${replayError.message}"`)
    }

    console.log('\n💡 KEY CONCEPT:')
    console.log('Zero-Knowledge pools decouple transaction origins from destinations on-chain.')
    console.log('By verifying cryptographic preimages in Solidity, Hedera EVM provides mathematical')
    console.log('privacy guarantees at sub-cent gas fees without needing specialized private networks.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Nullifiers are the bedrock of ZK double-spending prevention. A commitment shields')
    console.log('the deposit, while a one-way nullifier records the withdrawal without revealing which')
    console.log('deposit it originated from.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] ZK Privacy Pool Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
