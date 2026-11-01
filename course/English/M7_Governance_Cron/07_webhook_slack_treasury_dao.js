/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 07: Webhook-Driven Autonomous Treasury DAO (Real-Time Reactive Governance)
 * [ CONCEPT ] Layer-1 Threshold Quorums & Event-Driven Enterprise Orchestration
 * ============================================================================
 * [ KEY CONCEPT ]
 * In traditional EVM DAOs (like OpenZeppelin Governor or Gnosis Safe), multisig
 * governance requires complex smart contracts, multiple gas-heavy transactions,
 * and external "keeper" bots to call an `execute()` function after voting closes.
 *
 * Hedera eliminates this entire attack surface via Layer-1 Native Scheduling:
 * 1. Treasury accounts use native `KeyList` threshold keys (e.g., 2 of 3).
 * 2. Proposals are registered as `ScheduleCreateTransaction` waiting rooms.
 * 3. Reactive webhooks notify distributed trustees across enterprise systems.
 * 4. The exact millisecond the 2nd signature is submitted via `ScheduleSignTransaction`,
 *    Hedera's gossip-about-gossip autonomously triggers the transaction on Layer 1.
 *    No keeper bots, no gas relayer, and zero smart contract risk.
 *
 * [ LEARNABLE MOMENT ]
 * Scheduled transactions on Hedera decouple "Proposal", "Authorization", and
 * "Execution". Any trustee or system can propose; other trustees can sign
 * asynchronously from anywhere in the world. When the threshold condition is
 * mathematically satisfied, consensus nodes finalize the payout atomically.
 *
 * [ LEARNING PATH ]
 * - Previous: M7 Lab 06: Cryptographic Login with DID
 * - Next:     M7 Lab 08: Timelock Governance Controller & Security Council Veto
 *
 * [ HOW TO RUN ]
 * node English/M7_Governance_Cron/07_webhook_slack_treasury_dao.js
 * ============================================================================
 */

import {
  AccountId,
  PrivateKey,
  KeyList,
  AccountCreateTransaction,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  TransferTransaction,
  Hbar,
  Timestamp
} from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl, getHashscanUrl, sleep } from '../M99_Utilities/index.js'

/**
 * Enterprise Webhook Dispatcher Simulation
 * (e.g. Dispatches structured events to Slack, Discord, or an internal ERP)
 */
const dispatchGovernanceWebhook = (channel, eventPayload) => {
  console.log(`\n[🔔 WEBHOOK DISPATCHED -> ${channel}]`)
  console.log(JSON.stringify(eventPayload, null, 2))
}

/**
 * Async Mirror Node Balance Retriever (CQRS compliant)
 */
const getAccountHbarBalance = async (accountId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
  if (!res.ok) {
    throw new Error(`Mirror Node balance fetch failed for account ${accountId}: ${res.statusText}`)
  }
  const data = await res.json()
  return data.balance.balance / 1e8
}

