/**
 * ============================================================================
 * Lab 11: Solidity Autonomous HSS Cron Precompile (0x16b)
 * [CONCEPT] Self-Scheduling Smart Contracts on Hedera Layer 1
 * ============================================================================
 * [ KEY CONCEPT ]
 * In traditional EVM ecosystems (Ethereum, Polygon, Arbitrum), smart contracts
 * are passive. They cannot "wake themselves up" in the future without relying
 * on centralized off-chain bots or expensive keeper networks (Chainlink Automation,
 * Gelato). If a keeper bot runs out of gas or goes offline, automated protocols fail.
 *
 * Hedera revolutionizes smart contract automation via the 0x16b HSS Precompile:
 * 1. Native Autonomous Cron: A Solidity smart contract can invoke `0x16b`
 *    (`IHederaScheduleService.scheduleNative`) directly from EVM bytecode.
 * 2. Layer-1 Native Scheduling: The future transaction is submitted to the
 *    Hedera consensus layer as a scheduled transaction with a designated execution window.
 * 3. Zero-Keeper Execution: When the scheduled time or condition arrives, Hedera's
 *    gossip-about-gossip nodes autonomously execute the transaction without any
 *    external bots, servers, or relayers.
 *
 * [ LEARNABLE MOMENT ]
 * Autonomous smart contracts enable true perpetual DeFi: automated yield compounding,
 * recurring subscription renewals, recurring payroll distributions, and liquidation
 * auctions that execute with mathematical certainty on Layer 1.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/evm/hedera-services/system-contracts/schedule-service
 * - https://hips.hedera.com/hip/hip-755
 * - https://hips.hedera.com/hip/hip-1215
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 10: System Contracts Deep-Dive: 0x168 Exchange Rate & 0x16a HAS Precompile
 * - Next:     M9 Lab 01: HCS-1 Static File Storage (Heavy Payloads)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a contract, about 1 USD); <1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M8_Smart_Contracts_EVM/11_solidity_autonomous_hss_cron.js
 * ============================================================================
 */

import fs from 'node:fs'
import {
  ContractId,
  ContractCreateTransaction,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  PrivateKey,
  AccountId
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState, updateState, executeWithGas } from '../M99_Utilities/index.js'
import solc from 'solc'

const compileCronVaultContract = () => {
  console.log('[PROCESS] Compiling 11_solidity_autonomous_hss_cron.sol with solc 0.8.20...')
  const contractPath = new URL('./11_solidity_autonomous_hss_cron.sol', import.meta.url)
  const sourceCode = fs.readFileSync(contractPath, 'utf8')

  const input = {
    language: 'Solidity',
    sources: {
      'AutonomousCronVault.sol': {
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

  const contract = compiled.contracts['AutonomousCronVault.sol'].AutonomousCronVault
  return {
    bytecode: contract.evm.bytecode.object,
    abi: contract.abi
  }
}

const main = async () => {
  console.log('--- SESSION START: Autonomous HSS Cron Precompile (0x16b) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromStringDer(operatorKey)

  try {
    let contractIdStr = getState('AUTONOMOUS_CRON_VAULT_ID')
    let contractId

    if (contractIdStr) {
      contractId = ContractId.fromString(contractIdStr)
      console.log(`[SUCCESS] Reusing deployed AutonomousCronVault Contract ID: ${contractIdStr}`)
    } else {
      const { bytecode } = compileCronVaultContract()
      console.log(`[SUCCESS] Contract Compiled! Bytecode Length: ${bytecode.length} hex chars`)

      console.log('\n[PROCESS] Step 1: Deploying AutonomousCronVault to Hedera EVM...')
      // Deploy the contract: the bytecode goes on-chain and the network returns its contract ID and EVM address.
      const deployTx = await executeWithGas((gas) => new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(gas)
        .setAdminKey(adminKey), client, { gas: 1500000 })

      // Wait for consensus: the receipt says whether the network accepted the transaction.
      const deployReceipt = await deployTx.getReceipt(client)
      contractId = deployReceipt.contractId
      contractIdStr = contractId.toString()
      updateState('AUTONOMOUS_CRON_VAULT_ID', contractIdStr)

      console.log(`[SUCCESS] AutonomousCronVault Deployed at Contract ID: ${contractIdStr}`)
      console.log(`[LOG] EVM Address: 0x${contractId.toEvmAddress()}`)
      console.log(`[EXPLORER] View on HashScan: ${getHashscanUrl(deployTx)}`)
    }

    // 2. Trigger On-Chain Autonomous Heartbeat
    console.log('\n[PROCESS] Step 2: Executing performAutonomousHeartbeat()...')
    // Call the contract: a state-changing call is a transaction and pays gas.
    const heartbeatTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('performAutonomousHeartbeat'), client, { gas: 200000 })

    const heartbeatRecord = await heartbeatTx.getRecord(client)
    console.log(`[SUCCESS] Heartbeat Executed! Status: ${heartbeatRecord.receipt.status.toString()}`)
    console.log(`[LOG] Consensus Tx ID: ${heartbeatTx.transactionId.toString()}`)

    // 3. Schedule Future Execution via 0x16b HSS Precompile
    console.log('\n[PROCESS] Step 3: Triggering scheduleNextHeartbeat() via 0x16b Precompile...')
    const payerEvmAddress = `0x${AccountId.fromString(operatorId).toEvmAddress()}`

    const scheduleCallTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('scheduleNextHeartbeat', new ContractFunctionParameters().addAddress(payerEvmAddress)), client, { gas: 300000 })

    const scheduleRecord = await scheduleCallTx.getRecord(client)
    console.log(`[SUCCESS] Autonomous Cron Task Scheduled! Status: ${scheduleRecord.receipt.status.toString()}`)
    console.log(`[LOG] Scheduling Tx ID:     ${scheduleCallTx.transactionId.toString()}`)
    console.log(`[EXPLORER] View on HashScan: ${getHashscanUrl(scheduleCallTx)}`)

    updateState('AUTONOMOUS_CRON_LAST_TX_ID', scheduleCallTx.transactionId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('0x16b Self-Scheduling Architecture: Smart contracts on Hedera can autonomously')
    console.log('schedule their own recurring operations without external keeper infrastructure.')
    console.log('The scheduled transaction lives on the Layer-1 consensus layer until trigger maturity.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Eliminating Keeper Dependency: By replacing third-party keeper networks with native')
    console.log('HSS precompiles, protocols reduce operational complexity to zero and guarantee execution')
    console.log('even during massive network congestion or off-chain cloud outages.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Autonomous Cron Execution Failure:', error.message)
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
