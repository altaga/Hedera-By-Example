/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 04: Pricing in Dollars with an HTS Stablecoin
 * [CONCEPT] Quote "$0.01" and settle it in a native HTS token
 * ============================================================================
 * [ KEY CONCEPT ]
 * APIs think in dollars, not in HBAR. An x402 route can be priced as money
 * ("$0.01"): the server scheme converts it into the smallest unit of a
 * stablecoin (USDC has 6 decimals, so $0.01 = 10000 units) and the buyer signs
 * an HTS token transfer instead of an HBAR transfer. Everything else is the
 * same as Lab 03: the facilitator verifies, pays the HBAR fee and submits.
 *
 * The official default on Hedera testnet is Circle's USDC (0.0.429274). Most
 * practice accounts hold none, so this lab uses the course's own 6-decimal test
 * dollar (tUSD) unless your agent already holds testnet USDC.
 *
 * From this lab on the agent uses wrapFetchWithPayment from @x402/fetch: one
 * fetch() that does Lab 03's two requests (402, sign, retry) for you.
 *
 * [ LEARNABLE MOMENT ]
 * HTS rules still apply inside x402: the merchant must be associated with the
 * token or the transfer cannot land, and the facilitator's preflight rejects the
 * payment before it is submitted. The buyer's client also refuses tokens it was
 * not told about, so a server cannot make it pay in an unexpected asset.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/merchant-integration
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/associate-tokens-to-an-account
 * - https://faucet.circle.com/
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 03: The Facilitator Settles on Hedera
 * - Next:     M10 Lab 05: Spending Guardrails for Agents
 *
 * [ SEQUENCE ]
 * Agent -> Server: GET /api/translate
 * Server -> Agent: 402 (price "$0.01" = 10000 units of a 6-decimal token)
 * Note Agent: signs an HTS token transfer (no HBAR leaves the agent)
 * Agent -> Server: retry with PAYMENT-SIGNATURE
 * Server -> Facilitator: verify (merchant associated?) then settle
 * Facilitator -> Hedera: token transfer, fee paid in HBAR by the facilitator
 * Server -> Agent: 200 + PAYMENT-RESPONSE
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the facilitator and the test dollar's treasury.
 * - Practice wallets: ACCOUNT_1 is the agent, ACCOUNT_2 the merchant.
 * - Cost: first run about 1.1 USD in ℏ (create tUSD, two associations); later runs about 0.001 USD.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/04_usdc_hts_micropayments.js
 * ============================================================================
 */

import http from 'node:http'
import { TokenAssociateTransaction, TokenCreateTransaction, TransferTransaction } from '@hiero-ledger/sdk'
import { x402ResourceServer } from '@x402/core/server'
import { wrapFetchWithPayment } from '@x402/fetch'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HEDERA_TESTNET_USDC, HEDERA_USDC_DECIMALS } from '@x402/hedera'
import {
  getClient,
  getHashscanUrl,
  getMirrorNodeBaseUrl,
  reuseToken,
  waitForMirror,
  updateState,
  show,
  X402_NETWORK,
  createBuyer,
  createLocalFacilitator,
  paywall,
  readPaymentRequired,
  readPaymentResponse,
  toPrivateKey
} from '../M99_Utilities/index.js'

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = 4024
const ROUTE = '/api/translate'
const PRICE = '$0.01'

