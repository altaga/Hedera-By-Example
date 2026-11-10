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
 * - Anterior:  M9 Lab 11: Comunicación A2A Cifrada (Full-Duplex Hybrid)
 * - Siguiente: M10 Lab 02: Firma de Pago del Agente Autónomo
 *
 * [ SECUENCIA ]
 * Agente -> Servidor: GET https://hbe.expo.app/api/x402/market-depth
 * Nota Servidor: Sin API key, token ni cookie
 * Servidor -> Agente: 402 + PAYMENT-REQUIRED (monto, activo, payTo, feePayer)
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

import { getClient, updateState, decodeHeader, show, X402_NETWORK, HBAR_ASSET } from '../M99_Utilities/index.js'

// Un servidor de recursos x402 real, alojado junto a la web del curso. Responde 402 con la
// cabecera PAYMENT-REQUIRED; no guarda llaves y nunca envía transacciones.
const SERVER = 'https://hbe.expo.app/api/x402/market-depth'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Generador de Desafíos x402 del Servidor ---\n')
  const { client, operatorId } = getClient()
  const merchantId = process.env.ACCOUNT_2_ID

  if (!merchantId) {
    console.error('[FALLO] Faltan credenciales en .env (ACCOUNT_2, el comercio).')
    process.exitCode = 1
    return
  }

  try {
    // El servidor del curso toma el comercio (payTo) y el facilitador (feePayer) de la consulta,
    // así el pago de los Labs 02-03 llega a tus propias cuentas.
    const url = `${SERVER}?payTo=${merchantId}&feePayer=${operatorId}`
    console.log(`[PROCESO] Enviando una petición sin autenticar: GET ${SERVER}`)
    console.log('[INFO] No hay API Key, token OAuth Bearer ni cookie de sesión.')

    // 1. El servidor responde una petición protegida con condiciones de pago en vez de los datos.
    const response = await fetch(url)
    const header = response.headers.get('PAYMENT-REQUIRED')
    if (response.status !== 402 || !header) throw new Error(`Se esperaba HTTP 402 con PAYMENT-REQUIRED, llegó ${response.status}`)
    const paymentRequired = decodeHeader(header)
    const accept = paymentRequired.accepts[0]
    if (accept.network !== X402_NETWORK || accept.asset !== HBAR_ASSET || accept.payTo !== merchantId || accept.extra?.feePayer !== operatorId.toString()) {
      throw new Error('El desafío no coincide con lo que pidió este lab')
    }

    console.log('\n[ÉXITO] Desafío HTTP 402 Payment Required recibido:')
    console.log(`[REGISTRO] Estado HTTP:          ${response.status} Payment Required`)
    console.log(`[REGISTRO] Recurso:              ${paymentRequired.resource.url}`)
    console.log(`[REGISTRO] Versión x402:         ${paymentRequired.x402Version}`)
    console.log(`[REGISTRO] Esquema / Red:        ${accept.scheme} / ${accept.network}`)
    console.log(`[REGISTRO] Precio:               ${accept.amount} tinybars (${Number(accept.amount) / 1e8} HBAR, activo ${accept.asset})`)
    console.log(`[REGISTRO] Pagar a (comercio):   ${accept.payTo}`)
    console.log(`[REGISTRO] Paga la comisión:     ${accept.extra.feePayer} (el facilitador)`)
    console.log(`[REGISTRO] PAYMENT-REQUIRED:     ${header.substring(0, 48)}...`)
    console.log('\n[REGISTRO] La misma cabecera, decodificada (esto es lo que lee el agente):')
    show.json(paymentRequired)

    // 2. Guardar la cabecera para el Lab 02, tal como la recibiría un agente.
    updateState('X402_PAYMENT_REQUIRED', header)

    console.log('\n CONCEPTO CLAVE:')
    console.log('La respuesta HTTP 402 se describe a sí misma. Cualquier agente compatible')
    console.log('puede decodificar la cabecera, comparar el precio con su política de gasto y')
    console.log('armar el pago por su cuenta. Todavía no se ha firmado ni pagado nada.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] No se pudo obtener el desafío 402:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de Ejecución:', error.message)
      process.exit(1)
    })
}
