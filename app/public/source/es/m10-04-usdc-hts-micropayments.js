/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 04: Precios en Dólares con una Stablecoin HTS
 * [CONCEPTO] Cotizar «$0.01» y liquidarlo en un token nativo de HTS
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Las APIs piensan en dólares, no en HBAR. Una ruta x402 puede tener un precio en
 * dinero ("$0.01"): el esquema del servidor lo convierte a la unidad más pequeña de
 * una stablecoin (USDC tiene 6 decimales, así que $0.01 = 10000 unidades) y el
 * comprador firma una transferencia de token HTS en lugar de una de HBAR. Todo lo
 * demás es igual que en el Lab 03: el facilitador verifica, paga la comisión en
 * HBAR y envía.
 *
 * El valor oficial por defecto en Hedera testnet es el USDC de Circle (0.0.429274).
 * La mayoría de las wallets de práctica no tienen, así que este lab usa el dólar de
 * prueba del curso (tUSD, 6 decimales) salvo que tu agente ya tenga USDC de testnet.
 *
 * Desde este lab el agente usa wrapFetchWithPayment de @x402/fetch: un fetch() que
 * hace por ti las dos peticiones del Lab 03 (402, firmar, reintentar).
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las reglas de HTS siguen vigentes dentro de x402: el comercio debe estar asociado
 * al token o la transferencia no puede llegar, y la comprobación previa del
 * facilitador rechaza el pago antes de enviarlo. El cliente del comprador también
 * rechaza tokens que no conoce, así que un servidor no puede hacerle pagar en un
 * activo inesperado.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402/merchant-integration
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/associate-tokens-to-an-account
 * - https://faucet.circle.com/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 03: El Facilitador Liquida en Hedera
 * - Siguiente: M10 Lab 05: Límites de Gasto para Agentes
 *
 * [ SECUENCIA ]
 * Agente -> Servidor: GET /api/translate
 * Servidor -> Agente: 402 (precio "$0.01" = 10000 unidades de un token de 6 decimales)
 * Nota Agente: firma una transferencia de token HTS (no sale HBAR del agente)
 * Agente -> Servidor: reintento con PAYMENT-SIGNATURE
 * Servidor -> Facilitador: verify (¿comercio asociado?) y luego settle
 * Facilitador -> Hedera: transferencia de token, comisión pagada en HBAR por el facilitador
 * Servidor -> Agente: 200 + PAYMENT-RESPONSE
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el facilitador y la tesorería del dólar de prueba.
 * - Wallets de práctica: ACCOUNT_1 es el agente, ACCOUNT_2 el comercio.
 * - Costo: la primera vez cerca de 1.1 USD en ℏ (crear tUSD y dos asociaciones); después cerca de 0.001 USD.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/04_usdc_hts_micropayments.js
 * ============================================================================
 */

import http from 'node:http'
import { TokenAssociateTransaction, TokenCreateTransaction, TransferTransaction } from '@hiero-ledger/sdk'
import { x402ResourceServer } from '@x402/core/server'
import { wrapFetchWithPayment } from '@x402/fetch'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HEDERA_TESTNET_USDC, HEDERA_USDC_DECIMALS } from '@x402/hedera'
import {
  getClient,
  getHashscanUrl,
  getMirrorNodeBaseUrl,
  reuseToken,
  waitForMirror,
  updateState,
  show,
  X402_NETWORK,
  createBuyer,
  createLocalFacilitator,
  paywall,
  readPaymentRequired,
  readPaymentResponse,
  toPrivateKey
} from '../M99_Utilities/index.js'

// ─── Configuración ────────────────────────────────────────────────────────────
const PORT = 4024
const ROUTE = '/api/translate'
const PRICE = '$0.01'