/** Balance of `tokenId` held by `accountId` (smallest units), or null when not associated. */
const tokenBalance = async (accountId, tokenId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`)
  const row = res.ok ? (await res.json()).tokens?.[0] : null
  return row ? BigInt(row.balance) : null
}

/** Associates `accountId` with `tokenId` unless it already is (the account signs, the operator pays). */
const ensureAssociated = async (client, accountId, accountKey, tokenId) => {
  if (await tokenBalance(accountId, tokenId) !== null) return
  console.log(`[PROCESS] Associating ${accountId} with ${tokenId}...`)
  const tx = await new TokenAssociateTransaction().setAccountId(accountId).setTokenIds([tokenId]).freezeWith(client).sign(toPrivateKey(accountKey))
  await (await tx.execute(client)).getReceipt(client)
}

// ─── Main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- SESSION START: Pricing in Dollars with an HTS Stablecoin ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  const merchantKey = process.env.ACCOUNT_2_PRIVATE_KEY
  if (!agentId || !agentKey || !merchantId || !merchantKey) throw new Error('Missing ACCOUNT_1 (agent) or ACCOUNT_2 (merchant). Create practice wallets or set them in .env.')

  let server
  try {
    // 1. Pick the stablecoin: official testnet USDC if the agent holds some, else the course's tUSD.
    const usdcBalance = await tokenBalance(agentId, HEDERA_TESTNET_USDC)
    let tokenId
    if (usdcBalance !== null && usdcBalance >= 10_000n) {
      tokenId = HEDERA_TESTNET_USDC
      console.log(`[INFO] Agent holds official testnet USDC (${HEDERA_TESTNET_USDC}): using it.`)
    } else {
      console.log(`[INFO] Agent holds no testnet USDC (${HEDERA_TESTNET_USDC}); using the course test dollar instead.`)
      tokenId = (await reuseToken('REUSE_M10_04_TUSD', async () => {
        const tx = await new TokenCreateTransaction()
          .setTokenName('Course Test Dollar')
          .setTokenSymbol('tUSD')
          .setDecimals(HEDERA_USDC_DECIMALS) // 6, like USDC
          .setInitialSupply(1_000_000 * 10 ** HEDERA_USDC_DECIMALS)
          .setTreasuryAccountId(operatorId)
          .execute(client)
        return (await tx.getReceipt(client)).tokenId
      }, { minBalance: 10 ** HEDERA_USDC_DECIMALS })).toString()
      console.log(`[INFO] Test dollar: ${tokenId}`)
    }

    // 2. HTS rules: both sides must be associated with the token, and the agent needs a balance.
    await ensureAssociated(client, merchantId, merchantKey, tokenId)
    if (tokenId !== HEDERA_TESTNET_USDC) {
      await ensureAssociated(client, agentId, agentKey, tokenId)
      if ((await tokenBalance(agentId, tokenId)) < 100_000n) {
        console.log('[PROCESS] Sending the agent 1 tUSD to spend...')
        const fund = await new TransferTransaction()
          .addTokenTransfer(tokenId, operatorId, -1_000_000)
          .addTokenTransfer(tokenId, agentId, 1_000_000)
          .execute(client)
        await fund.getReceipt(client)
      }
    }
    // The facilitator checks balances and associations on the Mirror Node, which lags consensus by a few seconds.
    await waitForMirror(async () => (await tokenBalance(agentId, tokenId)) >= 10_000n && (await tokenBalance(merchantId, tokenId)) !== null)

    // 3. Server: price the route in dollars. The scheme maps "$" to this token and its decimals.
    const { client: facilitator } = createLocalFacilitator(operatorId, operatorKey)
    const scheme = new ExactHederaScheme({ defaultAssets: { [X402_NETWORK]: { asset: tokenId, decimals: HEDERA_USDC_DECIMALS } } })
    const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, scheme)
    const routes = {
      [`GET ${ROUTE}`]: {
        accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: PRICE }],
        description: 'Translate one paragraph'
      }
    }
    const handlers = { [`GET ${ROUTE}`]: (_req, url) => ({ text: url.searchParams.get('q'), es: 'Hola, mundo' }) }
    server = http.createServer(paywall(resourceServer, routes, handlers))
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${PORT}${ROUTE}?q=Hello%2C%20world`

    const offer = readPaymentRequired(await fetch(url)).accepts[0]
    console.log(`\n[LOG] 402 terms: ${PRICE} → amount ${offer.amount} of asset ${offer.asset}`)

    // 4. Agent: allow this token (the official USDC is allowed by default, capped at $1), then fetch.
    const agent = createBuyer(agentId, agentKey, { tokens: [{ asset: tokenId, maxAmountPerPayment: '50000' }] })
    const fetchWithPayment = wrapFetchWithPayment(fetch, agent)
    console.log(`[PROCESS] Agent: fetchWithPayment(${ROUTE})`)
    const res = await fetchWithPayment(url)
    const receipt = readPaymentResponse(res)
    console.log(`[SUCCESS] HTTP ${res.status}, body: ${JSON.stringify(await res.json())}`)
    if (res.status !== 200 || !receipt?.success) throw new Error(`Payment was not settled: ${receipt?.errorReason || res.status}`)
    console.log(`[LOG] Settled: ${receipt.transaction}`)
    console.log(`[LOG] View on HashScan: ${getHashscanUrl(receipt.transaction)}`)

    // 5. What moved, according to the Mirror Node: token units between agent and merchant, HBAR only for the fee.
    const mirrorId = receipt.transaction.replace('@', '-').replace(/\.(\d+)$/, '-$1')
    const record = await waitForMirror(async () => {
      const r = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions/${mirrorId}`)
      return r.ok ? (await r.json()).transactions?.[0] : null
    })
    if (record) {
      const role = (id) => (id === agentId ? 'agent' : id === merchantId ? 'merchant' : 'other')
      show.table(record.token_transfers.map((t) => ({ role: role(t.account), account: t.account, token: t.token_id, units: t.amount, dollars: (t.amount / 10 ** HEDERA_USDC_DECIMALS).toFixed(6) })))
      console.log(`[LOG] Network fee ${(record.charged_tx_fee / 1e8).toFixed(8)} ℏ, paid by ${record.transaction_id.split('-')[0]} (the facilitator)`)
    }
    updateState('X402_STABLECOIN_ID', tokenId)

    console.log('\n KEY CONCEPT:')
    console.log('The API quoted a price in dollars and was paid in an HTS token. The agent')
    console.log('needed no HBAR at all: the facilitator paid the network fee, and Hedera')
    console.log('enforced the token rules (association, balance) before anything moved.')
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    server?.close()
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
