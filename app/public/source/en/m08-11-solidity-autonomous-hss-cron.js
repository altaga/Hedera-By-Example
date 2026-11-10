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
 * Hedera offers smart contract automation via the 0x16b HSS system contract:
 * 1. Self-Scheduling: A Solidity smart contract can invoke `0x16b`
 *    (`IHederaScheduleService.scheduleCall`, HIP-1215) directly from EVM bytecode.
 * 2. Layer-1 Native Scheduling: The future transaction is submitted to the
 *    Hedera consensus layer as a scheduled transaction with a designated execution window.
 * 3. Zero-Keeper Execution: When the scheduled time or condition arrives, Hedera's
 *    gossip-about-gossip nodes autonomously execute the transaction without any
 *    external bots, servers, or relayers.
 *
 * [ LEARNABLE MOMENT ]
 * Each scheduleCall is one future call, paid by the contract itself. Recurring jobs
 * (yield compounding, subscriptions, payroll) come from the scheduled call scheduling
 * the next one, so the contract must keep enough HBAR to pay for them.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/evm/hedera-services/system-contracts/schedule-service
 * - https://hips.hedera.com/hip/hip-755
 * - https://hips.hedera.com/hip/hip-1215
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 10: System Contracts Deep-Dive: 0x168 Exchange Rate & 0x16a HAS Precompile
 * - Next:     M9 Lab 01: Large Payload Anchoring (HCS Chunking)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~16 ℏ the first time (it creates a contract, about 1 USD, and funds it with 1 ℏ for its scheduled calls); <1 ℏ when you run it again (it reuses what it created).
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
  ContractCallQuery,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState, updateState, executeWithGas, sleep, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'
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

const DELAY_SECONDS = 20

const readCounter = async (client, contractId) => {
  const result = await new ContractCallQuery()
    .setContractId(contractId)
    .setGas(50000)
    .setFunction('heartbeatCounter')
    .execute(client)
  return Number(result.getUint256(0))
}

