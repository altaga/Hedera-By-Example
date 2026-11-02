/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Pool Tokens Multi-Activo Institucionales y Canastas RWA (Archax / ATS)
 * [ CONCEPTO ] Portafolios Tokenizados Componibles y Liquidación Atómica de Canastas
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Uno de los mayores avances institucionales de tokenización en Hedera (implementado
 * junto con Archax, abrdn, Lloyds Banking Group y el Asset Tokenization Studio) es el
 * **Pool Token**: un token nativo de HTS que representa la participación proporcional
 * sobre una canasta subyacente de múltiples activos del mundo real regulados (ej. 50%
 * Fondo de Mercado Monetario del Tesoro de EE.UU., 30% Bono Corporativo Verde y 20%
 * Bienes Raíces Comerciales).
 * Dado que `TransferTransaction` en Hedera soporta hasta 10 tramos de tokens de forma
 * atómica, un Participante Autorizado (AP) puede depositar la canasta exacta de RWAs
 * y recibir Pool Tokens recién emitidos en un solo intercambio atómico sin riesgo de contraparte.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * En las finanzas tradicionales, crear o redimir una canasta de ETF toma T+1 o T+2 días
 * de conciliación en cámaras de compensación. En Hedera, la creación de Pool Tokens
 * multi-activo se liquida atómicamente en 2.5 segundos por $0.001 USD.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M11 Lab 05: Factoraje de Facturas RWA
 * - Siguiente: M11 Lab 07: Puente de Integración ERP Institucional
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~60 ℏ la primera vez (crea 4 tokens, cerca de 4 USD); ~3 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/06_rwa_multi_asset_pool_tokens.js
 * ============================================================================
 */

