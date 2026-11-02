/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Regalías en la Capa Base
 * [ CONCEPTO ] Protección de Ingresos de Creadores y Tarifas de Respaldo
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Economía del Creador: Hedera fuerza a que las regalías sean parte de un
 * "intercambio atómico". Con `CustomRoyaltyFee`, el protocolo garantiza que
 * el creador reciba un porcentaje de cada venta secundaria. Si la
 * transferencia no involucra un intercambio de valor (un regalo), se aplica
 * una "Tarifa de Respaldo" (Fallback Fee). Esto asegura que el artista tenga
 * ingresos garantizados, independientemente de dónde se realice la
 * transacción secundaria.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * En otras cadenas, los mercados secundarios pueden evadir las regalías de los creadores. En Hedera, las regalías se aplican en Capa 1: las transacciones que no paguen el porcentaje requerido fallan a nivel de protocolo.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/custom-token-fees#royalty-fee
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M3 Lab 05: Tarifas Personalizadas
 * - Actual:   M3 Lab 06: Regalías de Capa Base
 * - Siguiente: M4 Lab 01: Mensajería Pública
 *
 * [ SECUENCIA ]
 * Artista -> Hedera: TokenCreate NFT con regalía 10% + respaldo 0.01 ℏ
 * Artista -> Hedera: Acuñar NFT #1
 * Comprador -> Artista: Pagar 1 ℏ por el NFT #1 (una transferencia atómica)
 * Hedera -> Recolector: Regalía de 0.1 ℏ aplicada por la red
 * Nota Hedera: Ningún contrato de marketplace puede saltarse la regalía
 *
 * [ CÓMO EJECUTAR ]
 * node 06_base_layer_royalties.js
 * ============================================================================
 */

import {
  AccountId,
  Client,
  CustomFixedFee,
  CustomRoyaltyFee,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { getClient, createClient, ensureFunded } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Regalías Nativas de NFT ---\n')

  const { client: operatorClient, operatorId } = getClient()

  // Configuración de roles para la simulación
  const account1Id = process.env.ACCOUNT_1_ID
  const account1Key = process.env.ACCOUNT_1_PRIVATE_KEY
  const account1PrivateKey = PrivateKey.fromString(account1Key)

  // El Artista actúa como pagador en esta demo
  const client = createClient().setOperator(account1Id, account1PrivateKey)

  const account2Id = process.env.ACCOUNT_2_ID
  const account2PrivateKey = PrivateKey.fromString(process.env.ACCOUNT_2_PRIVATE_KEY)

  try {
    // La Cuenta 1 paga la creación del token (~30 ℏ con comisiones personalizadas) y la
    // Cuenta 2 compra un NFT. Se recargan desde el operador si hace falta.
    await ensureFunded(operatorClient, account1Id, 40)
    await ensureFunded(operatorClient, account2Id, 5)

    console.log(`[ℹ️ INFO] Configurando Artista: ${account1Id} | Colector: ${operatorId}`)

    // 1. Definir Políticas de Regalías
    console.log('[⚙️ PROCESO] Definiendo política de regalías (10% + Respaldo de 0.01 HBAR)...')

    const fallbackFee = new CustomFixedFee()
      .setAmount(1000000) // 0.01 HBAR
      .setFeeCollectorAccountId(AccountId.fromString(operatorId))

    const royaltyFee = new CustomRoyaltyFee()
      .setNumerator(1)
      .setDenominator(10) // 1/10 = 10%
      .setFallbackFee(fallbackFee)
      .setFeeCollectorAccountId(AccountId.fromString(operatorId))

    // 2. Crear Colección de NFT Protegida
    console.log('[⚙️ PROCESO] Emitiendo colección NFT con reglas de regalía (RPN)...')
    const createTx = await new TokenCreateTransaction()
      .setTokenName('Regalia NFT')
      .setTokenSymbol('RPN')
      .setTokenType(TokenType.NonFungibleUnique)
      .setInitialSupply(0)
      .setTreasuryAccountId(AccountId.fromString(account1Id))
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(10)
      .setSupplyKey(account1PrivateKey.publicKey)
      .setCustomFees([royaltyFee])
      .freezeWith(client)

    const tokenId = (await (await createTx.execute(client)).getReceipt(client)).tokenId
    console.log(`[✅ ÉXITO] Colección protegida creada: ${tokenId.toString()}`)

    // 3. Mintear y asociar
    console.log('[⚙️ PROCESO] Minteando Serial #1 y asociando al inversor...')
    await (await new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata([Buffer.from('Asset #1')])
      .execute(client)).getReceipt(client)

    await (await new TokenAssociateTransaction()
      .setAccountId(account2Id)
      .setTokenIds([tokenId])
      .freezeWith(client)
      .sign(account2PrivateKey)
      .execute(client)).getReceipt(client)

    // --- ESCENARIO A: VENTA SECUNDARIA CON REGALÍA ---
    console.log('\n--- 📊 [REGISTRO] Escenario A: Venta Secundaria (Intercambio Atómico) ---')
    console.log('[⚙️ PROCESO] Artista vende a Inversor por 1 HBAR...')

    const saleTx = await new TransferTransaction()
      .addNftTransfer(tokenId, 1, account1Id, account2Id)
      .addHbarTransfer(account2Id, new Hbar(-1.0)) // Comprador paga 1
      .addHbarTransfer(account1Id, new Hbar(0.9)) // Artista recibe 90%
      .addHbarTransfer(operatorId, new Hbar(0.1)) // Colector de regalías recibe 10%
      .freezeWith(client)
      .sign(account2PrivateKey)

    await (await saleTx.execute(client)).getReceipt(client)
    console.log('[✅ ÉXITO] Distribución atómica: Artista +0.9 | Colector +0.1 | Comprador -1.0')

    // --- ESCENARIO B: REGALO (TARIFA DE RESPALDO) ---
    console.log('\n--- 📊 [REGISTRO] Escenario B: Transferencia sin Valor (Respaldo) ---')
    console.log('[⚙️ PROCESO] Inversor devuelve el NFT al Artista (Regalo)...')
    const giftTx = await new TransferTransaction()
      .addNftTransfer(tokenId, 1, account2Id, account1Id)
      .freezeWith(client)
      .sign(account2PrivateKey)

    await (await giftTx.execute(client)).getReceipt(client)
    console.log('[✅ ÉXITO] Transferencia exitosa. Se aplicó la Tarifa de Respaldo de 0.01 HBAR.')

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Las regalías de Hedera son ineludibles por diseño. Al estar')
    console.log('integradas en la capa base, los marketplaces no pueden')
    console.log('"saltarse" el pago al creador, garantizando una economía')
    console.log('más justa para los artistas digitales.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La demostración de regalías falló:', error.message)
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