const main = async () => {
  console.log('--- SESSION START: Autonomous HSS Cron Precompile (0x16b) ---\n')
  const { client } = getClient()

  try {
    let contractIdStr = getState('AUTONOMOUS_CRON_VAULT_V3_ID')
    let contractId

    if (contractIdStr) {
      contractId = ContractId.fromString(contractIdStr)
      console.log(`[SUCCESS] Reusing deployed AutonomousCronVault Contract ID: ${contractIdStr}`)
    } else {
      const { bytecode } = compileCronVaultContract()
      console.log(`[SUCCESS] Contract Compiled! Bytecode Length: ${bytecode.length} hex chars`)

      console.log('\n[PROCESS] Step 1: Deploying AutonomousCronVault with 1 ℏ to pay for its scheduled calls...')
      // Deploy the contract: the bytecode goes on-chain and the network returns its contract ID and EVM address.
      // No admin key on purpose: the contract's own ID is then its key, so it can authorize
      // (and pay for) the calls it schedules. With an admin key, HSS would need that key to sign.
      const deployTx = await executeWithGas((gas) => new ContractCreateTransaction()
        .setBytecode(Buffer.from(bytecode, 'hex'))
        .setGas(gas)
        .setInitialBalance(new Hbar(1)), client, { gas: 1500000 })

      // Wait for consensus: the receipt says whether the network accepted the transaction.
      const deployReceipt = await deployTx.getReceipt(client)
      contractId = deployReceipt.contractId
      contractIdStr = contractId.toString()
      updateState('AUTONOMOUS_CRON_VAULT_V3_ID', contractIdStr)

      console.log(`[SUCCESS] AutonomousCronVault Deployed at Contract ID: ${contractIdStr}`)
      console.log(`[LOG] EVM Address: 0x${contractId.toEvmAddress()}`)
      console.log(`[EXPLORER] View on HashScan: ${getHashscanUrl(deployTx)}`)
    }

    // 2. Run the task once by hand
    console.log('\n[PROCESS] Step 2: Executing performAutonomousHeartbeat() by hand...')
    // Call the contract: a state-changing call is a transaction and pays gas.
    const heartbeatTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('performAutonomousHeartbeat'), client, { gas: 200000 })
    const heartbeatRecord = await heartbeatTx.getRecord(client)
    console.log(`[SUCCESS] Heartbeat Executed! Status: ${heartbeatRecord.receipt.status.toString()}`)
    const counterBefore = await readCounter(client, contractId)
    console.log(`[LOG] heartbeatCounter = ${counterBefore}`)

    // 3. Ask HSS (0x16b) to run the next heartbeat on its own
    console.log(`\n[PROCESS] Step 3: Contract asks HSS (0x16b scheduleCall) to run the next heartbeat in ${DELAY_SECONDS} s...`)
    const scheduleCallTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gas)
      .setFunction('scheduleNextHeartbeat', new ContractFunctionParameters().addUint256(DELAY_SECONDS)), client, { gas: 400000 })

    const scheduleRecord = await scheduleCallTx.getRecord(client)
    const responseCode = Number(scheduleRecord.contractFunctionResult.getInt64(0))
    const scheduleAddress = scheduleRecord.contractFunctionResult.getAddress(1)
    console.log(`[LOG] Contract call status: ${scheduleRecord.receipt.status.toString()} | HSS response code: ${responseCode}`)
    console.log(`[EXPLORER] View on HashScan: ${getHashscanUrl(scheduleCallTx)}`)
    updateState('AUTONOMOUS_CRON_LAST_TX_ID', scheduleCallTx.transactionId.toString())

    if (responseCode !== 22) {
      console.log(`[INFO] HSS did not create a schedule (code ${responseCode}; -1 means the call to 0x16b itself failed).`)
      console.log('[INFO] scheduleCall (HIP-1215) may not be enabled on this network yet. Nothing was scheduled.')
    } else {
      const scheduleId = `0.0.${parseInt(scheduleAddress, 16)}`
      console.log(`[SUCCESS] Schedule ${scheduleId} created by the contract itself (0x${scheduleAddress})`)

      // 4. Wait for the network to run it, then read the outcome from the Mirror Node
      console.log(`\n[PROCESS] Step 4: Waiting for the network to run schedule ${scheduleId}...`)
      let executedAt = null
      for (let i = 0; i < 12 && !executedAt; i++) {
        await sleep(5000)
        const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/schedules/${scheduleId}`)
        if (res.ok) executedAt = (await res.json()).executed_timestamp
      }
      if (!executedAt) {
        console.log(`[INFO] Schedule ${scheduleId} has not run yet (or the Mirror Node has not caught up). Check it on HashScan.`)
      } else {
        const txRes = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions?timestamp=${executedAt}`)
        const result = txRes.ok ? (await txRes.json()).transactions?.[0]?.result : 'unknown'
        const counterAfter = await readCounter(client, contractId)
        console.log(`[LOG] Scheduled call ran at consensus ${executedAt}: ${result}`)
        if (result === 'SUCCESS' && counterAfter > counterBefore) {
          console.log(`[VERIFY] heartbeatCounter went from ${counterBefore} to ${counterAfter}: the network ran the call with no keeper.`)
        } else {
          console.log(`[INFO] The scheduled call ran but did not succeed (${result}); heartbeatCounter is ${counterAfter}.`)
        }
      }
    }

    console.log('\n KEY CONCEPT:')
    console.log('0x16b Self-Scheduling: a contract can ask Hedera to call it back later, and the')
    console.log('network runs that call itself when the time comes, with no keeper bot. The contract')
    console.log('pays for it from its own HBAR balance.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Each scheduleCall is one future call. For a recurring job, the scheduled call')
    console.log('schedules the next one, and the contract must keep enough HBAR for all of them.')

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
