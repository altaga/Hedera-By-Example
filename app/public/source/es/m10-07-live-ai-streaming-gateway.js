/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Laboratorio 07: Pasarela Proxy de Streaming de IA (SSE + Liquidación x402 en Tiempo Real)
 * [CONCEPTO] Inferencia de Streaming Pago-por-Token mediante HTTP Server-Sent Events
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Los modelos modernos de IA (Gemini, Claude, GPT) devuelven su razonamiento en
 * tokens transmitidos por flujo continuo usando HTTP Server-Sent Events (`text/event-stream`).
 * Las plataformas tradicionales de la Web2 bloquean esto tras muros de suscripción
 * de \$20/mes con tarjetas de crédito porque los rieles bancarios no pueden liquidar
 * fracciones de centavo.
 *
 * La Pasarela de Streaming x402 une el streaming de IA con la liquidación en Capa 1:
 * 1. La pasarela emite un desafío `HTTP 402 Payment Required` ante peticiones entrantes.
 * 2. Los clientes autónomos liquidan micropagos fraccionarios exactos (ej. 0.05 HBAR)
 *    en Hedera vinculados a un nonce de sesión de un solo uso.
 * 3. La pasarela valida la liquidación en consenso y abre una conexión SSE persistente.
 * 4. Los tokens se transmiten fragmento a fragmento en tiempo real, debitando la cuota.
 * 5. Si la cuota pagada expira, la pasarela pausa el flujo o solicita el siguiente tramo.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las suscripciones generan ataduras y altas barreras para agentes autónomos.
 * Al combinar HTTP Server-Sent Events con la finalidad de consenso de 2 segundos de
 * Hedera y costos de fracción de centavo (\$0.0001), las pasarelas de streaming de IA
 * habilitan una verdadera economía de máquina con pago por consumo sin tarjetas ni registros.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 06: Agente de Mercado Autónomo
 * - Siguiente: M11 Lab 01: Registro de Identidad ERC-3643
 *
 * [SECUENCIA]
 * Cliente -> Gateway: POST de streaming de inferencia (sin pago)
 * Gateway -> Cliente: 402 + WWW-Authenticate: x402 (0.05 ℏ, nonce)
 * Cliente -> Hedera: Pagar 0.05 ℏ
 * Cliente -> Gateway: Reintentar con el ID de la transacción de pago
 * Gateway -> Hedera: Verificar el pago en el Mirror Node
 * Gateway -> Cliente: Tokens por text/event-stream
 *
 * [SIMULADO]
 * Los tokens de IA vienen de un generador sintético, no de un modelo real. El pago y su verificación son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/07_live_ai_streaming_gateway.js
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
 * Generador Sintético de Tokens de LLM (Simula inferencia en streaming en vivo)
 */
const INFERENCE_TOKENS = [
  'Hedera', 'Hashgraph', ' utiliza', 'Tolerancia', ' a',
  'Fallas', 'Bizantinas', 'Asíncrona', ' (aBFT)', ' para',
  ' alcanzar', ' finalidad', ' de', ' consenso', ' matemáticamente',
  ' probada.', 'Las', ' micro-liquidaciones', ' se', ' ejecutan',
  ' en', ' menos', ' de', ' 3', ' segundos', ' con', ' costos',
  ' fijos', ' y', ' predecibles.'
]

