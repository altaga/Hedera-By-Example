/**
 * ============================================================================
 * Lab 07: Live AI Streaming Proxy Gateway (SSE + x402 Settlement)
 * [CONCEPT] Pay-Per-Stream Inference via HTTP Server-Sent Events
 * ============================================================================
 * [ KEY CONCEPT ]
 * Modern LLMs stream their answers token by token with HTTP Server-Sent Events
 * (`text/event-stream`). Web2 platforms gate this behind monthly subscriptions
 * because card rails cannot settle sub-cent amounts. An x402 streaming gateway
 * answers the first request with 402, the client pays with PAYMENT-SIGNATURE,
 * the gateway settles the payment on Hedera through its facilitator, and only
 * then opens the stream, with the receipt in the PAYMENT-RESPONSE header.
 * *
 * [ LEARNABLE MOMENT ]
 * Hedera finality in a few seconds and a fixed sub-cent fee let a client fund an ephemeral stream on the fly, with no account or subscription. The gateway needs no nonce table: a replayed PAYMENT-SIGNATURE fails at settlement with DUPLICATE_TRANSACTION.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 06: Autonomous Market Agent
 * - Next:     M10 Lab 08: Two-Party Settlement (Merchant as Facilitator)
 *
 * [SEQUENCE]
 * Client -> Gateway: GET inference stream (no payment)
 * Gateway -> Client: 402 + PAYMENT-REQUIRED (0.01 ℏ)
 * Note Client: Signs the transfer (Lab 02)
 * Client -> Gateway: Retry with PAYMENT-SIGNATURE
 * Gateway -> Hedera: Facilitator co-signs and submits (Lab 03)
 * Gateway -> Client: 200 + PAYMENT-RESPONSE, then text/event-stream tokens
 *
 * [SIMULATED]
 * The AI tokens come from a synthetic generator, not a real model. The gateway runs in the same process. The payment is real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the gateway's facilitator (it pays the network fee).
 * - Practice wallets: ACCOUNT_1 (client) pays ACCOUNT_2 (gateway operator).
 * - Cost: <0.1 ℏ (network fees only); 0.01 ℏ moves between the practice wallets.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/07_live_ai_streaming_gateway.js
 * ============================================================================
 */

import http from 'node:http'
import {
  getClient,
  getHashscanUrl,
  ensureFunded,
  exitIfStuck,
  encodeHeader,
  decodeHeader,
  createPaymentRequired,
  signExactPayment,
  settleExactPayment
} from '../M99_Utilities/index.js'

/**
 * Synthetic AI LLM Token Generator (Simulates live LLM inference)
 */
