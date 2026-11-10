/**
 * ============================================================================
 * Lab 10: Atomic Batch Transactions (HIP-551)
 * [CONCEPT] Several Signed Transactions, One All-or-Nothing Unit, No Contract
 * ============================================================================
 * [ KEY CONCEPT ]
 * A BatchTransaction carries up to 50 inner transactions (6 KB in total) that
 * reach consensus together: either all of them take effect or none does. Each
 * inner transaction is a normal transaction with its own payer and signatures;
 * what ties it to the batch is its batch key (batchify sets it, marks the node
 * as 0.0.0 and signs). The outer batch must be signed by every batch key. This
 * lab settles a two-party HBAR swap plus an HCS record of the trade in one
 * batch, then sends a batch whose last step fails and checks on the Mirror Node
 * that none of its earlier steps were committed.
 * *
 * [ LEARNABLE MOMENT ]
 * Atomic does not mean free: when a batch fails, the inner transactions that ran are still charged, only their effects are rolled back. And since v0.76.3 a batch may hold at most one smart contract call, as its last step; contract calls inside batches are deprecated (removal planned for March 2027), so keep batches native (HBAR, tokens, topics, accounts) and move contract logic into the contract.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-551
 * - https://docs.hedera.com/native/transactions/batch
 * - https://docs.hedera.com/native/transactions/batch#limits-on-batch-size
 *
 * [ LEARNING PATH ]
 * - Previous: M4 Lab 09: Zero-Capital Flash Loans & Atomic Layer 1 Settlement
 * - Next:     M5 Lab 01: Immutable HCS Primitives
 *
 * [ SEQUENCE ]
 * Note Lab: Inner 1: ACCOUNT_1 pays ACCOUNT_2 (signed by ACCOUNT_1)
 * Note Lab: Inner 2: ACCOUNT_2 pays ACCOUNT_1 back more (signed by ACCOUNT_2)
 * Note Lab: Inner 3: The trade record on HCS (signed by you)
 * Lab -> Hedera: BatchTransaction (signed with the batch key)
 * Hedera -> Lab: SUCCESS: all three applied at one consensus timestamp
 * Lab -> Hedera: A second batch whose last step overdraws ACCOUNT_2
 * Hedera -> Lab: INNER_TRANSACTION_FAILED: nothing applied
 * Lab -> Mirror Node: Balances and topic unchanged
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account pays the batch, holds the batch key and writes the HCS record.
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 swap 0.10 ℏ and 0.12 ℏ (each pays its own inner fee).
 * - Cost: <1 ℏ the first time (topic); about 0.05 ℏ per run after that, spread over the three accounts.
 *
 * [ HOW TO RUN ]
 * node English/M4_Token_Operations_Atomic_Swaps/10_hip551_atomic_batch.js
 * ============================================================================
 */

import { BatchTransaction, Hbar, TopicCreateTransaction, TopicMessageSubmitTransaction, TransferTransaction } from '@hiero-ledger/sdk'
import { getClient, createClient, parsePrivateKey, ensureFunded, reuseTopic, waitForMirror, getMirrorNodeBaseUrl, getHashscanUrl, updateState, show } from '../M99_Utilities/index.js'

const mirror = (path) => fetch(`${getMirrorNodeBaseUrl()}/api/v1${path}`).then((r) => (r.ok ? r.json() : null))
const hbarOf = async (id) => (await mirror(`/accounts/${id}`))?.balance?.balance ?? 0
const topicSequence = async (topicId) => (await mirror(`/topics/${topicId}/messages?limit=1&order=desc`))?.messages?.[0]?.sequence_number ?? 0
const mirrorTxId = (txId) => txId.toString().replace('@', '-').replace(/\.(\d+)$/, '-$1')