const main = async () => {
  console.log('--- SESSION START: Webhook-Driven Autonomous Treasury DAO ---\n')
  const { client, operatorId, operatorKey } = getClient()

  try {
    // 1. Establish 3-Trustee Governance Board (2-of-3 Quorum)
    console.log('[⚙️ PROCESS] Step 1: Setting up 2-of-3 Multi-Sig Governance Board...')

    const trustee1Key = PrivateKey.fromStringDer(operatorKey) // Trustee 1 (Operator)
    const trustee2Key = PrivateKey.generateED25519() // Trustee 2 (Finance Officer)
    const trustee3Key = PrivateKey.generateED25519() // Trustee 3 (Risk Auditor)

    const thresholdKeys = new KeyList([
      trustee1Key.publicKey,
      trustee2Key.publicKey,
      trustee3Key.publicKey
    ], 2) // Quorum: 2 signatures required out of 3

    // Designate Recipient Account (Community Grantee / Vendor)
    const recipientId = process.env.ACCOUNT_1_ID || '0.0.11226623'
    const initialRecipientBalance = await getAccountHbarBalance(recipientId)

    // Create the DAO Multi-Sig Treasury Account with 0.5 HBAR Initial Liquidity
    const treasuryCreateTx = await new AccountCreateTransaction()
      .setKey(thresholdKeys)
      .setInitialBalance(new Hbar(0.5))
      .execute(client)
    const treasuryReceipt = await treasuryCreateTx.getReceipt(client)
    const treasuryAccountId = treasuryReceipt.accountId.toString()

    console.log(`[✅ SUCCESS] Multi-Sig Treasury Created: ${treasuryAccountId} (2-of-3 Threshold)`)
    console.log('[📊 LOG] Initial Treasury Balance: 0.5 HBAR')
    console.log(`[📊 LOG] Recipient Vendor Account: ${recipientId} (Initial: ${initialRecipientBalance} HBAR)`)

    // 2. Trustee 1 Proposes Outward Grant Payout via ScheduleCreateTransaction
    console.log('\n[⚙️ PROCESS] Step 2: Trustee 1 Initiates Scheduled Treasury Payout Proposal (0.1 HBAR)...')

    const payoutTransfer = new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(treasuryAccountId), new Hbar(-0.1))
      .addHbarTransfer(AccountId.fromString(recipientId), new Hbar(0.1))

    const expiryDate = new Date()
    expiryDate.setMinutes(expiryDate.getMinutes() + 30)

    const scheduleCreateTx = await new ScheduleCreateTransaction()
      .setScheduledTransaction(payoutTransfer)
      .setPayerAccountId(AccountId.fromString(operatorId))
      .setScheduleMemo('DAO-GOV-PROPOSAL-042: Community Dev Grant Payout')
      .setExpirationTime(Timestamp.fromDate(expiryDate))
      .setWaitForExpiry(false) // Executes autonomously immediately upon reaching quorum!
      .freezeWith(client)
      .sign(trustee1Key) // Trustee 1 (Proposer) co-signs proposal upon creation

    const scheduleResponse = await scheduleCreateTx.execute(client)
    const scheduleReceipt = await scheduleResponse.getReceipt(client)
    const scheduleId = scheduleReceipt.scheduleId.toString()

    console.log(`[✅ SUCCESS] Scheduled Proposal Registered: ${scheduleId}`)
    console.log(`[📊 LOG] Proposal HashScan: ${getHashscanUrl(scheduleResponse)}`)

    // 3. Reactive Event Listener & Webhook Dispatch
    console.log('\n[⚙️ PROCESS] Step 3: Event-Driven Monitor detecting proposal & dispatching Webhook...')
    console.log('[ℹ️ INFO] Ingesting proposal state from Mirror Node (3 seconds)...')
    await sleep(3000)

    const mirrorScheduleUrl = `${getMirrorNodeBaseUrl()}/api/v1/schedules/${scheduleId}`
    const mirrorRes = await fetch(mirrorScheduleUrl)
    if (!mirrorRes.ok) {
      throw new Error(`Mirror Node schedule query failed: ${mirrorRes.statusText}`)
    }

    const scheduleData = await mirrorRes.json()
    const collectedSignatures = scheduleData.signatures ? scheduleData.signatures.length : 1
    const isExecuted = scheduleData.executed_timestamp !== null

    console.log(`[📊 LOG] Current On-Chain Quorum Status: ${collectedSignatures}/2 signatures collected.`)
    console.log(`[📊 LOG] Execution Status: ${isExecuted ? 'EXECUTED' : 'PENDING_APPROVAL'}`)

    // Dispatch webhook to corporate channels (Slack / ERP)
    dispatchGovernanceWebhook('#dao-treasury-alerts', {
      event: 'TREASURY_PROPOSAL_AWAITING_QUORUM',
      timestamp: new Date().toISOString(),
      scheduleId,
      treasury: treasuryAccountId,
      governanceRule: '2-of-3 Threshold',
      signersCollected: collectedSignatures,
      signersNeeded: 2,
      proposedTransfer: {
        from: treasuryAccountId,
        to: recipientId,
        amount: '0.1 HBAR',
        purpose: 'Community Dev Grant Payout'
      },
      auditScan: `https://hashscan.io/testnet/schedule/${scheduleId}`
    })

    // 4. Trustee 2 Evaluates and Submits Second Signature
    console.log('\n[⚙️ PROCESS] Step 4: Trustee 2 (Finance Officer) reviews webhook and authorizes payout...')
    console.log('[ℹ️ INFO] Generating cryptographic approval via ScheduleSignTransaction...')

    const signTx = await new ScheduleSignTransaction()
      .setScheduleId(scheduleId)
      .freezeWith(client)
      .sign(trustee2Key) // Trustee 2 adds the decisive 2nd signature!

    const signResponse = await signTx.execute(client)
    const signReceipt = await signResponse.getReceipt(client)

    console.log(`[✅ SUCCESS] Trustee 2 Signature Ingested: Status ${signReceipt.status.toString()}!`)
    console.log(`[📊 LOG] Signature Tx on HashScan: ${getHashscanUrl(signResponse)}`)

    // 5. Verify Autonomous Layer-1 Execution
    console.log('\n[⚙️ PROCESS] Step 5: Verifying Autonomous Consensus Layer-1 Execution...')
    console.log('[ℹ️ INFO] Awaiting consensus ledger balance settlement (3 seconds)...')
    await sleep(3000)

    const treasuryBalance = await getAccountHbarBalance(treasuryAccountId)
    const recipientBalance = await getAccountHbarBalance(recipientId)

    console.log(`[📊 LOG] Updated Treasury Balance: ${treasuryBalance} HBAR (deducted 0.1 HBAR)`)
    console.log(`[📊 LOG] Updated Recipient Balance: ${recipientBalance} HBAR (credited 0.1 HBAR)`)

    if (treasuryBalance > 0.45) {
      throw new Error('Treasury funds were not deducted: Quorum execution failed')
    }

    console.log('[✅ SUCCESS] Autonomous Quorum Execution Confirmed! Payout finalized with 0 smart contract gas.')

    // 6. Final Mirror Node Audit
    const finalMirrorRes = await fetch(mirrorScheduleUrl)
    if (finalMirrorRes.ok) {
      const finalData = await finalMirrorRes.json()
      if (finalData.executed_timestamp) {
        console.log(`[📊 LOG] Mirror Node Consensus Executed Timestamp: ${finalData.executed_timestamp}`)
      }
    }

    console.log('\n💡 KEY CONCEPT:')
    console.log('Hedera Native Scheduling turns the ledger into an autonomous execution engine.')
    console.log('By combining threshold KeyLists with `ScheduleSignTransaction`, governance DAOs')
    console.log('execute multi-party treasury operations at native Layer 1 speeds with zero Solidity risk.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Unlike Ethereum where somebody has to spend gas to trigger `execute()` after voting,')
    console.log('Hedera nodes automatically fire the scheduled transaction within the exact consensus')
    console.log('round where the final signature reaches the threshold.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Autonomous Treasury DAO Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