const INFERENCE_TOKENS = [
  'Hedera', ' Hashgraph', ' uses', ' asynchronous', ' Byzantine',
  ' Fault', ' Tolerance', ' (aBFT)', ' to', ' reach',
  ' proven', ' consensus', ' finality.', ' Micro-settlements', ' execute',
  ' in', ' seconds', ' at', ' fixed', ' sub-cent', ' fees.'
]

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'the demo gateway to finish')
  console.log('--- SESSION START: Live AI Streaming Proxy Gateway (SSE + x402) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const clientId = process.env.ACCOUNT_1_ID
  const clientKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const gatewayOwner = process.env.ACCOUNT_2_ID
  const serverPort = 8402
  const streamPath = '/api/v1/inference/stream'
  let server

  if (!clientId || !clientKey || !gatewayOwner) {
    console.error('[FAILED] Missing credentials in .env (ACCOUNT_1 client, ACCOUNT_2 gateway owner).')
    process.exitCode = 1
    return
  }

  try {
    await ensureFunded(client, clientId, 1)

    // 1. Initialize the x402 AI streaming gateway
    console.log(`[PROCESS] Step 1: Bootstrapping Embedded x402 AI Inference Gateway on port ${serverPort}...`)
    server = http.createServer(async (req, res) => {
      if (new URL(req.url, 'http://127.0.0.1').pathname !== streamPath) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: 'Endpoint not found' }))
      }

      // A. No payment: answer 402 with the terms in PAYMENT-REQUIRED
      const paymentHeader = req.headers['payment-signature']
      if (!paymentHeader) {
        const paymentRequired = createPaymentRequired({
          resource: streamPath,
          description: `${INFERENCE_TOKENS.length} tokens of streamed inference`,
          payTo: gatewayOwner,
          amount: 1_000_000, // 0.01 HBAR per stream
          feePayer: operatorId.toString()
        })
        res.writeHead(402, { 'Content-Type': 'application/json', 'PAYMENT-REQUIRED': encodeHeader(paymentRequired) })
        return res.end(JSON.stringify(paymentRequired))
      }

      // B. Payment present: the gateway's facilitator verifies and settles it on Hedera
      const settlement = await settleExactPayment(client, decodeHeader(paymentHeader), operatorKey)
      if (!settlement.success) {
        res.writeHead(402, { 'Content-Type': 'application/json', 'PAYMENT-RESPONSE': encodeHeader(settlement) })
        return res.end(JSON.stringify({ error: 'settlement_failed', reason: settlement.errorReason }))
      }

      // C. Settled: open the Server-Sent Events stream, receipt in PAYMENT-RESPONSE
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'PAYMENT-RESPONSE': encodeHeader(settlement)
      })
      // D. Stream inference tokens in real time
      let tokenIndex = 0
      const streamInterval = setInterval(() => {
        if (tokenIndex < INFERENCE_TOKENS.length) {
          res.write(`data: ${JSON.stringify({ chunk: tokenIndex + 1, totalChunks: INFERENCE_TOKENS.length, token: INFERENCE_TOKENS[tokenIndex] })}\n\n`)
          tokenIndex++
        } else {
          clearInterval(streamInterval)
          res.write(`data: ${JSON.stringify({ event: 'STREAM_COMPLETED', totalDelivered: INFERENCE_TOKENS.length })}\n\n`)
          res.end()
        }
      }, 80) // 80 ms per token, like a model generating text
    })
    await new Promise((resolve) => server.listen(serverPort, '127.0.0.1', resolve))
    console.log(`[SUCCESS] AI Inference Streaming Gateway listening on http://127.0.0.1:${serverPort}`)

    // 2. Client requests the stream without paying
    console.log('\n[PROCESS] Step 2: Client requesting AI Inference Stream without payment...')
    const rawRes = await fetch(`http://127.0.0.1:${serverPort}${streamPath}`)
    const paymentRequired = decodeHeader(rawRes.headers.get('payment-required'))
    const accept = paymentRequired.accepts[0]
    console.log(`[LOG] Gateway HTTP Response Status: ${rawRes.status} (Payment Required)`)
    console.log(`[LOG] Quoted Cost: ${Number(accept.amount) / 1e8} HBAR to ${accept.payTo}, fee payer ${accept.extra.feePayer}`)

    // 3. Client signs the payment (it does not submit it)
    console.log('\n[PROCESS] Step 3: Client signing the x402 payment...')
    const payment = await signExactPayment(client, paymentRequired, clientId, clientKey)
    const paymentSignature = encodeHeader(payment)
    console.log(`[LOG] PAYMENT-SIGNATURE: ${paymentSignature.substring(0, 48)}...`)

    // 4. Client retries with the payment and consumes the SSE stream
    console.log('\n[PROCESS] Step 4: Retrying with PAYMENT-SIGNATURE and consuming the SSE stream...')
    const sseResponse = await fetch(`http://127.0.0.1:${serverPort}${streamPath}`, { headers: { 'PAYMENT-SIGNATURE': paymentSignature } })
    const settlement = decodeHeader(sseResponse.headers.get('payment-response'))
    console.log(`[SUCCESS] Gateway settled the payment! HTTP Status: ${sseResponse.status}`)
    console.log(`[LOG] Content-Type: "${sseResponse.headers.get('content-type')}"`)
    console.log(`[LOG] Settlement Tx ID: ${settlement.transaction}`)
    console.log(`[EXPLORER] HashScan: ${getHashscanUrl(settlement.transaction)}`)

    // Read the Server-Sent Events: each "data: {...}" block ends with a blank line
    const reader = sseResponse.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let fullText = ''
    let deliveredTokens = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop()
      for (const event of events) {
        const data = JSON.parse(event.replace(/^data: /, ''))
        if (data.token) {
          fullText += data.token
          deliveredTokens++
        }
      }
    }
    console.log(`[SUCCESS] Stream completed! Total tokens delivered: ${deliveredTokens}`)
    console.log(`[LOG] AI STREAM OUTPUT: "${fullText}"`)

    // 5. Replay defense: the same PAYMENT-SIGNATURE must not open a second stream
    console.log('\n[PROCESS] Step 5: Replaying the same PAYMENT-SIGNATURE...')
    const replayRes = await fetch(`http://127.0.0.1:${serverPort}${streamPath}`, { headers: { 'PAYMENT-SIGNATURE': paymentSignature } })
    const replayBody = await replayRes.json()
    console.log(`[LOG] Replay Request HTTP Status: ${replayRes.status} (${replayBody.reason})`)
    if (replayRes.status !== 402) throw new Error('The gateway accepted a replayed payment.')
    console.log('[SUCCESS] Gateway refused the duplicate stream: Hedera rejected the reused transaction.')

    console.log('\n KEY CONCEPT:')
    console.log('HTTP 402 turns streaming APIs into micro-economies. Instead of a monthly')
    console.log('subscription, the client paid 0.01 HBAR for this one stream, the gateway saw')
    console.log('the settlement on Hedera before the first token, and a replay got nothing.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] AI Streaming Gateway Failure:', error.message)
    process.exitCode = 1
  } finally {
    if (server) server.close()
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
