/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 07: Pagar un Stream de IA por Lotes
 * [CONCEPTO] x402 paga créditos; el stream los gasta
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El esquema "exact" de x402 paga una petición HTTP a un precio fijo, pero un
 * stream de tokens (Server-Sent Events) es una respuesta larga de duración
 * desconocida. La solución habitual es vender créditos.
 *
 * Cómo funciona:
 *   1. una ruta de pago vende una sesión que vale N tokens (un pago x402),
 *   2. una ruta de streaming gratuita gasta los créditos de la sesión y se detiene en cero,
 *   3. el agente compra otra sesión cuando necesita más.
 *
 * Aquí el agente necesita 16 tokens y compra dos sesiones de 8. Cada compra es un
 * pago x402 distinto liquidado en Hedera.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * La medición dentro del stream es lógica propia del comercio, no x402. Lo que x402
 * garantiza es la compra: cada sesión se pagó antes de enviar su primer token, y
 * cada una tiene su propio recibo en Hedera.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402/how-it-works
 * - https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 06: Un Agente que Compra Datos
 * - Siguiente: M10 Lab 08: Tu Propio Facilitador
 *
 * [ SECUENCIA ]
 * Agente -> Pasarela: GET /api/session (x402, 0.01 ℏ)
 * Pasarela -> Agente: 200 + sesión (8 tokens) + PAYMENT-RESPONSE
 * Agente -> Pasarela: GET /api/stream?session=… (SSE)
 * Pasarela -> Agente: 8 tokens y luego "credits_exhausted"
 * Agente -> Pasarela: GET /api/session (segundo pago x402)
 * Pasarela -> Agente: 8 tokens más y luego el final
 *
 * [ SIMULADO ]
 * La salida de la «IA» es texto fijo enviado token por token. Los pagos y el streaming son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el facilitador.
 * - Wallets de práctica: ACCOUNT_1 es el agente, ACCOUNT_2 opera la pasarela.
 * - Costo: 0.02 ℏ de ACCOUNT_1 a ACCOUNT_2 (dos sesiones); tú pagas unos 0.006 ℏ de comisiones.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/07_live_ai_streaming_gateway.js
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

// ─── Configuración ────────────────────────────────────────────────────────────
const PORT = 4027
const TOKENS_PER_SESSION = 8
const SESSION_PRICE = '1000000' // 0.01 ℏ por 8 tokens
const ANSWER = 'Hedera liquida cada pago x402 en unos segundos, así que un agente puede comprar cómputo en lotes pequeños y dejar de pagar en cuanto tiene suficiente.'.split(/(?= )/)

// ─── Principal ─────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- INICIO DE SESIÓN: Pagar un Stream de IA por Lotes ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  if (!agentId || !agentKey || !merchantId) throw new Error('Falta ACCOUNT_1 (agente) o ACCOUNT_2 (comercio). Crea las wallets de práctica o defínelas en .env.')

  let server
  try {
    await ensureFunded(client, agentId, 1)

    // 1. Estado de la pasarela: sesiones pagadas y sus créditos restantes.
    const sessions = new Map() // id -> { credits }
    let position = 0 // por dónde sigue la respuesta (una sola conversación en esta demo)

    // 2. Ruta de pago: vende una sesión de TOKENS_PER_SESSION tokens.
    const { client: facilitator } = createLocalFacilitator(operatorId, operatorKey)
    const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactHederaScheme())
    const routes = {
      'GET /api/session': {
        accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: { amount: SESSION_PRICE, asset: HBAR_ASSET_ID } }],
        description: `${TOKENS_PER_SESSION} tokens de inferencia por streaming`
      }
    }
    const sell = paywall(resourceServer, routes, {
      'GET /api/session': () => {
        const id = crypto.randomBytes(8).toString('hex')
        sessions.set(id, { credits: TOKENS_PER_SESSION })
        return { session: id, credits: TOKENS_PER_SESSION, stream: `/api/stream?session=${id}` }
      }
    })

    // 3. Ruta gratuita: envía tokens mientras la sesión tenga créditos (lógica de la aplicación, no x402).
    const stream = (req, res) => {
      const id = new URL(req.url, 'http://127.0.0.1').searchParams.get('session')
      const session = sessions.get(id)
      if (!session) {
        res.writeHead(402, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: 'primero compra una sesión en /api/session' }))
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

    // 4. Agente: compra una sesión, lee el stream y vuelve a comprar cuando se acaban los créditos.
    const fetchWithPayment = wrapFetchWithPayment(fetch, createBuyer(agentId, agentKey, { maxTinybars: 2_000_000 }))
    const purchases = []
    let text = ''
    let event = null
    // El agente quiere 16 tokens: dos sesiones, salvo que la respuesta termine antes.
    while (purchases.length < 2 && event !== 'done') {
      const res = await fetchWithPayment(`http://127.0.0.1:${PORT}/api/session`)
      const receipt = readPaymentResponse(res)
      if (res.status !== 200 || !receipt?.success) throw new Error(`Falló la compra de la sesión: ${receipt?.errorReason || res.status}`)
      const { stream: streamPath, credits } = await res.json()
      purchases.push({ compra: purchases.length + 1, creditos: credits, transaccion: receipt.transaction })
      console.log(`[ÉXITO] Comprados ${credits} tokens: ${getHashscanUrl(receipt.transaction)}`)

      // Leer Server-Sent Events: líneas "event: nombre" y "data: json", separadas por una línea en blanco.
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
      console.log(`[REGISTRO] Stream hasta ahora: "${text.trim()}"`)
      console.log(`[REGISTRO] El stream terminó con: ${event}`)
    }
    show.table(purchases)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Cada lote de tokens se compró con su propio pago x402, liquidado en Hedera')
    console.log('antes de enviar el primer token. El stream solo gasta créditos ya pagados,')
    console.log('así que ninguna de las partes asume riesgo de crédito.')
    console.log('\n--- SESIÓN COMPLETADA ---')
  } finally {
    server?.close()
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLÓ] Error de ejecución:', error.message)
      process.exit(1)
    })
}
