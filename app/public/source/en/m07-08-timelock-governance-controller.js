/**
 * ============================================================================
 * Lab 08: Enterprise Timelock Governance Controller & Security Council Veto
 * [CONCEPT] Layer-1 Timelocked Execution Windows & Cryptographic Veto Authority
 * ============================================================================
 * [ KEY CONCEPT ]
 * In high-value institutional treasuries and decentralized governance (DAOs),
 * passing a vote or threshold signature must NEVER execute immediately.
 * If an admin key is compromised or a malicious proposal slips through,
 * instantaneous execution results in total treasury drainage.
 *
 * Enterprise governance mandates a Timelock Delay Window:
 * 1. Timelocked Proposal: A proposal is scheduled via `ScheduleCreateTransaction`
 *    with `waitForExpiry: true` and an expiration window (e.g. 24 to 48 hours).
 * 2. Asynchronous Multi-Signatures: Trustees submit cryptographic approvals off-chain
 *    or on-chain via `ScheduleSignTransaction`.
 * 3. Security Council Guard: During the timelock window, an independent Security
 *    Council (or algorithmic risk monitor) audits the pending transaction.
 * 4. Cryptographic Veto: If malicious parameters, compromised keys, or sanctions
 *    violations are detected, the Security Council executes `ScheduleDeleteTransaction`
 *    using their assigned `adminKey`. The proposal is permanently purged on Layer 1.
 *
 * [ LEARNABLE MOMENT ]
 * Unlike Ethereum TimelockController contracts that cost $30-$100 to deploy and operate,
 * Hedera provides cryptographic timelocks and veto deletion directly in the core
 * consensus protocol. Scheduled transactions cannot be hijacked, re-ordered, or front-run.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-423
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/schedule-transaction
 *
 * [ LEARNING PATH ]
 * - Previous: M7 Lab 07: Webhook-Driven Autonomous Treasury DAO
 * - Next:     M8 Lab 01: Smart Contract Deployment
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M7_Governance_Cron/08_timelock_governance_controller.js
 * ============================================================================
 */

import {
  AccountId,
  ScheduleCreateTransaction,
  ScheduleDeleteTransaction,
  TransferTransaction,
  PrivateKey,
  Timestamp,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

/**
 * Enterprise Risk & Security Council Auditor Simulation
 */
class GovernanceRiskMonitor {
  constructor (prohibitedAccounts = []) {
    this.prohibitedAccounts = new Set(prohibitedAccounts)
  }

  auditProposal (targetAccountId, transferAmount) {
    console.log(`[ SECURITY MONITOR] Auditing pending proposal: Recipient=${targetAccountId}, Amount=${transferAmount}...`)
    if (this.prohibitedAccounts.has(targetAccountId)) {
      return { approved: false, reason: 'CRITICAL: Recipient flagged on compliance sanctions blocklist!' }
    }
    return { approved: true, reason: 'Proposal passed automated compliance screening.' }
  }
}

const main = async () => {
  console.log('--- SESSION START: Timelock Governance Controller & Security Council Veto ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Generate Security Council Guardian Key & Proposer Key
    console.log('[PROCESS] Step 1: Provisioning Security Council & Trustee Identities...')
    const securityCouncilKey = PrivateKey.generateED25519()
    const trusteeKey = PrivateKey.generateED25519()
    const maliciousRecipient = '0.0.9999999' // Blocklisted address for simulation

    console.log(`[LOG] Operator / Treasury:     ${operatorId.toString()}`)
    console.log(`[LOG] Council Guardian Key:    ${securityCouncilKey.publicKey.toStringDer().substring(0, 32)}...`)
    console.log(`[LOG] Trustee Multi-Sig Key:   ${trusteeKey.publicKey.toStringDer().substring(0, 32)}...`)

    // 2. Schedule a Timelocked Treasury Action
    console.log('\n[PROCESS] Step 2: Scheduling Timelocked Treasury Payout (48h Window)...')

    // Inner transaction: Transfer 0 tinybars to self
    const innerTransferTx = new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(0))
      .setTransactionMemo('GOVERNANCE:TREASURY:PROPOSAL_#42')

    // Create schedule with Security Council as adminKey (grants veto power)
    // On Hedera, the adminKey must co-sign ScheduleCreateTransaction to authorize its administrative status,
    // and waitForExpiry = true with expirationTime guarantees execution is delayed until the timelock matures
    const expiryDate = new Date(Date.now() + 86400000)
    const scheduleCreateTx = await (await new ScheduleCreateTransaction()
      .setScheduledTransaction(innerTransferTx)
      .setAdminKey(securityCouncilKey.publicKey)
      .setScheduleMemo('TIMELOCK_GOV_PROPOSAL_#42')
      .setPayerAccountId(AccountId.fromString(operatorId))
      .setExpirationTime(Timestamp.fromDate(expiryDate))
      .setWaitForExpiry(true)
      .freezeWith(client)
      .sign(securityCouncilKey))
      .execute(client)

    const scheduleReceipt = await scheduleCreateTx.getReceipt(client)
    const scheduleId = scheduleReceipt.scheduleId

    console.log(`[SUCCESS] Proposal Timelocked on Layer 1! Schedule ID: ${scheduleId.toString()}`)
    console.log(`[LOG] Transaction ID:  ${scheduleCreateTx.transactionId.toString()}`)
    console.log(`[EXPLORER] View on HashScan: ${getHashscanUrl(scheduleCreateTx)}`)

    // 3. Security Monitor detects policy violation during Timelock Window
    console.log('\n[PROCESS] Step 3: Security Council Automated Risk Inspection...')
    const monitor = new GovernanceRiskMonitor([maliciousRecipient])
    const auditResult = monitor.auditProposal(maliciousRecipient, '50,000 HBAR')

    console.log(`[ RISK ALERT] Audit Result: ${auditResult.reason}`)
    console.log('[ACTION] Triggering Security Council Emergency Cryptographic Veto...')

    // 4. Security Council issues emergency VETO via ScheduleDeleteTransaction
    console.log('\n[PROCESS] Step 4: Signing & Broadcasting ScheduleDeleteTransaction...')
    const deleteTx = await (await new ScheduleDeleteTransaction()
      .setScheduleId(scheduleId)
      .freezeWith(client)
      .sign(securityCouncilKey))
      .execute(client)

    const deleteReceipt = await deleteTx.getReceipt(client)
    console.log(`\n[SUCCESS] Emergency Veto Executed! Consensus Status: ${deleteReceipt.status.toString()}`)
    console.log(`[LOG] Deletion Tx ID:  ${deleteTx.transactionId.toString()}`)
    console.log(`[EXPLORER] View on HashScan: ${getHashscanUrl(deleteTx)}`)

    updateState('TIMELOCK_SCHEDULE_ID', scheduleId.toString())
    updateState('TIMELOCK_VETO_STATUS', deleteReceipt.status.toString())

    console.log('\n KEY CONCEPT:')
    console.log('Native Timelock Security: Hedera Schedule Service allows organizations to define')
    console.log('an admin key on any scheduled transaction. If the Security Council or risk monitors')
    console.log('detect fraudulent parameters, the admin key can delete the transaction before the')
    console.log('timelock matures, preventing unauthorized funds movement with mathematical certainty.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Because Hedera native scheduling is enforced by consensus nodes directly, there is')
    console.log('zero smart contract code that can be re-entered, paused, or flash-loan attacked.')
    console.log('Corporate governance is baked into the Byzantine Fault Tolerant protocol itself.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Timelock Controller Failure:', error.message)
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