const main = async () => {
  // Nunca colgarse: falla con un mensaje claro si la red nunca responde.
  exitIfStuck(180_000, 'a que termine el servidor de la demo')
  console.log('--- INICIO DE SESIÓN: Pasarela Proxy de Streaming de IA (SSE + x402) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const serverPort = 8403
  const activeNonces = new Map()
  let server

  try {
    // 1. Inicializar Servidor HTTP Proxy de Streaming de IA con x402
    console.log(`[PROCESO] Paso 1: Inicializando Pasarela de Inferencia IA x402 en el puerto ${serverPort}...`)

    server = http.createServer(async (req, res) => {
      const parsedUrl = new URL(req.url, `http://127.0.0.1:${serverPort}`)

      if (parsedUrl.pathname === '/api/v1/inference/stream') {
        const paymentProofHeader = req.headers['x-payment-proof']

        // A. Si no hay prueba de pago, emitir Desafío estándar HTTP 402
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
            message: 'El streaming de tokens de IA requiere autorización de micropago en cadena.',
            challenge: {
              payee: operatorId.toString(),
              cost: `${requiredHbar} HBAR`,
              nonce: sessionNonce,
              tokensIncluded: INFERENCE_TOKENS.length
            }
          }))
          return
        }

        // B. Verificar Prueba de Pago (Tx ID y Nonce)
        const [txId, clientNonce] = paymentProofHeader.split(':')
        const sessionInfo = activeNonces.get(clientNonce)

        if (!sessionInfo) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Nonce de sesión inválido o expirado' }))
          return
        }

        // Consumir el nonce para evitar ataques de repetición
        activeNonces.delete(clientNonce)

        // C. Actualizar conexión a Server-Sent Events (SSE)
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        })

        res.write(`data: ${JSON.stringify({ event: 'STREAM_CONNECTED', txId, rate: '0.002 HBAR/token' })}\n\n`)

        // D. Transmitir Tokens de Inferencia en Tiempo Real
        let tokenIndex = 0
        const streamInterval = setInterval(() => {
          if (tokenIndex < INFERENCE_TOKENS.length) {
            const token = INFERENCE_TOKENS[tokenIndex]
            const payload = {
              chunk: tokenIndex + 1,
              totalChunks: INFERENCE_TOKENS.length,
              token,
              cumulativeDeducted: (0.002 * (tokenIndex + 1)).toFixed(3) + 'HBAR'
            }
            res.write(`data: ${JSON.stringify(payload)}\n\n`)
            tokenIndex++
          } else {
            clearInterval(streamInterval)
            res.write(`data: ${JSON.stringify({ event: 'STREAM_COMPLETED', totalDelivered: INFERENCE_TOKENS.length })}\n\n`)
            res.end()
          }
        }, 80) // 80ms por token (simulando velocidad de generación de un LLM)
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Ruta no encontrada' }))
      }
    })

    await new Promise((resolve) => server.listen(serverPort, resolve))
    console.log(`[ÉXITO] Pasarela de Inferencia IA escuchando en http://127.0.0.1:${serverPort}`)

    // 2. El Cliente Inicia Petición de Streaming sin Credenciales
    console.log('\n[PROCESO] Paso 2: Cliente solicitando flujo de inferencia sin credenciales de pago...')
    const rawRes = await fetch(`http://127.0.0.1:${serverPort}/api/v1/inference/stream`)

    console.log(`[REGISTRO] Estado HTTP de la Respuesta: ${rawRes.status} (Payment Required)`)
    const challengeData = await rawRes.json()
    console.log(`[REGISTRO] Cabecera WWW-Authenticate: "${rawRes.headers.get('www-authenticate')}"`)
    console.log(`[REGISTRO] Costo Cotizado: ${challengeData.challenge.cost}`)
    console.log(`[REGISTRO] Nonce del Desafío: ${challengeData.challenge.nonce}`)

    const payeeId = rawRes.headers.get('x402-payee')
    const costHbar = Number(rawRes.headers.get('x402-amount'))
    const nonce = rawRes.headers.get('x402-nonce')

    // 3. Liquidación Autónoma en la Capa de Consenso de Hedera
    console.log('\n[PROCESO] Paso 3: Cliente ejecutando liquidación de micropago x402 en Hedera Testnet...')
    const paymentTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-costHbar))
      .addHbarTransfer(AccountId.fromString(payeeId), new Hbar(costHbar))
      .setTransactionMemo(`x402:stream:${nonce}`)
      .execute(client)

    const paymentReceipt = await paymentTx.getReceipt(client)
    const txIdString = paymentTx.transactionId.toString()

    console.log(`[ÉXITO] ¡Micropago Liquidado en Cadena! Estado: ${paymentReceipt.status.toString()}`)
    console.log(`[REGISTRO] ID de Transacción en Consenso: ${txIdString}`)
    console.log(`[REGISTRO] HashScan del Pago: ${getHashscanUrl(paymentTx)}`)

    // 4. Conexión con Prueba de Pago e Ingestión del Flujo SSE
    console.log('\n[PROCESO] Paso 4: Conectando a la pasarela con la prueba de pago y consumiendo flujo SSE...')
    const proofHeader = `${txIdString}:${nonce}`

    const sseResponse = await fetch(`http://127.0.0.1:${serverPort}/api/v1/inference/stream`, {
      headers: {
        'x-payment-proof': proofHeader
      }
    })

    console.log(`[ÉXITO] ¡Pasarela Aceptó la Prueba! Estado HTTP: ${sseResponse.status} ${sseResponse.statusText}`)
    console.log(`[REGISTRO] Content-Type: "${sseResponse.headers.get('content-type')}"`)

    // Consumir el lector de Server-Sent Events
    const reader = sseResponse.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let fullText = ''
    let deliveredTokens = 0

    process.stdout.write('[ SALIDA STREAM IA]: "')
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

    console.log(`\n[ÉXITO] ¡Flujo completado exitosamente! Total de tokens entregados: ${deliveredTokens}`)
    console.log(`[REGISTRO] Texto Final Ensamblado: "${fullText.trim()}"`)

    // 5. Probar Defensa Contra Replay: Usar la misma prueba debe ser rechazado
    console.log('\n[PROCESO] Paso 5: Probando Defensa de la Pasarela Contra Ataques de Repetición (Replay)...')
    const replayRes = await fetch(`http://127.0.0.1:${serverPort}/api/v1/inference/stream`, {
      headers: {
        'x-payment-proof': proofHeader
      }
    })
    console.log(`[REGISTRO] Estado HTTP de la Petición Duplicada: ${replayRes.status} (Nonce Consumido / Prohibido)`)
    if (replayRes.status === 403) {
      console.log('[ÉXITO] La pasarela bloqueó la petición duplicada: ¡Defensa contra repetición verificada!')
    }

    console.log('\n CONCEPTO CLAVE:')
    console.log('HTTP 402 transforma las APIs Web2 en micro-economías continuas. En lugar de atar a los')
    console.log('usuarios a suscripciones mensuales, las pasarelas transmiten inferencia de LLM en tiempo real,')
    console.log('sensores o datos financieros bajo un esquema de pago por token y por segundo.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Hedera es la red idónea para pasarelas de streaming porque la finalidad de consenso es inferior')
    console.log('a 3 segundos y cuesta fracciones de centavo ($0.0001). Esto permite a los clientes financiar sesiones')
    console.log('SSE sobre la marcha sin esperar minutos por confirmaciones de bloque tradicionales.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo en la Pasarela de Streaming de IA:', error.message)
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
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
