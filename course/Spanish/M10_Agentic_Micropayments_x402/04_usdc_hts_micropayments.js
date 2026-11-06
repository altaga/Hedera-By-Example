/**
 * ============================================================================
 * Lab 04: Micropagos en Stablecoins (USDC) con HTS
 * [CONCEPTO] Liquidaciones de Fracciones de Centavo para Inferencia de IA
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La Paradoja de las Tarjetas de Crédito: Cobrar $0.01 por una petición a una API
 * con Stripe o Visa cuesta $0.30 + 2.9% en comisiones: un sobrecosto del 3,000%
 * que destruye los modelos de negocio máquina-a-máquina. En Hedera, un pago x402
 * puede cotizarse en dólares y liquidarse en una stablecoin del Hedera Token
 * Service: el agente firma una transferencia de token en vez de una de HBAR, y el
 * facilitador paga en HBAR la comisión fija de red de ~$0.001.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las reglas de los tokens siguen vigentes dentro de x402: el comercio debe estar asociado al token o la transferencia no puede llegar. El precio es un entero en la unidad más pequeña del token (USDC tiene 6 decimales, así que $0.025 = 25,000 unidades).
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/associate-tokens-to-an-account
 * - https://faucet.circle.com/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 03: Liquidación del Facilitador con Cero Gas
 * - Siguiente: M10 Lab 05: Límites Financieros del Agente Autónomo (Guardrails)
 *
 * [ SECUENCIA ]
 * Agente -> Servidor: GET /api/v1/llm/prompt
 * Servidor -> Agente: 402 (25000 unidades de una stablecoin de 6 decimales = $0.025)
 * Nota Agente: Firma una transferencia de token HTS (no sale HBAR del agente)
 * Agente -> Facilitador: PAYMENT-SIGNATURE
 * Facilitador -> Hedera: Firma como pagador de la comisión y envía
 * Servidor -> Agente: 200 OK + PAYMENT-RESPONSE
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el facilitador y la tesorería del dólar de prueba.
 * - Wallets de práctica: ACCOUNT_1 (agente) paga a ACCOUNT_2 (comercio).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD, y dos asociaciones); <0.1 ℏ al volver a ejecutarlo (reutiliza el token).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/04_usdc_hts_micropayments.js
 * ============================================================================
 */

import { TokenAssociateTransaction, TokenCreateTransaction, TransferTransaction } from '@hiero-ledger/sdk'
import {
  getClient,
  updateState,
  getHashscanUrl,
  getMirrorNodeBaseUrl,
  parsePrivateKey,
  reuseToken,
  waitForMirror,
  createPaymentRequired,
  signExactPayment,
  settleExactPayment
} from '../M99_Utilities/index.js'

const OFFICIAL_TESTNET_USDC = '0.0.429274' // USDC de Circle en Hedera testnet (6 decimales)

