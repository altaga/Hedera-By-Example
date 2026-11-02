/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Intercambios Atómicos Multi-Activo (Atomic Swaps)
 * [ CONCEPTO ] Intercambio Trustless de Capa 1
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Finalidad Atómica: La naturaleza de "Suma Cero" de las transacciones en
 * Hedera permite combinar múltiples movimientos de activos en una sola
 * operación atómica. O se satisfacen TODAS las condiciones y firmas, o la
 * transacción entera falla. Esta es la primitiva fundamental de los
 * Exchanges Descentralizados (DEX): no necesitas contratos de custodia
 * (escrow); el protocolo mismo actúa como el garante imparcial del intercambio.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Al empaquetar transferencias de múltiples tokens y HBAR en una sola TransferTransaction, Hedera liquida intercambios atómicos multipartitos de forma nativa sin contratos de custodia, comisiones de intermediarios ni riesgo de contraparte.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens#atomic-crypto-and-token-transfers
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M4 Lab 03: Transferencias de NFTs
 * - Actual:   M4 Lab 04: Swaps Atómicos
 * - Siguiente: M4 Lab 05: Transferencias en Paralelo
 *
 * [ SECUENCIA ]
 * Tesorería -> Comprador: NFT #1
 * Comprador -> Tesorería: Pago en HBAR
 * Nota Hedera: Ambas partes en UNA TransferTransaction firmada por los dos
 * Hedera -> Tesorería: Todo se liquida junto o nada se liquida
 *
 * [ CÓMO EJECUTAR ]
 * node 04_atomic_swaps.js
 * ============================================================================
 */

import { AccountId, PrivateKey, TransferTransaction, TokenId, NftId, Hbar } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Intercambio Atómico (HBAR <-> NFT) ---\n')

  const { client, operatorId } = getClient()
  const userId = process.env.ACCOUNT_1_ID
  const userKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const nftTokenId = getState('NFT_TOKEN_ID')

  if (!userId || !userKey || !nftTokenId) {
    console.error('[❌ FALLO] Faltan credenciales de ACCOUNT_1 o el NFT_TOKEN_ID en el estado.')
    process.exitCode = 1
    return
  }

  const userPrivKey = PrivateKey.fromString(userKey)

  try {
    const serial = 2
    console.log('[⚙️ PROCESO] Iniciando Intercambio Atómico Peer-to-Peer:')
    console.log(`   - Operador envía NFT Serial #${serial} -> Usuario`)
    console.log('   - Usuario envía 1 HBAR -> Operador')

    // Una sola TransferTransaction puede contener docenas de movimientos atómicos
    const transaction = await new TransferTransaction()
      // 1. Débito y Crédito del NFT (Lado Venta)
      .addNftTransfer(new NftId(TokenId.fromString(nftTokenId), serial), AccountId.fromString(operatorId), AccountId.fromString(userId))

      // 2. Débito y Crédito de HBAR (Lado Pago)
      .addHbarTransfer(AccountId.fromString(userId), new Hbar(-1))
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(1))

      .freezeWith(client)

    // AMBAS partes deben firmar porque ambas están entregando activos
    console.log('[⚙️ PROCESO] Recolectando firmas de ambas partes en la misma transacción...')
    await transaction.sign(userPrivKey)
    // El Operador firma implícitamente al ejecutar como pagador

    const response = await transaction.execute(client)

    console.log(`[📊 REGISTRO] ID Transacción: ${response.transactionId.toString()}`)
    console.log(`[📊 REGISTRO] Ver en HashScan: ${getHashscanUrl(response)}`)

    const receipt = await response.getReceipt(client)
    console.log(`\n[✅ ÉXITO] Intercambio Atómico completado. Estado: ${receipt.status.toString()}`)
    console.log('[ℹ️ INFO] La propiedad del NFT y el HBAR han sido cruzados simultáneamente.')

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Al ser una operación atómica de Capa 1, no hay riesgo de')
    console.log('ejecución parcial. Si el usuario no tiene saldo, o el vendedor')
    console.log('no tiene el NFT, la red rechaza todo el bloque, protegiendo a')
    console.log('ambas partes de cualquier intento de fraude.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] El Intercambio Atómico falló:', error.message)
    process.exitCode = 1
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
