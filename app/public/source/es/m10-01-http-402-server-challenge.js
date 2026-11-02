/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Generación del Desafío Servidor HTTP 402
 * [ CONCEPTO CLAVE ] Desafíos de Pago Legibles por Máquinas
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La Cabecera del Paywall: En lugar de redirigir a un agente de IA a una página
 * de pago web o exigir una API key estática, el servidor responde con el código
 * HTTP 402 (Payment Required) y entrega parámetros deterministas: destinatario,
 * monto, activo, red, esquema y un nonce criptográfico. Esto convierte cualquier
 * endpoint HTTP convencional en una API de pago por llamada (pay-per-call).
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * HTTP 402 Payment Required une las APIs tradicionales con la micro-liquidación Web3: los servidores emiten desafíos deterministas con el precio en tinybars o USDC antes de entregar cómputo o datos.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M9 Lab 11: Handshake Cifrado A2A
 * - Actual:   M10 Lab 01: Desafío 402 del Servidor
 * - Siguiente: M10 Lab 02: Firma de Pago del Agente
 *
 * [ SECUENCIA ]
 * Agente -> Servidor: GET /api/v1/alpha-intelligence/market-depth
 * Nota Servidor: Sin API key, token ni cookie
 * Servidor -> Agente: 402 Payment Required (precio, beneficiario, nonce, vencimiento)
 *
 * [ SIMULADO ]
 * La solicitud HTTP y el servidor corren en el mismo proceso; no se levanta un servidor web.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/01_http_402_server_challenge.js
 * ============================================================================
 */

import crypto from 'crypto'
import { getClient, updateState } from '../M99_Utilities/index.js'

const create402Challenge = (resourcePath, costHbar, payeeAccountId, network = 'testnet') => {
  const nonce = crypto.randomBytes(16).toString('hex')
  const timestamp = Date.now()
  const expiresAt = timestamp + 120000 // 2 minutos de validez del desafío

  const paymentChallenge = {
    status: 402,
    headers: {
      'WWW-Authenticate': 'x402',
      'x402-version': '1.0',
      'x402-network': `hedera:${network}`,
      'x402-scheme': 'exact',
      'x402-payee': payeeAccountId,
      'x402-amount': costHbar.toString(),
      'x402-asset': 'HBAR',
      'x402-nonce': nonce,
      'x402-expires': expiresAt.toString(),
      'x402-resource': resourcePath
    },
    body: {
      error: 'Payment Required',
      message: `El acceso a ${resourcePath} requiere una prueba de liquidación on-chain.`,
      settlementScheme: 'exact',
      details: {
        network: `hedera:${network}`,
        payee: payeeAccountId,
        cost: `${costHbar} HBAR`,
        nonce,
        validUntil: new Date(expiresAt).toISOString()
      }
    }
  }

  return paymentChallenge
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Generador de Desafíos Servidor x402 ---\n')
  const { client, operatorId, network } = getClient()

  try {
    const resourcePath = '/api/v1/alpha-intelligence/market-depth'
    const queryCostHbar = 0.5 // 0.5 HBAR por petición

    console.log(`[⚙️ PROCESO] Simulando petición no autenticada hacia: ${resourcePath}`)
    console.log('[ℹ️ INFO] No hay API Key, token Bearer de OAuth ni Cookie de sesión.')

    console.log('\n[⚙️ PROCESO] Interceptor del servidor disparando desafío HTTP 402...')
    const challenge = create402Challenge(resourcePath, queryCostHbar, operatorId.toString(), network)

    console.log('\n[✅ ÉXITO] Desafío HTTP 402 Payment Required Generado:')
    console.log(`[📊 REGISTRO] Estado HTTP:          ${challenge.status} Payment Required`)
    console.log(`[📊 REGISTRO] Recurso Objetivo:     ${challenge.headers['x402-resource']}`)
    console.log(`[📊 REGISTRO] Red Requerida:        ${challenge.headers['x402-network']}`)
    console.log(`[📊 REGISTRO] Esquema de Pago:      ${challenge.headers['x402-scheme']}`)
    console.log(`[📊 REGISTRO] Dirección Receptora:  ${challenge.headers['x402-payee']}`)
    console.log(`[📊 REGISTRO] Costo Requerido:      ${challenge.headers['x402-amount']} ${challenge.headers['x402-asset']}`)
    console.log(`[📊 REGISTRO] Nonce Criptográfico:  ${challenge.headers['x402-nonce']}`)
    console.log(`[📊 REGISTRO] Válido Hasta:         ${challenge.body.details.validUntil}`)

    // Persistir el desafío para el Lab 02
    updateState('X402_CHALLENGE_RESOURCE', resourcePath)
    updateState('X402_CHALLENGE_AMOUNT', queryCostHbar)
    updateState('X402_CHALLENGE_PAYEE', operatorId.toString())
    updateState('X402_CHALLENGE_NONCE', challenge.headers['x402-nonce'])
    updateState('X402_CHALLENGE_EXPIRES', challenge.headers['x402-expires'])

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('La respuesta HTTP 402 se autodescribe por completo. Cualquier agente máquina')
    console.log('puede inspeccionar las cabeceras, evaluar si el costo encaja en su política')
    console.log('de presupuesto, y construir una prueba de liquidación on-chain de forma autónoma.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Fallo al generar el desafío 402:', error.message)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