/** Saldo de `tokenId` en `accountId` (unidades mínimas), o null si no está asociada. */
const tokenBalance = async (accountId, tokenId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`)
  const row = res.ok ? (await res.json()).tokens?.[0] : null
  return row ? BigInt(row.balance) : null
}

/** Asocia `accountId` con `tokenId` si aún no lo está (firma la cuenta, paga el operador). */
const ensureAssociated = async (client, accountId, accountKey, tokenId) => {
  if (await tokenBalance(accountId, tokenId) !== null) return
  console.log(`[PROCESO] Asociando ${accountId} con ${tokenId}...`)
  const tx = await new TokenAssociateTransaction().setAccountId(accountId).setTokenIds([tokenId]).freezeWith(client).sign(toPrivateKey(accountKey))
  await (await tx.execute(client)).getReceipt(client)
}

// ─── Principal ─────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- INICIO DE SESIÓN: Precios en Dólares con una Stablecoin HTS ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  const merchantKey = process.env.ACCOUNT_2_PRIVATE_KEY
  if (!agentId || !agentKey || !merchantId || !merchantKey) throw new Error('Falta ACCOUNT_1 (agente) o ACCOUNT_2 (comercio). Crea las wallets de práctica o defínelas en .env.')

  let server
  try {
    // 1. Elegir la stablecoin: el USDC oficial de testnet si el agente tiene, si no el tUSD del curso.
    const usdcBalance = await tokenBalance(agentId, HEDERA_TESTNET_USDC)
    let tokenId
    if (usdcBalance !== null && usdcBalance >= 10_000n) {
      tokenId = HEDERA_TESTNET_USDC
      console.log(`[INFO] El agente tiene USDC oficial de testnet (${HEDERA_TESTNET_USDC}): se usa ese.`)
    } else {
      console.log(`[INFO] El agente no tiene USDC de testnet (${HEDERA_TESTNET_USDC}); se usa el dólar de prueba del curso.`)
      tokenId = (await reuseToken('REUSE_M10_04_TUSD', async () => {
        const tx = await new TokenCreateTransaction()
          .setTokenName('Course Test Dollar')
          .setTokenSymbol('tUSD')
          .setDecimals(HEDERA_USDC_DECIMALS) // 6, como USDC
          .setInitialSupply(1_000_000 * 10 ** HEDERA_USDC_DECIMALS)
          .setTreasuryAccountId(operatorId)
          .execute(client)
        return (await tx.getReceipt(client)).tokenId
      }, { minBalance: 10 ** HEDERA_USDC_DECIMALS })).toString()
      console.log(`[INFO] Dólar de prueba: ${tokenId}`)
    }

    // 2. Reglas de HTS: ambas partes deben estar asociadas al token, y el agente necesita saldo.
    await ensureAssociated(client, merchantId, merchantKey, tokenId)
    if (tokenId !== HEDERA_TESTNET_USDC) {
      await ensureAssociated(client, agentId, agentKey, tokenId)
      if ((await tokenBalance(agentId, tokenId)) < 100_000n) {
        console.log('[PROCESO] Enviando al agente 1 tUSD para gastar...')
        const fund = await new TransferTransaction()
          .addTokenTransfer(tokenId, operatorId, -1_000_000)
          .addTokenTransfer(tokenId, agentId, 1_000_000)
          .execute(client)
        await fund.getReceipt(client)
      }
    }
    // El facilitador revisa saldos y asociaciones en el Mirror Node, que va unos segundos detrás del consenso.
    await waitForMirror(async () => (await tokenBalance(agentId, tokenId)) >= 10_000n && (await tokenBalance(merchantId, tokenId)) !== null)

    // 3. Servidor: la ruta tiene precio en dólares. El esquema traduce "$" a este token y sus decimales.
    const { client: facilitator } = createLocalFacilitator(operatorId, operatorKey)
    const scheme = new ExactHederaScheme({ defaultAssets: { [X402_NETWORK]: { asset: tokenId, decimals: HEDERA_USDC_DECIMALS } } })
    const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, scheme)
    const routes = {
      [`GET ${ROUTE}`]: {
        accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: PRICE }],
        description: 'Traducir un párrafo'
      }
    }
    const handlers = { [`GET ${ROUTE}`]: (_req, url) => ({ text: url.searchParams.get('q'), en: 'Hello, world' }) }
    server = http.createServer(paywall(resourceServer, routes, handlers))
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${PORT}${ROUTE}?q=Hola%2C%20mundo`

    const offer = readPaymentRequired(await fetch(url)).accepts[0]
    console.log(`\n[REGISTRO] Condiciones del 402: ${PRICE} → monto ${offer.amount} del activo ${offer.asset}`)

    // 4. Agente: permite este token (el USDC oficial viene permitido, con tope de $1) y hace el fetch.
    const agent = createBuyer(agentId, agentKey, { tokens: [{ asset: tokenId, maxAmountPerPayment: '50000' }] })
    const fetchWithPayment = wrapFetchWithPayment(fetch, agent)
    console.log(`[PROCESO] Agente: fetchWithPayment(${ROUTE})`)
    const res = await fetchWithPayment(url)
    const receipt = readPaymentResponse(res)
    console.log(`[ÉXITO] HTTP ${res.status}, cuerpo: ${JSON.stringify(await res.json())}`)
    if (res.status !== 200 || !receipt?.success) throw new Error(`El pago no se liquidó: ${receipt?.errorReason || res.status}`)
    console.log(`[REGISTRO] Liquidado: ${receipt.transaction}`)
    console.log(`[REGISTRO] Ver en HashScan: ${getHashscanUrl(receipt.transaction)}`)

    // 5. Qué se movió, según el Mirror Node: unidades del token entre agente y comercio; HBAR solo para la comisión.
    const mirrorId = receipt.transaction.replace('@', '-').replace(/\.(\d+)$/, '-$1')
    const record = await waitForMirror(async () => {
      const r = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions/${mirrorId}`)
      return r.ok ? (await r.json()).transactions?.[0] : null
    })
    if (record) {
      const role = (id) => (id === agentId ? 'agente' : id === merchantId ? 'comercio' : 'otra')
      show.table(record.token_transfers.map((t) => ({ papel: role(t.account), cuenta: t.account, token: t.token_id, unidades: t.amount, dolares: (t.amount / 10 ** HEDERA_USDC_DECIMALS).toFixed(6) })))
      console.log(`[REGISTRO] Comisión de red ${(record.charged_tx_fee / 1e8).toFixed(8)} ℏ, pagada por ${record.transaction_id.split('-')[0]} (el facilitador)`)
    }
    updateState('X402_STABLECOIN_ID', tokenId)

    console.log('\n CONCEPTO CLAVE:')
    console.log('La API cotizó en dólares y cobró en un token HTS. El agente no necesitó nada')
    console.log('de HBAR: el facilitador pagó la comisión de red, y Hedera aplicó las reglas')
    console.log('del token (asociación, saldo) antes de que se moviera nada.')
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
