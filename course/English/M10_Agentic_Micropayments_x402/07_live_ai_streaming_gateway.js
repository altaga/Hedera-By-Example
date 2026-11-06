/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 07: Paying for an AI Stream in Batches
 * [CONCEPT] x402 pays for credits; the stream spends them
 * ============================================================================
 * [ KEY CONCEPT ]
 * x402's "exact" scheme pays for one HTTP request at a fixed price, but a
 * token stream (Server-Sent Events) is one long response of unknown length.
 * The usual answer is to sell credits.
 *
 * How it works:
 *   1. a paid route sells a session good for N tokens (one x402 payment),
 *   2. a free streaming route spends the session's credits and stops at zero,
 *   3. the agent buys another session when it needs more.
 *
 * The agent here needs 16 tokens and buys two sessions of 8. Each purchase is a
 * separate x402 payment settled on Hedera.
 *
 * [ LEARNABLE MOMENT ]
 * The metering inside the stream is the merchant's own logic, not x402. What
 * x402 guarantees is the purchase: every session was paid before its first
 * token was sent, and each one has its own Hedera receipt.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/how-it-works
 * - https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 06: An Agent That Shops for Data
 * - Next:     M10 Lab 08: Run Your Own Facilitator
 *
 * [ SEQUENCE ]
 * Agent -> Gateway: GET /api/session (x402, 0.01 ℏ)
 * Gateway -> Agent: 200 + session (8 tokens) + PAYMENT-RESPONSE
 * Agent -> Gateway: GET /api/stream?session=… (SSE)
 * Gateway -> Agent: 8 tokens, then "credits_exhausted"
 * Agent -> Gateway: GET /api/session (second x402 payment)
 * Gateway -> Agent: 8 more tokens, then "done"
 *
 * [ SIMULATED ]
 * The "AI" output is canned text sent token by token. The payments and the streaming are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the facilitator.
 * - Practice wallets: ACCOUNT_1 is the agent, ACCOUNT_2 the gateway operator.
 * - Cost: 0.02 ℏ from ACCOUNT_1 to ACCOUNT_2 (two sessions); about 0.006 ℏ in fees for you.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/07_live_ai_streaming_gateway.js
 * ============================================================================
 */

import http from 'node:http'
import crypto from 'node:crypto'
import { x402ResourceServer } from '@x402/core/server'
import { wrapFetchWithPayment } from '@x402/fetch'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HBAR_ASSET_ID } from '@x402/hedera'
import {
  getClient,
  getHashscanUrl,
  ensureFunded,
  show,
  X402_NETWORK,
  createBuyer,
  createLocalFacilitator,
  paywall,
  readPaymentResponse
} from '../M99_Utilities/index.js'

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = 4027
const TOKENS_PER_SESSION = 8
const SESSION_PRICE = '1000000' // 0.01 ℏ per 8 tokens
const ANSWER = 'Hedera settles each x402 payment in a few seconds, so an agent can buy compute in small batches and stop paying the moment it has enough.'.split(/(?= )/)

// ─── Main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- SESSION START: Paying for an AI Stream in Batches ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  if (!agentId || !agentKey || !merchantId) throw new Error('Missing ACCOUNT_1 (agent) or ACCOUNT_2 (merchant). Create practice wallets or set them in .env.')

  let server
  try {
    await ensureFunded(client, agentId, 1)

    // 1. Gateway state: paid sessions and their remaining credits.
    const sessions = new Map() // id -> { credits }
    let position = 0 // where the answer continues (a single conversation in this demo)

    // 2. Paid route: sells a session of TOKENS_PER_SESSION tokens.
    const { client: facilitator } = createLocalFacilitator(operatorId, operatorKey)
    const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactHederaScheme())
    const routes = {
      'GET /api/session': {
        accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: { amount: SESSION_PRICE, asset: HBAR_ASSET_ID } }],
        description: `${TOKENS_PER_SESSION} tokens of streamed inference`
      }
    }
    const sell = paywall(resourceServer, routes, {
      'GET /api/session': () => {
        const id = crypto.randomBytes(8).toString('hex')
        sessions.set(id, { credits: TOKENS_PER_SESSION })
        return { session: id, credits: TOKENS_PER_SESSION, stream: `/api/stream?session=${id}` }
      }
    })

    // 3. Free route: streams tokens while the session has credits (application logic, not x402).
    const stream = (req, res) => {
      const id = new URL(req.url, 'http://127.0.0.1').searchParams.get('session')
      const session = sessions.get(id)
      if (!session) {
        res.writeHead(402, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: 'buy a session at /api/session first' }))
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const timer = setInterval(() => {
        if (position >= ANSWER.length) {
          clearInterval(timer)
          res.write('event: done\ndata: {}\n\n')
          return res.end()
        }
        if (session.credits === 0) {
          clearInterval(timer)
          sessions.delete(id)
          res.write('event: credits_exhausted\ndata: {}\n\n')
          return res.end()
        }
        session.credits--
        res.write(`data: ${JSON.stringify({ token: ANSWER[position++], credits: session.credits })}\n\n`)
      }, 30)
    }
    server = http.createServer((req, res) => (req.url.startsWith('/api/stream') ? stream(req, res) : sell(req, res)))
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

    // 4. Agent: buy a session, read the stream, buy again when credits run out.
    const fetchWithPayment = wrapFetchWithPayment(fetch, createBuyer(agentId, agentKey, { maxTinybars: 2_000_000 }))
    const purchases = []
    let text = ''
    let event = null
    // The agent wants 16 tokens: two sessions, unless the answer ends first.
    while (purchases.length < 2 && event !== 'done') {
      const res = await fetchWithPayment(`http://127.0.0.1:${PORT}/api/session`)
      const receipt = readPaymentResponse(res)
      if (res.status !== 200 || !receipt?.success) throw new Error(`Session purchase failed: ${receipt?.errorReason || res.status}`)
      const { stream: streamPath, credits } = await res.json()
      purchases.push({ purchase: purchases.length + 1, credits, transaction: receipt.transaction })
      console.log(`[SUCCESS] Bought ${credits} tokens: ${getHashscanUrl(receipt.transaction)}`)

      // Read Server-Sent Events: "event: name" lines and "data: json" lines, separated by a blank line.
      const sse = await fetch(`http://127.0.0.1:${PORT}${streamPath}`)
      const reader = sse.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      event = null
      while (!event) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let cut
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          const name = block.match(/^event: (.+)$/m)?.[1]
          if (name) { event = name; continue }
          text += JSON.parse(block.replace(/^data: /, '')).token
        }
      }
      console.log(`[LOG] Stream so far: "${text.trim()}"`)
      console.log(`[LOG] Stream ended with: ${event}`)
    }
    show.table(purchases)

    console.log('\n KEY CONCEPT:')
    console.log('Each batch of tokens was bought with its own x402 payment, settled on')
    console.log('Hedera before the first token was sent. The stream only spends credits')
    console.log('that are already paid for, so neither side carries credit risk.')
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
