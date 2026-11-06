/**
 * ============================================================================
 * Lab 08: Orderbook en Memoria y Liquidación Triangular Atómica en L1 (Ring Trade)
 * [CONCEPTO] Emparejamiento Off-Chain con Liquidación Multi-Parte Cero Custodia en L1
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Los Automated Market Makers (AMMs) sufren de deslizamiento (slippage), front-running
 * (MEV) y comisiones de pools de liquidez. Las arquitecturas DeFi de última generación
 * (como CoW Swap, UniswapX y dark pools institucionales) resuelven esto mediante la
 * Coincidencia de Deseos (Coincidence of Wants - CoW) y Ring Trades:
 * 1. Orderbook Off-Chain: Los operadores envían órdenes límite firmadas fuera de cadena.
 * 2. Emparejamiento en Anillo: El motor detecta un ciclo cerrado entre 3 operadores:
 *    - Operador Alfa: Desea cambiar USD por HBAR.
 *    - Operador Beta: Desea cambiar HBAR por GOLD.
 *    - Operador Gamma: Desea cambiar GOLD por USD.
 * 3. Liquidación Atómica en L1: El motor compila todos los tramos en UNA SOLA
 *    `TransferTransaction` en Capa 1 de Hedera. Sin contratos inteligentes de custodia,
 *    sin deslizamiento de precio y sin riesgo de contraparte. Si uno falla, todo se revierte.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * No requieres contratos inteligentes en Solidity para liquidar redes complejas de trueque
 * multi-participante. La `TransferTransaction` nativa de Capa 1 en Hedera soporta de fábrica
 * transferencias atómicas multi-token y multi-cuenta con costos predecibles de fracciones de centavo.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens#atomic-crypto-and-token-transfers
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M4 Lab 07: Cancelación de Airdrops y Rechazo Anti-Spam de Tokens (HIP-904)
 * - Siguiente: M4 Lab 09: Préstamos Flash Sin Capital y Liquidación Atómica en Capa 1
 *
 * [ SECUENCIA ]
 * Alpha -> Solver: Orden límite firmada (USD → GOLD)
 * Beta -> Solver: Orden límite firmada (GOLD → HBAR)
 * Gamma -> Solver: Orden límite firmada (HBAR → USD)
 * Nota Solver: Encuentra el anillo (coincidencia de deseos)
 * Solver -> Hedera: Una TransferTransaction de 6 partes firmada por los tres
 * Hedera -> Solver: Anillo liquidado de forma atómica
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~35 ℏ la primera vez (crea 2 tokens, cerca de 2 USD); ~6 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M4_Token_Operations_Atomic_Swaps/08_orderbook_triangular_settlement.js
 * ============================================================================
 */

import {
  PrivateKey,
  TokenCreateTransaction,
  TransferTransaction,
  AccountCreateTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, updateState, reuseToken } from '../M99_Utilities/index.js'

/**
 * Motor de Emparejamiento de Órdenes en Anillo en Memoria
 */
class TriangularMatchingEngine {
  constructor () {
    this.orders = []
  }

  submitOrder (order) {
    this.orders.push(order)
    console.log(`[ORDERBOOK] Nueva Orden Límite: ${order.traderName} ofrece ${order.sellAmount} ${order.sellSymbol} ➔ busca ${order.buyAmount} ${order.buySymbol}`)
  }