const main = async () => {
  console.log('--- SESSION START: Atomic Batch Transactions (HIP-551) ---\n')
  const { client, operatorKey } = getClient()
  const ids = [process.env.ACCOUNT_1_ID, process.env.ACCOUNT_2_ID]
  const keys = [process.env.ACCOUNT_1_PRIVATE_KEY, process.env.ACCOUNT_2_PRIVATE_KEY]
  if (ids.some((v) => !v) || keys.some((v) => !v)) {
    console.error('[FAILED] Missing ACCOUNT_1 / ACCOUNT_2 credentials in .env.')
    process.exitCode = 1
    return
  }
  const [aliceId, bobId] = ids
  const alice = createClient(aliceId, keys[0])
  const bob = createClient(bobId, keys[1])
  // The batch key: whoever holds it decides whether these inner transactions are submitted, and together.
  const batchKey = parsePrivateKey(operatorKey)

  try {
    await ensureFunded(client, aliceId, 2)
    await ensureFunded(client, bobId, 2)
    const topicId = await reuseTopic('REUSE_M4_10_TRADE_LOG', async () => {
      const receipt = await (await new TopicCreateTransaction().setTopicMemo('HBE M4-10 atomic batch trade log').execute(client)).getReceipt(client)
      return receipt.topicId
    })

    // 1. Three inner transactions, each built and signed by its own payer, each bound to the batch key.
    const swap = async ({ aToB, bToA, memo }) => {
      const leg1 = await new TransferTransaction()
        .addHbarTransfer(aliceId, new Hbar(-aToB))
        .addHbarTransfer(bobId, new Hbar(aToB))
        .setTransactionMemo(`${memo} leg 1`)
        .batchify(alice, batchKey.publicKey)
      const leg2 = await new TransferTransaction()
        .addHbarTransfer(bobId, new Hbar(-bToA))
        .addHbarTransfer(aliceId, new Hbar(bToA))
        .setTransactionMemo(`${memo} leg 2`)
        .batchify(bob, batchKey.publicKey)
      const record = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify({ trade: memo, aToB, bToA, parties: [aliceId, bobId] }))
        .batchify(client, batchKey.publicKey)
      return [leg1, leg2, record]
    }

    const before = { alice: await hbarOf(aliceId), bob: await hbarOf(bobId), seq: await topicSequence(topicId) }
    const inner = await swap({ aToB: 0.1, bToA: 0.12, memo: 'trade-1' })
    const kinds = ['HBAR transfer (leg 1)', 'HBAR transfer (leg 2)', 'HCS message (trade record)']
    show.table(inner.map((tx, i) => ({ inner: i + 1, type: kinds[i], payer: tx.transactionId.accountId.toString(), node: tx.nodeAccountIds.map(String).join(','), 'batch key': 'operator' })))

    // 2. The batch: the operator pays the outer transaction and signs with the batch key.
    const batch = await new BatchTransaction().setInnerTransactions(inner).freezeWith(client).sign(batchKey)
    const response = await batch.execute(client)
    const receipt = await response.getReceipt(client)
    console.log(`[SUCCESS] Batch ${receipt.status}: ${response.transactionId}`)
    console.log(`[EXPLORER] ${getHashscanUrl(response)}`)

    // Every inner transaction is its own transaction on the Mirror Node, all at consecutive timestamps.
    const innerRecords = await waitForMirror(async () => {
      const rows = await Promise.all(batch.innerTransactionIds.map((id) => mirror(`/transactions/${mirrorTxId(id)}`)))
      return rows.every((r) => r?.transactions?.length) ? rows.map((r) => r.transactions[0]) : null
    })
    show.table(innerRecords.map((t, i) => ({ inner: i + 1, name: t.name, result: t.result, consensus: t.consensus_timestamp, 'batch key set': Boolean(t.batch_key) })))
    const after = await waitForMirror(async () => {
      const seq = await topicSequence(topicId)
      return seq > before.seq ? { alice: await hbarOf(aliceId), bob: await hbarOf(bobId), seq } : null
    })
    console.log(`[SUCCESS] Swap applied: ${aliceId} ${((after.alice - before.alice) / 1e8).toFixed(4)} ℏ, ${bobId} ${((after.bob - before.bob) / 1e8).toFixed(4)} ℏ (fees included); trade record #${after.seq} on ${topicId}`)

    // 3. All or nothing: the last step overdraws ACCOUNT_2, so the HCS record and leg 1 must not stick either.
    // Its fee payer is the operator, so the node's precheck passes and the step fails at consensus.
    console.log('\n[PROCESS] A second batch whose last step cannot succeed (ACCOUNT_2 sends far more than it has)...')
    const leg1 = await new TransferTransaction()
      .addHbarTransfer(aliceId, new Hbar(-0.1))
      .addHbarTransfer(bobId, new Hbar(0.1))
      .batchify(alice, batchKey.publicKey)
    const record = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify({ trade: 'trade-2', note: 'must never appear' }))
      .batchify(client, batchKey.publicKey)
    const overdraw = await new TransferTransaction()
      .addHbarTransfer(bobId, new Hbar(-1_000_000))
      .addHbarTransfer(aliceId, new Hbar(1_000_000))
      .batchify(client, batchKey.publicKey)
    await overdraw.sign(parsePrivateKey(keys[1])) // ACCOUNT_2 authorizes the debit
    const failing = await new BatchTransaction().setInnerTransactions([leg1, record, overdraw]).freezeWith(client).sign(batchKey)
    let failedStatus = 'SUCCESS'
    try {
      await (await failing.execute(client)).getReceipt(client)
    } catch (error) {
      failedStatus = error.status ? error.status.toString() : error.message
    }
    console.log(`[SUCCESS] Second batch rejected: ${failedStatus}`)
    if (failedStatus === 'SUCCESS') throw new Error('the failing batch went through')

    const settled = await waitForMirror(async () => {
      const rows = await Promise.all(failing.innerTransactionIds.map((id) => mirror(`/transactions/${mirrorTxId(id)}`)))
      return rows.every((r) => r?.transactions?.length) ? rows.map((r) => r.transactions[0]) : null
    })
    show.table((settled || []).map((t, i) => ({ inner: i + 1, name: t.name, result: t.result, 'fee charged (ℏ)': (t.charged_tx_fee / 1e8).toFixed(5) })))
    console.log('[INFO] REVERTED_SUCCESS: the step ran and was charged, then rolled back with the batch.')
    const seqNow = await topicSequence(topicId)
    console.log(`[SUCCESS] Topic still ends at message #${seqNow} (the trade-2 record was rolled back with the rest)`)
    if (seqNow !== after.seq) throw new Error('a message from the failed batch reached the topic')
    updateState('M4_BATCH_LAST', response.transactionId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('A batch applies every inner transaction or none, each signed by its own payer.')
    console.log('\n LEARNABLE MOMENT:')
    console.log('Failed batches still pay for the inner steps that ran; keep contract calls out of batches.')
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    alice.close()
    bob.close()
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
