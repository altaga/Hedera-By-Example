/* eslint-disable camelcase, no-unused-vars */

import '@x402/fetch' // Node-only: official x402 client stack

/**
 * ============================================================================
 * Lab 07: Live AI Streaming Proxy Gateway (SSE + x402 Real-Time Settlement)
 * [CONCEPT] Official x402 unlock, then non-x402 SSE metering
 * ============================================================================
 * [ KEY CONCEPT ]
 * Official Hedera x402 is a discrete request → pay → response handshake. It is
 * NOT a streaming payment rail. This lab uses x402 once to unlock a session,
 * then streams synthetic tokens over SSE. Per-token metering below is an
 * application pattern — clearly labeled as NON-x402.
 *
 * [ LEARNABLE MOMENT ]
 * Do not claim continuous SSE chunks are individually settled by x402. Unlock
 * with x402; meter afterward in your own app logic if needed.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/how-it-works
 * - https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 06: Autonomous Market Agent
 * - Next:     M10 Lab 08: Facilitated Settlement
 *
 * [SEQUENCE]
 * Client -> Gateway: GET /api/v1/inference/unlock
 * Gateway -> Client: 402 PAYMENT-REQUIRED
 * Client -> Gateway: PAYMENT-SIGNATURE (official x402)
 * Gateway -> Client: 200 + session token
 * Client -> Gateway: GET /api/v1/inference/stream?session=... (NON-x402 SSE)
 *
 * [SIMULATED]
 * Token text is synthetic. The unlock payment is a real x402 settlement.
 *
 * [ BEFORE YOU RUN ]
 * - OPERATOR_ID + MERCHANT_ID
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/07_live_ai_streaming_gateway.js
 * ============================================================================
 */

import {
  createPaidExpressApp,
  listenLocal,
  createPayingFetch,
  decodePaymentResponse,
  getOperatorContext,
  LAB_PRICE_TINYBARS,
  HBAR_ASSET_ID
} from '../M99_Utilities/index.js'
import { updateState } from '../M99_Utilities/storage.js'
import crypto from 'node:crypto'

const TOKENS = ['Hedera', ' x402', ' unlocks', ' the', ' stream;', ' metering', ' after', ' that', ' is', ' app-level.']

const main = async () => {
  console.log('--- SESSION START: x402 unlock + non-x402 SSE ---\n')
  const { operatorId, operatorKey, merchantId } = getOperatorContext()
  const sessions = new Map()

  const { app } = createPaidExpressApp({
    route: 'GET /api/v1/inference/unlock',
    payTo: merchantId,
    price: { amount: LAB_PRICE_TINYBARS.stream, asset: HBAR_ASSET_ID },
    description: 'Unlock AI SSE session',
    handler: (_req, res) => {
      const session = crypto.randomBytes(8).toString('hex')
      sessions.set(session, { created: Date.now(), tokens: TOKENS.length })
      res.json({
        session,
        note: 'SSE metering after this response is NON-x402 application logic',
        streamPath: `/api/v1/inference/stream?session=${session}`
      })
    }
  })

  app.get('/api/v1/inference/stream', (req, res) => {
    const session = req.query.session
    if (!session || !sessions.has(session)) {
      res.status(403).json({ error: 'Missing or invalid session — pay /unlock with x402 first' })
      return
    }
    sessions.delete(session) // single-use
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Metering': 'non-x402-application-level'
    })
    res.write(`data: ${JSON.stringify({ event: 'STREAM_CONNECTED', metering: 'NON_X402' })}\n\n`)
    let i = 0
    const timer = setInterval(() => {
      if (i < TOKENS.length) {
        res.write(`data: ${JSON.stringify({ chunk: i + 1, token: TOKENS[i], metering: 'NON_X402' })}\n\n`)
        i++
      } else {
        clearInterval(timer)
        res.write(`data: ${JSON.stringify({ event: 'STREAM_COMPLETED' })}\n\n`)
        res.end()
      }
    }, 40)
  })

  const { server, baseUrl } = await listenLocal(app, 8402)
  try {
    const fetchPaid = createPayingFetch(operatorId.toString(), operatorKey)
    console.log('[PROCESS] Official x402 unlock...')
    const unlock = await fetchPaid(`${baseUrl}/api/v1/inference/unlock`)
    const settlement = decodePaymentResponse(unlock)
    const body = await unlock.json()
    console.log(`[SUCCESS] Unlock HTTP ${unlock.status}`, settlement)
    console.log('[LOG]', body)

    console.log('[PROCESS] NON-x402 SSE stream with session token...')
    const stream = await fetch(`${baseUrl}${body.streamPath}`)
    const text = await stream.text()
    console.log('[LOG] SSE payload:\n' + text.slice(0, 500))
    updateState('X402_LAB07_TX', settlement?.transaction || '')
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    server.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => process.exit(0)).catch((e) => { console.error('[FAILED]', e.message); process.exit(1) })
}