  findTriangularRing () {
    // Buscar ciclo de 3 vías: A->B, B->C, C->A
    for (const a of this.orders) {
      for (const b of this.orders) {
        for (const c of this.orders) {
          if (
            a.buySymbol === b.sellSymbol &&
            b.buySymbol === c.sellSymbol &&
            c.buySymbol === a.sellSymbol &&
            a.traderId !== b.traderId &&
            b.traderId !== c.traderId
          ) {
            return [a, b, c]
          }
        }
      }
    }
    return null
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Orderbook en Memoria y Liquidación Triangular Atómica en L1 ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const treasuryKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Aprovisionar 2 Activos Fungibles HTS: Token USD y Token GOLD
    console.log('[PROCESO] Paso 1: Desplegando Par Sintético en HTS (USD y GOLD)...')
    const usdId = await reuseToken('REUSE_M4_08_USD', async () => {
      const usdTx = await new TokenCreateTransaction()
        .setTokenName('Synthetic USD Credit')
        .setTokenSymbol('USD')
        .setDecimals(0)
        .setInitialSupply(100000)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(treasuryKey)
        .freezeWith(client)
      return (await (await (await usdTx.sign(treasuryKey)).execute(client)).getReceipt(client)).tokenId
    }, { minBalance: 100 })

    const goldId = await reuseToken('REUSE_M4_08_GOLD', async () => {
      const goldTx = await new TokenCreateTransaction()
        .setTokenName('Tokenized Gold Ounce')
        .setTokenSymbol('GOLD')
        .setDecimals(0)
        .setInitialSupply(10000)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(treasuryKey)
        .freezeWith(client)
      return (await (await (await goldTx.sign(treasuryKey)).execute(client)).getReceipt(client)).tokenId
    }, { minBalance: 5 })

    console.log(`[ÉXITO] Token HTS USD Creado:  ${usdId.toString()}`)
    console.log(`[ÉXITO] Token HTS GOLD Creado: ${goldId.toString()}`)

    // 2. Aprovisionar 3 Operadores Autónomos con Inventarios Iniciales
    console.log('\n[PROCESO] Paso 2: Aprovisionando 3 Operadores (Alfa, Beta, Gamma) con Auto-Asociación...')
    const alphaKey = PrivateKey.generateED25519()
    const betaKey = PrivateKey.generateED25519()
    const gammaKey = PrivateKey.generateED25519()

    const makeTrader = async (key, name) => {
      const res = await new AccountCreateTransaction()
        .setKeyWithoutAlias(key.publicKey)
        .setInitialBalance(new Hbar(0))
        .setMaxAutomaticTokenAssociations(5)
        .execute(client)
      const id = (await res.getReceipt(client)).accountId
      console.log(`[OPERADOR] ${name} (${id.toString()}) aprovisionado.`)
      return id
    }

    const alphaId = await makeTrader(alphaKey, 'Operador Alfa')
    const betaId = await makeTrader(betaKey, 'Operador Beta')
    const gammaId = await makeTrader(gammaKey, 'Operador Gamma')

    // Fondear a Operador Alfa con 100 USD
    // Fondear a Operador Beta con 1 HBAR
    // Fondear a Operador Gamma con 5 GOLD
    console.log('\n[PROCESO] Distribuyendo Inventario Inicial de Activos a los Operadores...')
    const seedInventoryTx = new TransferTransaction()
      .addTokenTransfer(usdId, operatorId, -100)
      .addTokenTransfer(usdId, alphaId, 100)
      .addHbarTransfer(operatorId, new Hbar(-1))
      .addHbarTransfer(betaId, new Hbar(1))
      .addTokenTransfer(goldId, operatorId, -5)
      .addTokenTransfer(goldId, gammaId, 5)
      .freezeWith(client)

    await (await seedInventoryTx.execute(client)).getReceipt(client)
    console.log('[ÉXITO] Inventarios Fondeados: Alfa(100 USD), Beta(1 HBAR), Gamma(5 GOLD)')

    // 3. Orderbook Off-Chain: Publicar 3 Órdenes Límite
    console.log('\n[PROCESO] Paso 3: Registrando Órdenes Límite Criptográficas Off-Chain...')
    const engine = new TriangularMatchingEngine()

    // Operador Alfa: Vende 100 USD ➔ Busca 1 HBAR
    engine.submitOrder({
      traderName: 'Operador Alfa',
      traderId: alphaId,
      traderKey: alphaKey,
      sellSymbol: 'USD',
      sellTokenId: usdId,
      sellAmount: 100,
      buySymbol: 'HBAR',
      buyTokenId: null,
      buyAmount: 1
    })

    // Operador Beta: Vende 1 HBAR ➔ Busca 5 GOLD
    engine.submitOrder({
      traderName: 'Operador Beta',
      traderId: betaId,
      traderKey: betaKey,
      sellSymbol: 'HBAR',
      sellTokenId: null,
      sellAmount: 1,
      buySymbol: 'GOLD',
      buyTokenId: goldId,
      buyAmount: 5
    })

    // Operador Gamma: Vende 5 GOLD ➔ Busca 100 USD
    engine.submitOrder({
      traderName: 'Operador Gamma',
      traderId: gammaId,
      traderKey: gammaKey,
      sellSymbol: 'GOLD',
      sellTokenId: goldId,
      sellAmount: 5,
      buySymbol: 'USD',
      buyTokenId: usdId,
      buyAmount: 100
    })

    // 4. Algoritmo de Detección de Ciclos
    console.log('\n[PROCESO] Paso 4: Ejecutando Algoritmo de Detección de Ciclos CoW...')
    const ring = engine.findTriangularRing()
    if (!ring) {
      throw new Error('¡No se encontró un anillo de coincidencia triangular!')
    }
    console.log('[ COINCIDENCIA DETECTADA] ¡Anillo Cerrado Identificado: Alfa ➔ Beta ➔ Gamma ➔ Alfa!')
    console.log('Alfa entrega USD   ➔ Gamma recibe USD')
    console.log('Gamma entrega GOLD ➔ Beta recibe GOLD')
    console.log('Beta entrega HBAR  ➔ Alfa recibe HBAR')

    // 5. Liquidación Atómica en Capa 1 (¡6 Tramos de Transferencia en 1 Sola Transacción!)
    console.log('\n[PROCESO] Paso 5: Compilando Transacción de Liquidación Atómica de 6 Tramos en L1...')
    const ringClearingTx = new TransferTransaction()
      // Tramo 1 y 2: Alfa entrega 100 USD a Gamma
      .addTokenTransfer(usdId, alphaId, -100)
      .addTokenTransfer(usdId, gammaId, 100)
      // Tramo 3 y 4: Gamma entrega 5 GOLD a Beta
      .addTokenTransfer(goldId, gammaId, -5)
      .addTokenTransfer(goldId, betaId, 5)
      // Tramo 5 y 6: Beta entrega 1 HBAR a Alfa
      .addHbarTransfer(betaId, new Hbar(-1))
      .addHbarTransfer(alphaId, new Hbar(1))
      .setTransactionMemo('COW:TRIANGULAR:RING_CLEARING')
      .freezeWith(client)

    // Agregar co-firmas Ed25519 de los 3 operadores fuera de cadena
    console.log('[PROCESO] Agregando Firmas Criptográficas Ed25519 de los 3 Operadores...')
    const signedClearingTx = await (await (await ringClearingTx.sign(alphaKey)).sign(betaKey)).sign(gammaKey)

    // Ejecutar liquidación atómica en una única llamada de consenso
    const clearingRes = await signedClearingTx.execute(client)
    const clearingReceipt = await clearingRes.getReceipt(client)
    console.log(`[ÉXITO] ¡Anillo Triangular Liquidado en Consenso! Estado: ${clearingReceipt.status.toString()}`)
    console.log(`[REGISTRO] Tx ID en Consenso: ${clearingRes.transactionId.toString()}`)

    updateState('COW_SETTLED_TX_ID', clearingRes.transactionId.toString())
    updateState('COW_USD_TOKEN_ID', usdId.toString())
    updateState('COW_GOLD_TOKEN_ID', goldId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Los Ring Trades triangulares eliminan la necesidad de intermediarios centralizados')
    console.log('o pools de liquidez fragmentados. Liquida Coincidencias de Deseos de N partes')
    console.log('directamente en una transacción atómica en Capa 1 de Hedera sin deslizamiento.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Debido a que Hedera aplica atomicidad de forma nativa entre múltiples cuentas y tokens,')
    console.log('si un solo operador tuviese saldo insuficiente o una firma inválida, el 100% del trade')
    console.log('fallaría de manera atómica sin bloquear ni drenar fondos de ningún participante.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo en la Liquidación Triangular:', error.message)
    process.exit(1)
  } finally {
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
