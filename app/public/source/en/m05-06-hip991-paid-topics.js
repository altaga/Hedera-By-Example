/**
 * ============================================================================
 * Lab 06: Revenue-Generating Paid Topics & Tokenized Data Streams (HIP-991)
 * [CONCEPT] Permissionless Consensus Monetization in HBAR or HTS Tokens
 * ============================================================================
 * [ KEY CONCEPT ]
 * Before HIP-991, monetizing an HCS Topic required building custom smart contracts
 * or centralized API paywalls. With HIP-991, Topic Operators can attach a
 * `CustomFixedFee` (denominated in HBAR or any HTS Fungible Token) directly to
 * a public HCS Topic via `.setCustomFees([fee])`.
 * Every time an external user or AI agent submits a message to the topic, the
 * consensus layer automatically collects the fee and deposits it into the
 * `feeCollectorAccountId`, while keys in `feeExemptKeys` post for free!
 *
 * [ LEARNABLE MOMENT ]
 * HIP-991 transforms every HCS Topic into a native, zero-contract SaaS billing
 * engine. To protect senders against sudden fee spikes by a rogue topic admin,
 * senders specify a `CustomFeeLimit` (`setMaxCustomFee`) on their message submission.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-991
 *
 * [ LEARNING PATH ]
 * - Previous: M5 Lab 05: HCS-6 Registry
 * - Next:     M5 Lab 07: High-Throughput Merkle Batch Ingestion
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~45 ℏ the first time (it creates a token and a paid HIP-991 topic, about 3 USD); ~2 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M5_Hedera_Consensus_Service/06_hip991_paid_topics.js
 * ============================================================================
 */

import {
  AccountCreateTransaction,
  CustomFeeLimit,
  CustomFixedFee,
  Hbar,
  MirrorNodeTokenBalanceQuery,
  PrivateKey,
  TokenCreateTransaction,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { getClient, sleep, updateState, createClient, reuseToken, reuseTopic } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HIP-991 Revenue-Generating Paid Topics ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Create an HTS Payment Token ("AI Compute Credit" - AICR)
    console.log('[PROCESS] Step 1: Minting HTS Utility Token [AICR] for Topic Monetization...')
    const paymentTokenId = await reuseToken('REUSE_M5_06_TOKEN', async () => {
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('AI Compute Credit')
        .setTokenSymbol('AICR')
        .setDecimals(0)
        .setInitialSupply(100000)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(adminKey)
        .freezeWith(client)

      const tokenRes = await (await tokenTx.sign(adminKey)).execute(client)
      return (await tokenRes.getReceipt(client)).tokenId
    }, { minBalance: 500 })
    console.log(`[SUCCESS] HTS Payment Token Created: ${paymentTokenId.toString()} (AICR)`)

    // 2. Create a Consumer Agent Account and fund it with HBAR + 500 AICR
    console.log('\n[PROCESS] Step 2: Provisioning External AI Consumer Agent...')
    const consumerKey = PrivateKey.generateED25519()
    const consumerRes = await new AccountCreateTransaction()
      .setKeyWithoutAlias(consumerKey.publicKey)
      .setInitialBalance(new Hbar(1))
      .setMaxAutomaticTokenAssociations(5)
      .execute(client)
    const consumerId = (await consumerRes.getReceipt(client)).accountId

    const fundRes = await new TransferTransaction()
      .addTokenTransfer(paymentTokenId, operatorId, -500)
      .addTokenTransfer(paymentTokenId, consumerId, 500)
      .execute(client)
    await fundRes.getReceipt(client)
    console.log(`[CONSUMER] Agent Account: ${consumerId.toString()} (Funded with 500 AICR)`)

    // 3. Create a HIP-991 Revenue-Generating HCS Topic (Fee: 25 AICR per message)
    console.log('\n[PROCESS] Step 3: Deploying HIP-991 Paid HCS Topic (Fee: 25 AICR / message)...')
    const topicCustomFee = new CustomFixedFee()
      .setAmount(25)
      .setDenominatingTokenId(paymentTokenId)
      .setFeeCollectorAccountId(operatorId)

    // Reuse the paid topic while it still charges in this lab's payment token.
    const topicId = await reuseTopic('REUSE_M5_06_TOPIC', async () => {
      const topicTx = await new TopicCreateTransaction()
        .setTopicMemo('HIP-991:PAID:AI:ORACLE:FEED')
        .setAdminKey(adminKey.publicKey)
        .setFeeScheduleKey(adminKey.publicKey)
        .addFeeExemptKey(adminKey.publicKey) // Operator is exempt from paying fees!
        .addCustomFee(topicCustomFee)
        .freezeWith(client)
      return (await (await (await topicTx.sign(adminKey)).execute(client)).getReceipt(client)).topicId
    }, { check: (t) => (t.custom_fees?.fixed_fees || []).some((f) => f.denominating_token_id === paymentTokenId.toString()) })
    console.log(`[SUCCESS] HIP-991 Paid Topic Deployed: ${topicId.toString()}`)
    console.log(`[LOG] Toll Configured: 25 AICR per message ➔ Collector (${operatorId.toString()})`)

    // 4. Consumer Agent Submits Message with `CustomFeeLimit` Authorization
    console.log('\n[PROCESS] Step 4: Consumer Agent submitting query to Paid Topic...')
    const consumerClient = createClient()
    consumerClient.setOperator(consumerId, consumerKey)

    const maxAllowedFee = new CustomFeeLimit()
      .setAccountId(consumerId)
      .setFees([
        new CustomFixedFee()
          .setAmount(50) // Willing to pay up to 50 AICR
          .setDenominatingTokenId(paymentTokenId)
      ])

    const paidSubmitRes = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify({
        agent: consumerId.toString(),
        action: 'QUERY_ALPHA_SIGNAL',
        pair: 'HBAR/USD'
      }))
      .addCustomFeeLimit(maxAllowedFee)
      .execute(consumerClient)

    const paidSubmitReceipt = await paidSubmitRes.getReceipt(consumerClient)
    consumerClient.close()
    console.log(`[SUCCESS] Paid Message Accepted at Sequence #${paidSubmitReceipt.topicSequenceNumber}!`)

    // 5. Verify Automatic HTS Fee Collection via Mirror Node
    await sleep(3500)
    const consumerBalAfter = await new MirrorNodeTokenBalanceQuery()
      .setAccountId(consumerId)
      .setTokenId(paymentTokenId)
      .execute(client)
    console.log(`\n[AUDIT] Consumer Agent AICR Balance: ${consumerBalAfter.balance.toString()} AICR (25 AICR Auto-Collected!)`)

    updateState('HIP991_PAID_TOPIC_ID', topicId.toString())
    updateState('HIP991_PAYMENT_TOKEN_ID', paymentTokenId.toString())
    updateState('HIP991_CONSUMER_FINAL_BAL', consumerBalAfter.balance.toString())

    console.log('\n KEY CONCEPT:')
    console.log('HIP-991 turns any HCS topic into a permissionless revenue stream denominated')
    console.log('in HBAR or any HTS token (like USDC or custom utility credits), while')
    console.log('`addFeeExemptKey` lets your own backend post responses for free.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Always attach a `CustomFeeLimit` when submitting to third-party HIP-991 topics.')
    console.log('It acts as a slippage ceiling so a topic admin cannot hike the toll mid-flight.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] HIP-991 Paid Topic Failure:', error.message)
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
