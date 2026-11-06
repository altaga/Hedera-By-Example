/**
 * ============================================================================
 * Lab 07: Pasarela Proxy de Streaming de IA (SSE + Liquidación x402)
 * [CONCEPTO] Inferencia por Streaming Pagada por Sesión mediante HTTP Server-Sent Events
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Los LLM modernos transmiten sus respuestas token por token con HTTP
 * Server-Sent Events (`text/event-stream`). Las plataformas Web2 lo bloquean tras
 * suscripciones mensuales porque los rieles de tarjeta no liquidan montos de
 * fracciones de centavo. Una pasarela de streaming x402 responde la primera
 * petición con 402, el cliente paga con PAYMENT-SIGNATURE, la pasarela liquida el
 * pago en Hedera mediante su facilitador y solo entonces abre el stream, con el
 * recibo en la cabecera PAYMENT-RESPONSE.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * La finalidad de Hedera en segundos y una comisión fija de fracciones de centavo permiten que un cliente pague un stream efímero al momento, sin cuenta ni suscripción. La pasarela no necesita una tabla de nonces: una PAYMENT-SIGNATURE repetida falla al liquidar con DUPLICATE_TRANSACTION.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 06: Agente de Mercado Autónomo
 * - Siguiente: M10 Lab 08: Liquidación entre Dos Partes (el Comercio como Facilitador)
 *
 * [SECUENCIA]
 * Cliente -> Pasarela: GET stream de inferencia (sin pago)
 * Pasarela -> Cliente: 402 + PAYMENT-REQUIRED (0.01 ℏ)
 * Nota Cliente: Firma la transferencia (Lab 02)
 * Cliente -> Pasarela: Reintenta con PAYMENT-SIGNATURE
 * Pasarela -> Hedera: El facilitador firma y envía (Lab 03)
 * Pasarela -> Cliente: 200 + PAYMENT-RESPONSE, luego tokens text/event-stream
 *
 * [SIMULADO]
 * Los tokens de IA vienen de un generador sintético, no de un modelo real. La pasarela corre en el mismo proceso. El pago es real.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el facilitador de la pasarela (paga la comisión de red).
 * - Wallets de práctica: ACCOUNT_1 (cliente) paga a ACCOUNT_2 (dueño de la pasarela).
 * - Costo: <0.1 ℏ (solo comisiones de red); 0.01 ℏ pasa entre las wallets de práctica.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/07_live_ai_streaming_gateway.js
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
 * Generador sintético de tokens de un LLM (simula una inferencia en vivo)
 */
const INFERENCE_TOKENS = [
  'Hedera', ' Hashgraph', ' usa', ' tolerancia', ' a',
  ' fallas', ' bizantinas', ' asíncrona', ' (aBFT)', ' para',
  ' alcanzar', ' finalidad', ' probada.', ' Los', ' micropagos',
  ' se', ' liquidan', ' en', ' segundos', ' con', ' comisiones', ' fijas.'
]

