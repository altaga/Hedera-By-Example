/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: HTS USDC Micropayments
 * [CONCEPT] Sub-Cent Stablecoin Settlement for AI Inference
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Credit Card Paradox: Charging $0.01 for an API request through Stripe or
 * Visa costs $0.30 + 2.9% in fees, a 3,000% overhead that destroys
 * machine-to-machine business models. On Hedera, an x402 payment can be quoted
 * in dollars and settled in a stablecoin on the Hedera Token Service: the
 * agent signs a token transfer instead of an HBAR transfer, and the
 * facilitator pays the fixed ~$0.001 network fee in HBAR.
 * *
 * [ LEARNABLE MOMENT ]
 * Token rules still apply inside x402: the merchant must be associated with the token or the transfer cannot land. The price is an integer in the token's smallest unit (USDC has 6 decimals, so $0.025 = 25,000 units).
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/associate-tokens-to-an-account
 * - https://faucet.circle.com/
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 03: Facilitator Settlement
 * - Next:     M10 Lab 05: Financial Guardrails
 *
 * [SEQUENCE]
 * Agent -> Server: GET /api/v1/llm/prompt
 * Server -> Agent: 402 (25000 units of a 6-decimal stablecoin = $0.025)
 * Note Agent: Signs an HTS token transfer (no HBAR leaves the agent)
 * Agent -> Facilitator: PAYMENT-SIGNATURE
 * Facilitator -> Hedera: Co-signs as fee payer and submits
 * Server -> Agent: 200 OK + PAYMENT-RESPONSE
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the facilitator and the test dollar's treasury.
 * - Practice wallets: ACCOUNT_1 (agent) pays ACCOUNT_2 (merchant).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD, plus two associations); <0.1 ℏ when you run it again (it reuses the token).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/04_usdc_hts_micropayments.js
 * ============================================================================
 */

import { TokenAssociateTransaction, TokenCreateTransaction, TransferTransaction } from '@hiero-ledger/sdk'
import {
  getClient,
  updateState,
  getHashscanUrl,
  getMirrorNodeBaseUrl,
  parsePrivateKey,
  reuseToken,
  waitForMirror,
  createPaymentRequired,
  signExactPayment,
  settleExactPayment
} from '../M99_Utilities/index.js'

const OFFICIAL_TESTNET_USDC = '0.0.429274' // Circle USDC on Hedera testnet (6 decimals)