// Saldo del token en unidades mínimas, o null si la cuenta no está asociada.
const tokenBalance = async (accountId, tokenId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`)
  const row = res.ok ? (await res.json()).tokens?.[0] : null
  return row ? Number(row.balance) : null
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Riel de Micropagos en Stablecoin (USDC) con HTS ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  const merchantKey = process.env.ACCOUNT_2_PRIVATE_KEY

  if (!agentId || !agentKey || !merchantId || !merchantKey) {
    console.error('[FALLO] Faltan credenciales en .env (ACCOUNT_1 agente, ACCOUNT_2 comercio).')
    process.exitCode = 1
    return
  }

  try {
    // 1. Elegir la stablecoin: el USDC de testnet de Circle si el agente tiene, si no un dólar de prueba del curso
    let usdcId = OFFICIAL_TESTNET_USDC
    if ((await tokenBalance(agentId, OFFICIAL_TESTNET_USDC)) >= 25_000) {
      console.log(`[INFO] El agente tiene USDC oficial de testnet (${usdcId}): paga con él.`)
    } else {
      console.log('[PROCESO] El agente no tiene USDC de testnet. Preparando el dólar de prueba del curso (6 decimales, como USDC)...')
      usdcId = (await reuseToken('REUSE_M10_04_TUSD', async () => {
        const tokenCreateTx = await new TokenCreateTransaction()
          .setTokenName('Course Test Dollar')
          .setTokenSymbol('tUSD')
          .setDecimals(6)
          .setInitialSupply(1_000_000 * 1_000_000) // 1,000,000 tUSD
          .setTreasuryAccountId(operatorId)
          .freezeWith(client)
        return (await (await tokenCreateTx.execute(client)).getReceipt(client)).tokenId
      }, { minBalance: 1_000_000 })).toString()
      console.log(`[ÉXITO] Dólar de prueba listo: ${usdcId}`)
    }

    // 2. Reglas de HTS: el comercio (y el agente, para el dólar de prueba) deben estar asociados al token
    for (const [accountId, key] of [[merchantId, merchantKey], [agentId, agentKey]]) {
      if ((await tokenBalance(accountId, usdcId)) !== null) continue
      console.log(`[PROCESO] Asociando ${accountId} con ${usdcId}...`)
      const associateTx = await new TokenAssociateTransaction()
        .setAccountId(accountId)
        .setTokenIds([usdcId])
        .freezeWith(client)
        .sign(parsePrivateKey(key))
      await (await associateTx.execute(client)).getReceipt(client)
    }
    if (usdcId !== OFFICIAL_TESTNET_USDC && (await tokenBalance(agentId, usdcId)) < 100_000) {
      console.log('[PROCESO] Enviando al agente 1 tUSD para gastar...')
      const fundTx = await new TransferTransaction()
        .addTokenTransfer(usdcId, operatorId, -1_000_000)
        .addTokenTransfer(usdcId, agentId, 1_000_000)
        .execute(client)
      await fundTx.getReceipt(client)
    }
    // El facilitador revisa saldos en el Mirror Node, que va unos segundos detrás del consenso.
    await waitForMirror(async () => (await tokenBalance(agentId, usdcId)) >= 25_000 && (await tokenBalance(merchantId, usdcId)) !== null)

    // 3. El servidor cotiza $0.025 por un prompt de LLM, en las unidades mínimas del token
    const costUsd = 0.025
    const microUnits = Math.round(costUsd * 1_000_000) // 25,000 unidades
    console.log(`\n[PROCESO] El servidor emite HTTP 402 por $${costUsd} USD (${microUnits} unidades de ${usdcId})...`)
    const paymentRequired = createPaymentRequired({
      resource: '/api/v1/llm/prompt',
      description: 'Un prompt de LLM de alto rendimiento',
      payTo: merchantId,
      amount: microUnits,
      asset: usdcId,
      feePayer: operatorId.toString()
    })

    // 4. El agente firma una transferencia de token (paso del Lab 02); el facilitador la liquida (paso del Lab 03)
    console.log('[PROCESO] El agente firma la transferencia de token...')
    const payment = await signExactPayment(client, paymentRequired, agentId, agentKey)
    console.log('[PROCESO] El facilitador verifica, firma como pagador de la comisión y envía...')
    const settlement = await settleExactPayment(client, payment, operatorKey)
    if (!settlement.success) throw new Error(`Liquidación rechazada: ${settlement.errorReason}`)

    console.log('\n[ÉXITO] Micropago en stablecoin HTS confirmado en la red:')
    console.log(`[REGISTRO] Estado:            ${settlement.status}`)
    console.log(`[REGISTRO] Id de transacción: ${settlement.transaction}`)
    console.log(`[EXPLORADOR] HashScan:       ${getHashscanUrl(settlement.transaction)}`)
    console.log(`[REGISTRO] El agente pagó:    ${microUnits} unidades de ${usdcId}, y nada de HBAR`)

    // 5. Comparación matemática de comisiones
    console.log('\n===============================================================')
    console.log(`PRUEBA DE VIABILIDAD ECONÓMICA: INFERENCIA DE API DE $${costUsd}`)
    console.log('===============================================================')
    console.log('1. Riel tradicional (Visa/Stripe):')
    console.log('- Comisión: $0.30 fija + 2.9% = $0.3007')
    console.log('- Ingreso neto del comercio: -$0.2757 (¡PIERDE 1,100% POR LLAMADA!)')
    console.log('2. Ethereum L1 / L2 congestionada:')
    console.log('- Gas: $0.40 - $2.50')
    console.log('- Viabilidad económica: IMPOSIBLE')
    console.log('3. Hedera Token Service + x402:')
    console.log('- Comisión de red: ~$0.001 USD fija, la paga el facilitador')
    console.log('- Ingreso neto del comercio: +$0.025 USD (100% del precio)')
    console.log('===============================================================')

    updateState('X402_STABLECOIN_ID', usdcId)

    console.log('\n CONCEPTO CLAVE:')
    console.log('La API cotizó en dólares y cobró en una stablecoin de HTS. El agente no gastó')
    console.log('HBAR, Hedera aplicó las reglas del token y la comisión fija hace rentable')
    console.log('cobrar por prompt hasta en fracciones de centavo.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló el micropago en stablecoin HTS:', error.message)
    process.exitCode = 1
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