const main = async () => {
  // Nunca quedarse colgado: falla con un mensaje claro si la red no responde.
  exitIfStuck(180_000, 'que termine la pasarela de demostración')
  console.log('--- INICIO DE SESIÓN: Pasarela Proxy de Streaming de IA (SSE + x402) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const clientId = process.env.ACCOUNT_1_ID
  const clientKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const gatewayOwner = process.env.ACCOUNT_2_ID
  const serverPort = 8402
  const streamPath = '/api/v1/inference/stream'
  let server

  if (!clientId || !clientKey || !gatewayOwner) {
    console.error('[FALLÓ] Faltan credenciales en .env (ACCOUNT_1 cliente, ACCOUNT_2 dueño de la pasarela).')
    process.exitCode = 1
    return
  }

  try {
    await ensureFunded(client, clientId, 1)

    // 1. Inicializar la pasarela de streaming de IA x402
    console.log(`[PROCESO] Paso 1: Levantando la pasarela de inferencia x402 en el puerto ${serverPort}...`)
    server = http.createServer(async (req, res) => {
      if (new URL(req.url, 'http://127.0.0.1').pathname !== streamPath) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: 'Endpoint no encontrado' }))
      }

      // A. Sin pago: responder 402 con las condiciones en PAYMENT-REQUIRED
      const paymentHeader = req.headers['payment-signature']
      if (!paymentHeader) {
        const paymentRequired = createPaymentRequired({
          resource: streamPath,
          description: `${INFERENCE_TOKENS.length} tokens de inferencia por streaming`,
          payTo: gatewayOwner,
          amount: 1_000_000, // 0.01 HBAR por stream
          feePayer: operatorId.toString()
        })
        res.writeHead(402, { 'Content-Type': 'application/json', 'PAYMENT-REQUIRED': encodeHeader(paymentRequired) })
        return res.end(JSON.stringify(paymentRequired))
      }

      // B. Con pago: el facilitador de la pasarela lo verifica y lo liquida en Hedera
      const settlement = await settleExactPayment(client, decodeHeader(paymentHeader), operatorKey)
      if (!settlement.success) {
        res.writeHead(402, { 'Content-Type': 'application/json', 'PAYMENT-RESPONSE': encodeHeader(settlement) })
        return res.end(JSON.stringify({ error: 'settlement_failed', reason: settlement.errorReason }))
      }

      // C. Liquidado: abrir el stream Server-Sent Events, con el recibo en PAYMENT-RESPONSE
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'PAYMENT-RESPONSE': encodeHeader(settlement)
      })
      // D. Transmitir los tokens de inferencia en tiempo real
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
      }, 80) // 80 ms por token, como un modelo generando texto
    })
    await new Promise((resolve) => server.listen(serverPort, '127.0.0.1', resolve))
    console.log(`[ÉXITO] Pasarela de streaming de IA escuchando en http://127.0.0.1:${serverPort}`)

    // 2. El cliente pide el stream sin pagar
    console.log('\n[PROCESO] Paso 2: El cliente pide el stream de inferencia sin pago...')
    const rawRes = await fetch(`http://127.0.0.1:${serverPort}${streamPath}`)
    const paymentRequired = decodeHeader(rawRes.headers.get('payment-required'))
    const accept = paymentRequired.accepts[0]
    console.log(`[REGISTRO] Estado HTTP de la pasarela: ${rawRes.status} (Payment Required)`)
    console.log(`[REGISTRO] Costo cotizado: ${Number(accept.amount) / 1e8} HBAR a ${accept.payTo}, comisión a cargo de ${accept.extra.feePayer}`)

    // 3. El cliente firma el pago (no lo envía)
    console.log('\n[PROCESO] Paso 3: El cliente firma el pago x402...')
    const payment = await signExactPayment(client, paymentRequired, clientId, clientKey)
    const paymentSignature = encodeHeader(payment)
    console.log(`[REGISTRO] PAYMENT-SIGNATURE: ${paymentSignature.substring(0, 48)}...`)

    // 4. El cliente reintenta con el pago y consume el stream SSE
    console.log('\n[PROCESO] Paso 4: Reintentando con PAYMENT-SIGNATURE y consumiendo el stream SSE...')
    const sseResponse = await fetch(`http://127.0.0.1:${serverPort}${streamPath}`, { headers: { 'PAYMENT-SIGNATURE': paymentSignature } })
    const settlement = decodeHeader(sseResponse.headers.get('payment-response'))
    console.log(`[ÉXITO] ¡La pasarela liquidó el pago! Estado HTTP: ${sseResponse.status}`)
    console.log(`[REGISTRO] Content-Type: "${sseResponse.headers.get('content-type')}"`)
    console.log(`[REGISTRO] Id de la liquidación: ${settlement.transaction}`)
    console.log(`[EXPLORADOR] HashScan: ${getHashscanUrl(settlement.transaction)}`)

    // Leer los Server-Sent Events: cada bloque "data: {...}" termina con una línea en blanco
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
    console.log(`[ÉXITO] ¡Stream completado! Tokens entregados: ${deliveredTokens}`)
    console.log(`[REGISTRO] SALIDA DEL STREAM DE IA: "${fullText}"`)

    // 5. Defensa contra repeticiones: la misma PAYMENT-SIGNATURE no debe abrir un segundo stream
    console.log('\n[PROCESO] Paso 5: Reenviando la misma PAYMENT-SIGNATURE...')
    const replayRes = await fetch(`http://127.0.0.1:${serverPort}${streamPath}`, { headers: { 'PAYMENT-SIGNATURE': paymentSignature } })
    const replayBody = await replayRes.json()
    console.log(`[REGISTRO] Estado HTTP de la repetición: ${replayRes.status} (${replayBody.reason})`)
    if (replayRes.status !== 402) throw new Error('La pasarela aceptó un pago repetido.')
    console.log('[ÉXITO] La pasarela negó el stream duplicado: Hedera rechazó la transacción reutilizada.')

    console.log('\n CONCEPTO CLAVE:')
    console.log('HTTP 402 convierte las APIs de streaming en micro-economías. En vez de una')
    console.log('suscripción mensual, el cliente pagó 0.01 HBAR por este stream, la pasarela vio')
    console.log('la liquidación en Hedera antes del primer token y una repetición no obtuvo nada.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLÓ] Falla de la pasarela de streaming de IA:', error.message)
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
      console.error('[FALLÓ] Error de ejecución:', error.message)
      process.exit(1)
    })
}