import {
  AccountCreateTransaction,
  Hbar,
  MirrorNodeTokenBalanceQuery,
  PrivateKey,
  TokenCreateTransaction,
  TokenSupplyType,
  TokenType,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { getClient, sleep, updateState, reuseToken } from '../M99_Utilities/index.js'

const BASKET_WEIGHTS = [
  { symbol: 'USTB-MMF', name: 'Fondo Mercado Monetario Tesoro EEUU (abrdn)', weight: 500 }, // 50%
  { symbol: 'CORP-BND', name: 'Bono Corporativo Verde Senior', weight: 300 }, // 30%
  { symbol: 'CRE-REIT', name: 'Capital Inmobiliario Comercial Prime', weight: 200 } // 20%
]

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Pool Tokens Multi-Activo Institucionales (Patrón Archax / ATS) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const issuerKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Desplegar los 3 Tokens RWA Regulados Subyacentes en HTS
    console.log('[⚙️ PROCESO] Paso 1: Desplegando los 3 Activos RWA Subyacentes en HTS...')
    const underlyingTokens = []

    for (const item of BASKET_WEIGHTS) {
      const tokenId = await reuseToken(`REUSE_M11_06_${item.symbol}`, async () => {
        const tx = await new TokenCreateTransaction()
          .setTokenName(item.name)
          .setTokenSymbol(item.symbol)
          .setDecimals(0)
          .setInitialSupply(100000)
          .setTokenType(TokenType.FungibleCommon)
          .setSupplyType(TokenSupplyType.Finite)
          .setMaxSupply(100000)
          .setTreasuryAccountId(operatorId)
          .setSupplyKey(issuerKey)
          .freezeWith(client)

        const res = await (await tx.sign(issuerKey)).execute(client)
        return (await res.getReceipt(client)).tokenId
      }, { minBalance: item.weight })
      underlyingTokens.push({ ...item, tokenId })
      console.log(`[✅ ACTIVO RWA] ${item.symbol.padEnd(10)} (${item.name.padEnd(44)}) ➔ Token ID: ${tokenId.toString()}`)
    }

    // 2. Desplegar el "Pool Token Institucional RWA" Compuesto (POOL-RWA)
    console.log('\n[⚙️ PROCESO] Paso 2: Desplegando Pool Token Compuesto Multi-Activo [POOL-RWA]...')
    const poolMemo = `ats:pool_v1:${underlyingTokens.map(t => `${t.tokenId.toString()}_${t.weight}`).join('|')}`
    const poolTokenId = await reuseToken('REUSE_M11_06_POOL', async () => {
      const poolTx = await new TokenCreateTransaction()
        .setTokenName('Canasta Institucional RWA Estilo Archax')
        .setTokenSymbol('POOL-RWA')
        .setDecimals(0)
        .setInitialSupply(10000)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(issuerKey)
        .setTokenMemo(poolMemo)
        .freezeWith(client)

      const poolRes = await (await poolTx.sign(issuerKey)).execute(client)
      return (await poolRes.getReceipt(client)).tokenId
    }, { minBalance: 1000, check: (t) => t.memo === poolMemo })
    console.log(`[✅ ÉXITO] Pool Token Compuesto Creado: ${poolTokenId.toString()}`)
    console.log(`[📊 REGISTRO] Memo de Composición On-Chain: ${poolMemo}`)

    // 3. Aprovisionar Bóveda de Participante Autorizado (AP) y Fondear Activos Subyacentes
    console.log('\n[⚙️ PROCESO] Paso 3: Aprovisionando Bóveda de Participante Autorizado (AP) Institucional...')
    const apKey = PrivateKey.generateED25519()
    const apRes = await new AccountCreateTransaction()
      .setKeyWithoutAlias(apKey.publicKey)
      .setInitialBalance(new Hbar(0))
      .setMaxAutomaticTokenAssociations(10)
      .execute(client)
    const apAccountId = (await apRes.getReceipt(client)).accountId

    // Fondear al AP con 500 USTB-MMF, 300 CORP-BND y 200 CRE-REIT
    const seedTx = new TransferTransaction()
    for (const asset of underlyingTokens) {
      seedTx.addTokenTransfer(asset.tokenId, operatorId, -asset.weight)
      seedTx.addTokenTransfer(asset.tokenId, apAccountId, asset.weight)
    }
    await (await seedTx.execute(client)).getReceipt(client)
    console.log(`[🏦 BÓVEDA AP] Cuenta ${apAccountId.toString()} fondeada con 500 USTB-MMF, 300 CORP-BND, 200 CRE-REIT`)

    // 4. Creación Atómica de Canasta: ¡El AP Deposita 3 Tramos RWA y Recibe 1,000 POOL-RWA en UNA Transacción!
    console.log('\n[⚙️ PROCESO] Paso 4: Ejecutando Creación Atómica de Canasta de 4 Tokens (DvP)...')
    const atomicBasketSwap = new TransferTransaction()
      // Tramos 1, 2, 3: El AP deposita la canasta RWA subyacente en la Tesorería del Pool
      .addTokenTransfer(underlyingTokens[0].tokenId, apAccountId, -500)
      .addTokenTransfer(underlyingTokens[0].tokenId, operatorId, 500)
      .addTokenTransfer(underlyingTokens[1].tokenId, apAccountId, -300)
      .addTokenTransfer(underlyingTokens[1].tokenId, operatorId, 300)
      .addTokenTransfer(underlyingTokens[2].tokenId, apAccountId, -200)
      .addTokenTransfer(underlyingTokens[2].tokenId, operatorId, 200)
      // Tramo 4: La Tesorería del Pool entrega 1,000 participaciones POOL-RWA al AP
      .addTokenTransfer(poolTokenId, operatorId, -1000)
      .addTokenTransfer(poolTokenId, apAccountId, 1000)
      .setTransactionMemo('ATS:POOL_MINT:1000_SHARES')
      .freezeWith(client)

    // Co-firmado tanto por el AP como por la Tesorería del Pool
    const signedSwap = await (await atomicBasketSwap.sign(apKey)).sign(issuerKey)
    const swapRes = await signedSwap.execute(client)
    const swapReceipt = await swapRes.getReceipt(client)
    console.log(`[✅ ÉXITO] ¡Creación Atómica de Canasta Liquidada! Estado: ${swapReceipt.status.toString()}`)
    console.log(`[📊 REGISTRO] Tx ID: ${swapRes.transactionId.toString()}`)

    // 5. Verificar el Balance Final de Pool Tokens del AP vía Mirror Node
    await sleep(3500)
    const apPoolBal = await new MirrorNodeTokenBalanceQuery()
      .setAccountId(apAccountId)
      .setTokenId(poolTokenId)
      .execute(client)
    console.log(`\n[📊 AUDITORÍA] Balance Final del AP: ${apPoolBal.balance.toString()} POOL-RWA (Respaldado 1:1 por 3 Tramos RWA en Bóveda)`)

    updateState('RWA_POOL_TOKEN_ID', poolTokenId.toString())
    updateState('RWA_AP_ACCOUNT_ID', apAccountId.toString())
    updateState('RWA_POOL_SHARES_MINTED', apPoolBal.balance.toString())

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Los Pool Tokens permiten a las instituciones agrupar Fondos Monetarios, Bonos y Acciones')
    console.log('en un único instrumento HTS transferible utilizado como colateral instantáneo en FX y DeFi.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Gracias a que Hedera soporta transferencias atómicas multi-token de forma nativa en Capa 1,')
    console.log('crear o redimir una canasta de ETF multi-activo no requiere contratos inteligentes de custodia.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en Ejecución de Pool Token RWA:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