// Token balance in smallest units, or null when the account is not associated.
const tokenBalance = async (accountId, tokenId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`)
  const row = res.ok ? (await res.json()).tokens?.[0] : null
  return row ? Number(row.balance) : null
}

const main = async () => {
  console.log('--- SESSION START: HTS Stablecoin (USDC) Micropayment Rail ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  const merchantKey = process.env.ACCOUNT_2_PRIVATE_KEY

  if (!agentId || !agentKey || !merchantId || !merchantKey) {
    console.error('[FAILED] Missing credentials in .env (ACCOUNT_1 agent, ACCOUNT_2 merchant).')
    process.exitCode = 1
    return
  }

  try {
    // 1. Pick the stablecoin: Circle's testnet USDC if the agent holds some, otherwise a course test dollar
    let usdcId = OFFICIAL_TESTNET_USDC
    if ((await tokenBalance(agentId, OFFICIAL_TESTNET_USDC)) >= 25_000) {
      console.log(`[INFO] Agent holds official testnet USDC (${usdcId}): paying with it.`)
    } else {
      console.log('[PROCESS] Agent holds no testnet USDC. Provisioning the course test dollar (6 decimals, like USDC)...')
      usdcId = (await reuseToken('REUSE_M10_04_TUSD', async () => {
        const tokenCreateTx = await new TokenCreateTransaction()
          .setTokenName('Course Test Dollar')
          .setTokenSymbol('tUSD')
          .setDecimals(6)
          .setInitialSupply(1_000_000 * 1_000_000) // 1,000,000 tUSD
          .setTreasuryAccountId(operatorId)
          .freezeWith(client)
        return (await (await tokenCreateTx.execute(client)).getReceipt(client)).tokenId
      }, { minBalance: 1_000_000 })).toString()
      console.log(`[SUCCESS] Test dollar ready: ${usdcId}`)
    }

    // 2. HTS rules: the merchant (and the agent, for the test dollar) must be associated with the token
    for (const [accountId, key] of [[merchantId, merchantKey], [agentId, agentKey]]) {
      if ((await tokenBalance(accountId, usdcId)) !== null) continue
      console.log(`[PROCESS] Associating ${accountId} with ${usdcId}...`)
      const associateTx = await new TokenAssociateTransaction()
        .setAccountId(accountId)
        .setTokenIds([usdcId])
        .freezeWith(client)
        .sign(parsePrivateKey(key))
      await (await associateTx.execute(client)).getReceipt(client)
    }
    if (usdcId !== OFFICIAL_TESTNET_USDC && (await tokenBalance(agentId, usdcId)) < 100_000) {
      console.log('[PROCESS] Sending the agent 1 tUSD to spend...')
      const fundTx = await new TransferTransaction()
        .addTokenTransfer(usdcId, operatorId, -1_000_000)
        .addTokenTransfer(usdcId, agentId, 1_000_000)
        .execute(client)
      await fundTx.getReceipt(client)
    }
    // The facilitator checks balances on the Mirror Node, a few seconds behind consensus.
    await waitForMirror(async () => (await tokenBalance(agentId, usdcId)) >= 25_000 && (await tokenBalance(merchantId, usdcId)) !== null)

    // 3. The server quotes $0.025 for one LLM prompt, in the token's smallest units
    const costUsd = 0.025
    const microUnits = Math.round(costUsd * 1_000_000) // 25,000 base units
    console.log(`\n[PROCESS] Server issuing HTTP 402 for $${costUsd} USD (${microUnits} base units of ${usdcId})...`)
    const paymentRequired = createPaymentRequired({
      resource: '/api/v1/llm/prompt',
      description: 'One high-performance LLM prompt',
      payTo: merchantId,
      amount: microUnits,
      asset: usdcId,
      feePayer: operatorId.toString()
    })

    // 4. The agent signs a token transfer (Lab 02 step); the facilitator settles it (Lab 03 step)
    console.log('[PROCESS] Agent signing the token transfer...')
    const payment = await signExactPayment(client, paymentRequired, agentId, agentKey)
    console.log('[PROCESS] Facilitator verifying, co-signing and submitting...')
    const settlement = await settleExactPayment(client, payment, operatorKey)
    if (!settlement.success) throw new Error(`Settlement rejected: ${settlement.errorReason}`)

    console.log('\n[SUCCESS] HTS Stablecoin Micropayment Confirmed On-Chain:')
    console.log(`[LOG] Status:         ${settlement.status}`)
    console.log(`[LOG] Transaction ID: ${settlement.transaction}`)
    console.log(`[EXPLORER] HashScan:  ${getHashscanUrl(settlement.transaction)}`)
    console.log(`[LOG] Agent paid:     ${microUnits} units of ${usdcId}, and no HBAR at all`)

    // 5. Mathematical fee comparison
    console.log('\n===============================================================')
    console.log(`ECONOMIC VIABILITY BENCHMARK: $${costUsd} API INFERENCE`)
    console.log('===============================================================')
    console.log('1. Traditional Rail (Visa/Stripe):')
    console.log('- Fee: $0.30 fixed + 2.9% = $0.3007')
    console.log('- Merchant Net Revenue: -$0.2757 (LOSING 1,100% PER CALL!)')
    console.log('2. Ethereum L1 / Congested L2:')
    console.log('- Gas Fee: $0.40 - $2.50')
    console.log('- Economic Feasibility: IMPOSSIBLE')
    console.log('3. Hedera Token Service + x402:')
    console.log('- Network Fee: ~$0.001 USD fixed, paid by the facilitator')
    console.log('- Merchant Net Revenue: +$0.025 USD (100% of the price)')
    console.log('===============================================================')

    updateState('X402_STABLECOIN_ID', usdcId)

    console.log('\n KEY CONCEPT:')
    console.log('The API priced the call in dollars and was paid in an HTS stablecoin. The')
    console.log('agent spent no HBAR, Hedera enforced the token rules, and the fixed fee makes')
    console.log('per-prompt pricing profitable down to fractions of a cent.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] HTS stablecoin micropayment failed:', error.message)
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
