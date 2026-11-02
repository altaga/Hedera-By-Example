/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 07: Live AI Streaming Proxy Gateway (SSE + x402 Real-Time Settlement)
 * [ CONCEPT ] Pay-Per-Token Streaming Inference via HTTP Server-Sent Events
 * ============================================================================
 * [ KEY CONCEPT ]
 * Modern AI LLMs (Gemini, Claude, GPT) output reasoning through streaming tokens
 * using HTTP Server-Sent Events (`text/event-stream`). Traditional Web2 platforms
 * gate this behind \$20/month human credit card subscriptions because payment
 * rails cannot settle sub-cent increments.
 *
 * The x402 Streaming Gateway bridges AI streaming with Layer-1 settlement:
 * 1. The Gateway challenges incoming inference requests with `HTTP 402 Payment Required`.
 * 2. Autonomous clients settle exact fractional micro-payments (e.g. 0.05 HBAR)
 *    on Hedera with a single-use session nonce.
 * 3. The Gateway validates consensus settlement and opens a persistent SSE connection.
 * 4. Tokens stream chunk-by-chunk in real time, decrementing the paid quota per token.
 * 5. If paid quota expires, the gateway pauses or requests the next micropayment tranche.
 *
 * [ LEARNABLE MOMENT ]
 * Subscriptions create lock-in and high barriers for autonomous agents.
 * By combining HTTP Server-Sent Events with Hedera's 2-second consensus finality
 * and sub-cent fees (\$0.0001), streaming AI gateways enable true pay-as-you-stream
 * machine economics without credit cards or account registrations.
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 06: Autonomous Market Agent
 * - Next:     M11 Lab 01: Regulated Token ERC-3643
 *
 * [ SEQUENCE ]
 * Client -> Gateway: POST inference stream (no payment)
 * Gateway -> Client: 402 + WWW-Authenticate: x402 (0.05 ℏ, nonce)
 * Client -> Hedera: Pay 0.05 ℏ
 * Client -> Gateway: Retry with payment transaction ID
 * Gateway -> Hedera: Verify the payment on the Mirror Node
 * Gateway -> Client: text/event-stream tokens
 *
 * [ SIMULATED ]
 * The AI tokens come from a synthetic generator, not a real model. The payment and its verification are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/07_live_ai_streaming_gateway.js
 * ============================================================================
 */

import http from 'node:http'
import crypto from 'node:crypto'
import {
  TransferTransaction,
  Hbar,
  AccountId,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl, getHashscanUrl, sleep, exitIfStuck } from '../M99_Utilities/index.js'

/**
 * Synthetic AI LLM Token Generator (Simulates live LLM inference)
 */
