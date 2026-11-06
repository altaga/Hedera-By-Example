/**
 * ============================================================================
 * Lab 01: Generación del Desafío Servidor HTTP 402
 * [CONCEPTO] Desafíos de Pago Legibles por Máquinas
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La Cabecera del Paywall: En lugar de redirigir a un agente de IA a una página
 * de pago o exigir una API key estática, el servidor responde HTTP 402 (Payment
 * Required) con la cabecera PAYMENT-REQUIRED: JSON en Base64 que dice exactamente
 * qué pagar (monto y activo), a quién (payTo), en qué red (hedera:testnet) y qué
 * cuenta pagará la comisión de red (extra.feePayer, el facilitador). Esto
 * convierte cualquier endpoint HTTP en una API de pago por llamada.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * HTTP 402 une las APIs Web2 con la liquidación Web3: el desafío es gratis, todavía no se firma ni se envía nada a Hedera, y el precio es un entero en la unidad más pequeña del activo (tinybars para HBAR, cuyo id de activo en x402 es "0.0.0"), así que servidor y agente nunca discrepan por redondeos.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M9 Lab 11: Handshake A2A Cifrado
 * - Siguiente: M10 Lab 02: Firma de Pago del Agente
 *
 * [SECUENCIA]
 * Agente -> Servidor: GET /api/v1/alpha-intelligence/market-depth
 * Nota Servidor: Sin API key, token ni cookie
 * Servidor -> Agente: 402 + PAYMENT-REQUIRED (monto, activo, payTo, feePayer)
 *
 * [SIMULADO]
 * La petición HTTP y el servidor corren en el mismo proceso; no se levanta ningún servidor web.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el facilitador (paga la comisión de red en el Lab 03).
 * - Wallets de práctica: ACCOUNT_2 es el comercio que cobra.
 * - Costo: gratis (no se envía ninguna transacción).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/01_http_402_server_challenge.js
 * ============================================================================
 */

import { getClient, updateState, encodeHeader, X402_NETWORK, HBAR_ASSET } from '../M99_Utilities/index.js'

const create402Challenge = (resourcePath, priceTinybars, payTo, feePayer) => {
  // "PaymentRequired" de x402 v2: el recurso y la lista de formas de pago que acepta el servidor.
  const paymentRequired = {
    x402Version: 2,
    error: 'Payment required',
    resource: {
      url: resourcePath,
      description: 'Feed de profundidad de mercado (alpha intelligence)',
      mimeType: 'application/json'
    },
    accepts: [{
      scheme: 'exact', // pagar exactamente este monto
      network: X402_NETWORK, // hedera:testnet
      amount: String(priceTinybars), // entero, unidad más pequeña del activo
      asset: HBAR_ASSET, // "0.0.0" = HBAR; si no, el id de un token HTS
      payTo, // la cuenta del comercio
      maxTimeoutSeconds: 120, // una transacción de Hedera es válida 120 s
      extra: { feePayer } // la cuenta del facilitador que paga la comisión de red
    }]
  }

  // HTTP 402: las mismas condiciones viajan en Base64 en la cabecera PAYMENT-REQUIRED.
  return {
    status: 402,
    headers: { 'PAYMENT-REQUIRED': encodeHeader(paymentRequired) },
    body: paymentRequired
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Generador de Desafíos x402 del Servidor ---\n')
  const { client, operatorId } = getClient()
  const merchantId = process.env.ACCOUNT_2_ID

  if (!merchantId) {
    console.error('[FALLÓ] Faltan credenciales en .env (ACCOUNT_2, el comercio).')
    process.exitCode = 1
    return
  }

  try {
    const resourcePath = '/api/v1/alpha-intelligence/market-depth'
    const priceTinybars = 1_000_000 // 0.01 HBAR por petición

    console.log(`[PROCESO] Simulando una petición sin autenticar a: ${resourcePath}`)
    console.log('[INFO] No hay API Key, token OAuth Bearer ni cookie de sesión.')

    // 1. El servidor responde a una petición protegida con condiciones de pago en vez de los datos.
    console.log('\n[PROCESO] El interceptor del servidor dispara el desafío HTTP 402...')
    const challenge = create402Challenge(resourcePath, priceTinybars, merchantId, operatorId.toString())
    const accept = challenge.body.accepts[0]

    console.log('\n[ÉXITO] Desafío HTTP 402 Payment Required generado:')
    console.log(`[REGISTRO] Estado HTTP:          ${challenge.status} Payment Required`)
    console.log(`[REGISTRO] Recurso:              ${challenge.body.resource.url}`)
    console.log(`[REGISTRO] Versión x402:         ${challenge.body.x402Version}`)
    console.log(`[REGISTRO] Esquema / Red:        ${accept.scheme} / ${accept.network}`)
    console.log(`[REGISTRO] Precio:               ${accept.amount} tinybars (${priceTinybars / 1e8} HBAR, activo ${accept.asset})`)
    console.log(`[REGISTRO] Pagar a (comercio):   ${accept.payTo}`)
    console.log(`[REGISTRO] Paga la comisión:     ${accept.extra.feePayer} (el facilitador)`)
    console.log(`[REGISTRO] PAYMENT-REQUIRED:     ${challenge.headers['PAYMENT-REQUIRED'].substring(0, 48)}...`)

    // 2. Guardar la cabecera para el Lab 02, tal como la recibiría un agente.
    updateState('X402_PAYMENT_REQUIRED', challenge.headers['PAYMENT-REQUIRED'])

    console.log('\n CONCEPTO CLAVE:')
    console.log('La respuesta HTTP 402 se describe a sí misma. Cualquier agente compatible')
    console.log('puede decodificar la cabecera, comparar el precio con su política de gasto y')
    console.log('armar el pago por su cuenta. Todavía no se ha firmado ni pagado nada.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLÓ] No se pudo generar el desafío 402:', error.message)
    process.exitCode = 1
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
