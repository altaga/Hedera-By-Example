/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 01: El Desafío de Pago HTTP 402
 * [CONCEPTO] Una API de pago responde «402 Payment Required» con condiciones legibles por máquinas
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * x402 convierte cualquier endpoint HTTP en una API de pago por llamada, y un
 * agente de IA puede pagarla sin un humano ni una API key.
 *
 * Hay tres papeles:
 *   - el comprador (un agente de IA o cualquier cliente) quiere un recurso,
 *   - el servidor de recursos (la API del comercio) lo vende,
 *   - el facilitador revisa los pagos y los envía a Hedera.
 *
 * Cuando llega una petición sin pago, el servidor no pide una API key ni redirige
 * a una página de checkout. Responde HTTP 402 con la cabecera PAYMENT-REQUIRED:
 * JSON en Base64 que dice exactamente qué pagar (monto y activo), a quién (payTo),
 * en qué red (hedera:testnet) y quién paga la comisión de red (extra.feePayer, la
 * cuenta del facilitador). Un agente puede leerla y pagar sin un humano.
 *
 * En este lab construyes el servidor de recursos con los paquetes oficiales
 * @x402/core y @x402/hedera, lo llamas sin pagar y decodificas el desafío.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * El 402 es gratis: no se firma nada y nada llega a Hedera todavía. El precio es un
 * entero en la unidad más pequeña del activo (tinybars para HBAR, cuyo id de activo
 * en x402 es "0.0.0"), así que no hay redondeo entre el servidor y el comprador.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://docs.hedera.com/solutions/ai/x402/merchant-integration
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M9 Lab 11: Handshake A2A Cifrado
 * - Siguiente: M10 Lab 02: El Agente Firma un Pago
 *
 * [ SECUENCIA ]
 * Servidor -> Facilitador: GET /supported (qué redes, qué feePayer)
 * Agente -> Servidor: GET /api/market-depth (sin pago)
 * Servidor -> Agente: 402 + PAYMENT-REQUIRED (exact, hedera:testnet, monto, payTo, feePayer)
 * Nota Agente: decodifica el JSON en Base64 y lee las condiciones
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet hace de facilitador (paga las comisiones en los labs siguientes).
 * - Wallets de práctica: ACCOUNT_2 es el comercio que cobra (payTo).
 * - Costo: gratis (no se envía ninguna transacción).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/01_http_402_server_challenge.js
 * ============================================================================
 */

import http from 'node:http'
import { x402ResourceServer } from '@x402/core/server'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HBAR_ASSET_ID } from '@x402/hedera'
import {
  getClient,
  updateState,
  show,
  X402_NETWORK,
  createLocalFacilitator,
  paywall,
  readPaymentRequired,
  formatHbar
} from '../M99_Utilities/index.js'

// ─── Configuración ────────────────────────────────────────────────────────────
const PORT = 4021
const ROUTE = '/api/market-depth'
const PRICE_TINYBARS = '1000000' // 0.01 ℏ

// ─── Principal ─────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- INICIO DE SESIÓN: El Desafío de Pago HTTP 402 ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const merchantId = process.env.ACCOUNT_2_ID
  if (!merchantId) throw new Error('Falta ACCOUNT_2_ID (el comercio). Crea las wallets de práctica o defínela en .env.')

  let server
  try {
    // 1. El facilitador. Tu cuenta paga sus comisiones; aquí solo responde /supported.
    const { client: facilitator, feePayer } = createLocalFacilitator(operatorId, operatorKey)
    console.log(`[INFO] Cuenta que paga la comisión: ${feePayer}`)
    console.log(`[INFO] Comercio (payTo):           ${merchantId}`)

    // 2. El servidor de recursos: qué esquemas de pago acepta y en qué facilitador confía.
    const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactHederaScheme())

    // 3. La lista de precios. Una ruta, pagada en HBAR (activo "0.0.0") con el esquema "exact".
    const routes = {
      [`GET ${ROUTE}`]: {
        accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: { amount: PRICE_TINYBARS, asset: HBAR_ASSET_ID } }],
        description: 'Profundidad del libro de órdenes HBAR/USD',
        mimeType: 'application/json'
      }
    }
    const handlers = { [`GET ${ROUTE}`]: () => ({ pair: 'HBAR/USD', bids: [[0.281, 120000]], asks: [[0.283, 98000]] }) }

    // 4. Se sirve por HTTP, como cualquier API.
    server = http.createServer(paywall(resourceServer, routes, handlers))
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
    console.log(`[INFO] API de pago escuchando en http://127.0.0.1:${PORT}${ROUTE}`)

    // 5. Se llama como lo haría un cliente que nunca ha oído de pagos.
    console.log(`\n[PROCESO] GET ${ROUTE} sin ningún pago...`)
    const response = await fetch(`http://127.0.0.1:${PORT}${ROUTE}`)
    console.log(`[REGISTRO] HTTP ${response.status} ${response.statusText || 'Payment Required'}`)
    console.log(`[REGISTRO] Cabecera PAYMENT-REQUIRED: ${response.headers.get('payment-required').slice(0, 60)}… (Base64)`)
    if (response.status !== 402) throw new Error(`Se esperaba HTTP 402 y llegó ${response.status}`)

    // 6. Se decodifica el desafío: es todo lo que un comprador necesita para pagar.
    const challenge = readPaymentRequired(response)
    console.log('\n[ÉXITO] PAYMENT-REQUIRED decodificado:')
    show.json(challenge)

    const offer = challenge.accepts[0]
    show.table([
      { campo: 'x402Version', valor: challenge.x402Version, significado: 'versión del protocolo' },
      { campo: 'scheme', valor: offer.scheme, significado: 'pagar este monto exacto' },
      { campo: 'network', valor: offer.network, significado: 'id CAIP-2 de Hedera testnet' },
      { campo: 'asset', valor: offer.asset, significado: '0.0.0 es HBAR; si no, el id de un token HTS' },
      { campo: 'amount', valor: offer.amount, significado: `${formatHbar(offer.amount)} en tinybars` },
      { campo: 'payTo', valor: offer.payTo, significado: 'cuenta del comercio que cobra' },
      { campo: 'extra.feePayer', valor: offer.extra.feePayer, significado: 'cuenta del facilitador que paga la comisión de red' },
      { campo: 'maxTimeoutSeconds', valor: offer.maxTimeoutSeconds, significado: 'cuánto tiempo sigue vigente la oferta' }
    ])

    updateState('X402_MERCHANT_ID', merchantId)
    updateState('X402_FEE_PAYER', offer.extra.feePayer)

    console.log('\n CONCEPTO CLAVE:')
    console.log('El 402 es una etiqueta de precio que una máquina puede leer. No se firmó ni')
    console.log('se pagó nada: el comprador ya sabe el monto, el activo, el comercio y quién')
    console.log('paga la comisión, y decide si paga. El Lab 02 construye ese pago.')
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