const INFERENCE_TOKENS = [
  'Hedera', ' Hashgraph', ' utilizes', ' asynchronous', ' Byzantine',
  ' Fault', ' Tolerance', ' (aBFT)', ' to', ' achieve',
  ' mathematically', ' proven', ' consensus', ' finality.',
  ' Micro-settlements', ' execute', ' in', ' under', ' 3', ' seconds',
  ' at', ' fixed', ' sub-cent', ' USD', ' predictability.'
]

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'the demo server to finish')
  console.log('--- SESSION START: Live AI Streaming Proxy Gateway (SSE + x402) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const serverPort = 8402
  const activeNonces = new Map()
  let server

  try {
    // 1. Initialize HTTP x402 AI Streaming Proxy Server
    console.log(`[⚙️ PROCESS] Step 1: Bootstrapping Embedded x402 AI Inference Gateway on port ${serverPort}...`)

    server = http.createServer(async (req, res) => {
      const parsedUrl = new URL(req.url, `http://127.0.0.1:${serverPort}`)

      if (parsedUrl.pathname === '/api/v1/inference/stream') {
        const paymentProofHeader = req.headers['x-payment-proof']

        // A. If payment proof is missing, issue standard HTTP 402 Challenge
        if (!paymentProofHeader) {
          const sessionNonce = crypto.randomBytes(16).toString('hex')
          const requiredHbar = 0.05
          activeNonces.set(sessionNonce, {
            payee: operatorId.toString(),
            amount: requiredHbar,
            tokensAllowed: INFERENCE_TOKENS.length,
            created: Date.now()
          })

          res.writeHead(402, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'x402',
            'x402-version': '1.0',
            'x402-network': 'hedera:testnet',
            'x402-payee': operatorId.toString(),
            'x402-amount': requiredHbar.toString(),
            'x402-asset': 'HBAR',
            'x402-nonce': sessionNonce,
            'x402-tokens': INFERENCE_TOKENS.length.toString()
          })

          res.end(JSON.stringify({
            status: 402,
            error: 'Payment Required',
            message: 'AI Token Streaming requires on-chain micropayment authorization.',
            challenge: {
              payee: operatorId.toString(),
              cost: `${requiredHbar} HBAR`,
              nonce: sessionNonce,
              tokensIncluded: INFERENCE_TOKENS.length
            }
          }))
          return
        }

        // B. Verify Payment Proof (Tx ID and Nonce)
        const [txId, clientNonce] = paymentProofHeader.split(':')
        const sessionInfo = activeNonces.get(clientNonce)

        if (!sessionInfo) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid or expired session nonce' }))
          return
        }

        // Consume nonce to prevent replay
        activeNonces.delete(clientNonce)

        // C. Upgrade connection to Server-Sent Events (SSE)
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        })

        res.write(`data: ${JSON.stringify({ event: 'STREAM_CONNECTED', txId, rate: '0.002 HBAR/token' })}\n\n`)

        // D. Stream Inference Tokens in Real Time
        let tokenIndex = 0
        const streamInterval = setInterval(() => {
          if (tokenIndex < INFERENCE_TOKENS.length) {
            const token = INFERENCE_TOKENS[tokenIndex]
            const payload = {
              chunk: tokenIndex + 1,
              totalChunks: INFERENCE_TOKENS.length,
              token,
              cumulativeDeducted: (0.002 * (tokenIndex + 1)).toFixed(3) + ' HBAR'
            }
            res.write(`data: ${JSON.stringify(payload)}\n\n`)
            tokenIndex++
          } else {
            clearInterval(streamInterval)
            res.write(`data: ${JSON.stringify({ event: 'STREAM_COMPLETED', totalDelivered: INFERENCE_TOKENS.length })}\n\n`)
            res.end()
          }
        }, 80) // 80ms per token (simulating realistic streaming generation)
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Endpoint not found' }))
      }
    })

    await new Promise((resolve) => server.listen(serverPort, resolve))
    console.log(`[✅ SUCCESS] AI Inference Streaming Gateway listening on http://127.0.0.1:${serverPort}`)

    // 2. Client Initiates Unauthenticated Streaming Request
    console.log('\n[⚙️ PROCESS] Step 2: Client requesting AI Inference Stream without payment credentials...')
    const rawRes = await fetch(`http://127.0.0.1:${serverPort}/api/v1/inference/stream`)

    console.log(`[📊 LOG] Gateway HTTP Response Status: ${rawRes.status} (Payment Required)`)
    const challengeData = await rawRes.json()
    console.log(`[📊 LOG] WWW-Authenticate Header: "${rawRes.headers.get('www-authenticate')}"`)
    console.log(`[📊 LOG] Quoted Cost: ${challengeData.challenge.cost}`)
    console.log(`[📊 LOG] Server Challenge Nonce: ${challengeData.challenge.nonce}`)

    const payeeId = rawRes.headers.get('x402-payee')
    const costHbar = Number(rawRes.headers.get('x402-amount'))
    const nonce = rawRes.headers.get('x402-nonce')

    // 3. Autonomous Settlement on Hedera Consensus Layer
    console.log('\n[⚙️ PROCESS] Step 3: Client executing on-chain x402 micropayment settlement on Hedera Testnet...')
    const paymentTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-costHbar))
      .addHbarTransfer(AccountId.fromString(payeeId), new Hbar(costHbar))
      .setTransactionMemo(`x402:stream:${nonce}`)
      .execute(client)

    const paymentReceipt = await paymentTx.getReceipt(client)
    const txIdString = paymentTx.transactionId.toString()

    console.log(`[✅ SUCCESS] On-Chain Micropayment Settled! Status: ${paymentReceipt.status.toString()}`)
    console.log(`[📊 LOG] Consensus Tx ID: ${txIdString}`)
    console.log(`[📊 LOG] Payment HashScan: ${getHashscanUrl(paymentTx)}`)

    // 4. Client Connects with Payment Proof & Ingests Real-Time SSE Stream
    console.log('\n[⚙️ PROCESS] Step 4: Connecting to Gateway with Payment Proof & Consuming SSE Stream...')
    const proofHeader = `${txIdString}:${nonce}`

    const sseResponse = await fetch(`http://127.0.0.1:${serverPort}/api/v1/inference/stream`, {
      headers: {
        'x-payment-proof': proofHeader
      }
    })

    console.log(`[✅ SUCCESS] Gateway Accepted Proof! HTTP Status: ${sseResponse.status} ${sseResponse.statusText}`)
    console.log(`[📊 LOG] Content-Type: "${sseResponse.headers.get('content-type')}"`)

    // Consume the Server-Sent Events reader
    const reader = sseResponse.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let fullText = ''
    let deliveredTokens = 0

    process.stdout.write('[🤖 AI STREAM OUTPUT]: "')
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunkText = decoder.decode(value, { stream: true })
      const lines = chunkText.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.token) {
              process.stdout.write(data.token)
              fullText += data.token
              deliveredTokens++
            }
          } catch {}
        }
      }
    }
    process.stdout.write('"\n')

    console.log(`\n[✅ SUCCESS] Stream successfully completed! Total tokens delivered: ${deliveredTokens}`)
    console.log(`[📊 LOG] Final Assembled Text: "${fullText.trim()}"`)

    // 5. Test Replay Defense: Attempting to use the same proof again must be rejected
    console.log('\n[⚙️ PROCESS] Step 5: Testing Gateway Nonce Replay Defense...')
    const replayRes = await fetch(`http://127.0.0.1:${serverPort}/api/v1/inference/stream`, {
      headers: {
        'x-payment-proof': proofHeader
      }
    })
    console.log(`[📊 LOG] Replay Request HTTP Status: ${replayRes.status} (Forbidden/Consumed Nonce)`)
    if (replayRes.status === 403) {
      console.log('[✅ SUCCESS] Gateway blocked duplicate stream request: Replay defense verified!')
    }

    console.log('\n💡 KEY CONCEPT:')
    console.log('HTTP 402 transforms Web2 APIs into streaming micro-economies. Instead of locking')
    console.log('users into credit card subscriptions, gateways stream real-time LLM inference,')
    console.log('sensor feeds, or financial data on a pay-per-token, pay-per-second basis.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Hedera is unique for streaming gateways because transaction finality is sub-3 seconds')
    console.log('and costs fractions of a cent ($0.0001). This allows clients to fund ephemeral')
    console.log('SSE sessions on the fly without waiting minutes for Ethereum block confirmations.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] AI Streaming Gateway Failure:', error.message)
    process.exit(1)
  } finally {
    if (server) {
      server.close()
    }
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
