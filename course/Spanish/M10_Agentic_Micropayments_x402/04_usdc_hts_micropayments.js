/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Micropagos en Stablecoins (USDC) con HTS
 * [ CONCEPTO CLAVE ] Liquidaciones de Fracciones de Centavo con Hedera Token Service
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La Paradoja de las Tarjetas de Crédito: Cobrar \$0.01 por una petición a una API
 * a través de Stripe o Visa cuesta \$0.30 + 2.9% en comisiones de intercambio: un
 * sobrecosto del 3,000% que destruye los modelos de negocio máquina-a-máquina. Con
 * Hedera Token Service (HTS), una transferencia de USDC cuesta una tarifa fija de
 * ~\$0.001 USD de red, haciendo que el cobro por token o por inferencia sea rentable.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Liquidar peticiones de API en USDC nativo de HTS protege a los proveedores de la volatilidad del mercado, manteniendo comisiones de liquidación inferiores a un centavo en Hedera.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/tokens
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M10 Lab 03: Liquidación del Facilitador
 * - Actual:   M10 Lab 04: Micropagos USDC en HTS
 * - Siguiente: M10 Lab 05: Límites Financieros (Guardrails)
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/04_usdc_hts_micropayments.js
 * ============================================================================
 */

import {
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TransferTransaction,
  AccountId
} from '@hiero-ledger/sdk'
import { getClient, getState, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Riel de Micropagos HTS Stablecoin (USDC) ---\n')
  const { client, operatorId, network } = getClient()

  try {
    let mockUsdcTokenId = getState('X402_MOCK_USDC_TOKEN_ID')

    // 1. Crear o reutilizar un token fungible HTS que represente USDC (6 decimales)
    if (!mockUsdcTokenId) {
      console.log('[⚙️ PROCESO] Creando token HTS simulado de USDC en testnet (6 decimales)...')
      const tokenCreateTx = await new TokenCreateTransaction()
        .setTokenName('Hedera USD Coin')
        .setTokenSymbol('USDC')
        .setDecimals(6)
        .setInitialSupply(1000000 * 1000000) // 1,000,000 USDC
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Infinite)
        .setTreasuryAccountId(operatorId)
        .setAdminKey(client.operatorPublicKey)
        .setSupplyKey(client.operatorPublicKey)
        .freezeWith(client)

      const tokenCreateResponse = await tokenCreateTx.execute(client)
      const tokenCreateReceipt = await tokenCreateResponse.getReceipt(client)
      mockUsdcTokenId = tokenCreateReceipt.tokenId.toString()
      console.log(`[✅ ÉXITO] Token USDC en HTS Creado: ${mockUsdcTokenId}`)
      updateState('X402_MOCK_USDC_TOKEN_ID', mockUsdcTokenId)
    } else {
      console.log(`[ℹ️ INFO] Reutilizando Token USDC en HTS existente: ${mockUsdcTokenId}`)
    }

    // 2. Simular micropago x402: $0.025 USD por una inferencia LLM de alta precisión
    const costUsd = 0.025
    const microUnits = Math.round(costUsd * 1000000) // 25,000 unidades base

    console.log(`\n[⚙️ PROCESO] Iniciando liquidación x402 por $${costUsd} USD (${microUnits} unidades base)...`)
    console.log(`[📊 REGISTRO] Token de Pago: HTS (${mockUsdcTokenId})`)

    const transferTx = await new TransferTransaction()
      .addTokenTransfer(mockUsdcTokenId, operatorId, -microUnits)
      .addTokenTransfer(mockUsdcTokenId, operatorId, microUnits) // Auto-transferencia atómica para la demo
      .setTransactionMemo(`x402:usdc:$${costUsd}:prompt_inference`)
      .freezeWith(client)

    const txResponse = await transferTx.execute(client)
    const receipt = await txResponse.getReceipt(client)
    const hashscanUrl = getHashscanUrl(txResponse)

    console.log('\n[✅ ÉXITO] Micropago USDC en HTS Confirmado On-Chain:')
    console.log(`[📊 REGISTRO] Estado:            ${receipt.status.toString()}`)
    console.log(`[📊 REGISTRO] ID de Transacción: ${txResponse.transactionId.toString()}`)
    console.log(`[🔗 EXPLORADOR] HashScan:        ${hashscanUrl}`)

    // 3. Análisis Comparativo de Viabilidad Económica
    console.log('\n===============================================================')
    console.log('📊 BENCHMARK DE VIABILIDAD ECONÓMICA: INFERENCIA DE $0.025 USD')
    console.log('===============================================================')
    console.log('1. Riel Tradicional (Visa / Stripe):')
    console.log('   - Comisión: $0.30 fijo + 2.9% = $0.3007')
    console.log('   - Ingreso Neto del Comercio: -$0.2757 (¡PÉRDIDA DEL 1,100% POR PETICIÓN!)')
    console.log('2. Ethereum L1 / L2 Congestionada:')
    console.log('   - Tarifa de Gas: $0.40 - $2.50')
    console.log('   - Viabilidad Económica: IMPOSIBLE')
    console.log('3. Hedera Token Service (HTS):')
    console.log('   - Tarifa de Red: ~$0.001 USD fija')
    console.log('   - Ingreso Neto del Comercio: +$0.024 USD (96% de Margen)')
    console.log('===============================================================')

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('HTS se ejecuta a nivel nativo de Gossip y Virtual Voting sin el sobrecosto')
    console.log('de compilación y loops de la EVM. Esto habilita micropagos de alta frecuencia')
    console.log('que hacen rentable cobrar por token consumido en fracciones de centavo.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Fallo en el micropago USDC en HTS:', error.message)
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
