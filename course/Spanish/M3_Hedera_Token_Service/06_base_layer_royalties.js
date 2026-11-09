/**
 * ============================================================================
 * Lab 06: Regalías en la Capa Base
 * [CONCEPTO] Protección de Ingresos de Creadores y Tarifas de Respaldo
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
 * En otras cadenas, los mercados secundarios pueden evadir las regalías de los creadores. En Hedera la propia red descuenta la regalía del pago en cada reventa, y cobra la comisión de respaldo a quien recibe cuando no se paga nada. Las ventas desde la tesorería (la venta primaria) no pagan regalía.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/custom-token-fees#royalty-fee
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M3 Lab 05: Implementación de Tarifas Personalizadas (Custom Fees)
 * - Siguiente: M3 Lab 07: NFTs Dinámicos (HIP-657)
 *
 * [ SECUENCIA ]
 * Artista -> Hedera: TokenCreate NFT con regalía 10% + respaldo 0.01 ℏ (Artista = tesorería)
 * Artista -> Inversor: Venta primaria por 1 ℏ (desde la tesorería: sin regalía)
 * Inversor -> Comprador: Reventa por 1 ℏ
 * Hedera -> Recolector: El 10% del pago, descontado por la red
 * Comprador -> Inversor: Regalo sin pago
 * Hedera -> Recolector: Comisión de respaldo, cobrada a quien recibe
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 (artista) y ACCOUNT_2 (inversor) (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Además crea una cuenta desechable de comprador con 1.2 ℏ.
 * - Costo: ~30 ℏ la primera vez (crea un token con comisiones personalizadas, cerca de 2 USD); ~1.5 ℏ al volver a ejecutarlo (la cuenta del comprador y comisiones).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M3_Hedera_Token_Service/06_base_layer_royalties.js
 * ============================================================================
 */

import {
  AccountId,
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
import { getClient, createClient, ensureFunded, reuseToken, findOwnedSerial, createLabAccount } from '../M99_Utilities/index.js'

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
    // El operador paga la creación del token (la Cuenta 1 solo firma como tesorería),
    // así las cuentas de práctica solo necesitan poco HBAR para la venta. Se recargan si hace falta.
    await ensureFunded(operatorClient, account1Id, 2)
    await ensureFunded(operatorClient, account2Id, 2)

    console.log(`[INFO] Configurando Artista: ${account1Id} | Colector: ${operatorId}`)

    // 1. Definir Políticas de Regalías
    console.log('[PROCESO] Definiendo política de regalías (10% + Respaldo de 0.01 HBAR)...')

    const fallbackFee = new CustomFixedFee()
      .setAmount(1000000) // 0.01 HBAR
      .setFeeCollectorAccountId(AccountId.fromString(operatorId))

    const royaltyFee = new CustomRoyaltyFee()
      .setNumerator(1)
      .setDenominator(10) // 1/10 = 10%
      .setFallbackFee(fallbackFee)
      .setFeeCollectorAccountId(AccountId.fromString(operatorId))

    // 2. Crear Colección de NFT Protegida
    console.log('[PROCESO] Emitiendo colección NFT con reglas de regalía (RPN)...')
    const tokenId = await reuseToken('REUSE_M3_06_TOKEN', async () => {
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
        .freezeWith(operatorClient)
      return (await (await (await createTx.sign(account1PrivateKey)).execute(operatorClient)).getReceipt(operatorClient)).tokenId
    }, { treasury: account1Id, check: (t) => (t.custom_fees?.royalty_fees || []).length > 0 })
    console.log(`[ÉXITO] Colección protegida creada: ${tokenId.toString()}`)

    // 3. El NFT del artista: reutiliza uno que ya tenga (la colección tiene un máximo de 10), o acuña uno
    let serial = await findOwnedSerial(tokenId, account1Id)
    if (serial == null) {
      console.log(`[PROCESO] Acuñando un NFT del Token ${tokenId.toString()}...`)
      const mintReceipt = await (await new TokenMintTransaction()
        .setTokenId(tokenId)
        .setMetadata([Buffer.from('Asset #1')])
        .execute(client)).getReceipt(client)
      serial = Number(mintReceipt.serials[0])
    }
    console.log(`[REGISTRO] El artista tiene el serial #${serial}`)

    // 4. Asociar al inversor
    console.log(`[PROCESO] Asociando al inversor (${account2Id})...`)
    const associate2Tx = await new TokenAssociateTransaction()
      .setAccountId(account2Id)
      .setTokenIds([tokenId])
      .freezeWith(client)
      .sign(account2PrivateKey)
    // La colección se reutiliza entre ejecuciones, y una cuenta solo se asocia una vez.
    await (async () => (await associate2Tx.execute(client)).getReceipt(client))().catch((error) => {
      if (!/TOKEN_ALREADY_ASSOCIATED/.test(String(error?.status ?? error?.message))) throw error
      console.log('[INFO] Ya estaba asociada desde una ejecución anterior.')
    })

    // Lo que la red cobró de verdad, leído del registro de la transacción (no supuesto).
    const assessed = (record) => record.assessedCustomFees
      .map((f) => `${Number(f.amount) / 1e8} ℏ de ${(f.payerAccountIds || []).join(', ')} para ${f.feeCollectorAccountId}`)
    const buyer = await createLabAccount(operatorClient, { hbar: 1.2 })
    console.log(`[REGISTRO] Comprador de la reventa: ${buyer.accountId} (cuenta desechable con 1.2 ℏ)`)

    // --- ESCENARIO A: VENTA PRIMARIA (DESDE LA TESORERÍA) ---
    console.log('\n--- Escenario A: Venta Primaria (Artista -> Inversor, 1 HBAR) ---')
    const primary = await (await (await (await new TransferTransaction()
      .addNftTransfer(tokenId, serial, account1Id, account2Id)
      .addHbarTransfer(account2Id, new Hbar(-1))
      .addHbarTransfer(account1Id, new Hbar(1))
      .freezeWith(client)
      .sign(account2PrivateKey)).execute(client)).getRecord(client))
    const primaryFees = assessed(primary)
    console.log(primaryFees.length
      ? `[REGISTRO] Comisiones cobradas por la red: ${primaryFees.join('; ')}`
      : '[ÉXITO] Sin regalía: el NFT salió de la tesorería (venta primaria), que Hedera exime.')

    // --- ESCENARIO B: REVENTA (REGALÍA) ---
    console.log('\n--- Escenario B: Reventa (Inversor -> Comprador, 1 HBAR): Regalía del 10% ---')
    console.log('[PROCESO] La transferencia paga el 1 HBAR completo al inversor; la red le descuenta la regalía...')
    const resale = await (await (await (await (await new TransferTransaction()
      .addNftTransfer(tokenId, serial, account2Id, buyer.accountId)
      .addHbarTransfer(buyer.accountId, new Hbar(-1))
      .addHbarTransfer(account2Id, new Hbar(1))
      .freezeWith(client)
      .sign(account2PrivateKey)).sign(buyer.privateKey)).execute(client)).getRecord(client))
    const resaleFees = assessed(resale)
    if (!resaleFees.length) throw new Error('La red no cobró ninguna regalía en la reventa')
    console.log(`[ÉXITO] Regalía cobrada por la red: ${resaleFees.join('; ')}`)

    // --- ESCENARIO C: REGALO (COMISIÓN DE RESPALDO) ---
    console.log('\n--- Escenario C: Regalo sin pago (Comprador -> Inversor): Comisión de Respaldo ---')
    const gift = await (await (await (await (await new TransferTransaction()
      .addNftTransfer(tokenId, serial, buyer.accountId, account2Id)
      .freezeWith(client)
      .sign(buyer.privateKey)).sign(account2PrivateKey)).execute(client)).getRecord(client))
    const giftFees = assessed(gift)
    if (!giftFees.length) throw new Error('La red no cobró comisión de respaldo en el regalo')
    console.log(`[ÉXITO] Comisión de respaldo cobrada por la red: ${giftFees.join('; ')} (la paga quien recibe, porque no hubo intercambio de valor).`)

    // Devolver el NFT al artista para que la siguiente ejecución lo reutilice (la colección tiene un máximo de 10).
    const back = await (await (await (await new TransferTransaction()
      .addNftTransfer(tokenId, serial, account2Id, account1Id)
      .freezeWith(client)
      .sign(account2PrivateKey)).execute(client)).getRecord(client))
    const backFees = assessed(back)
    console.log(`[INFO] El NFT #${serial} volvió al artista${backFees.length ? ` (comisiones cobradas: ${backFees.join('; ')})` : ' (sin comisión: las transferencias hacia la tesorería están exentas)'}.`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Las regalías de Hedera son ineludibles por diseño. Al estar')
    console.log('integradas en la capa base, los marketplaces no pueden')
    console.log('"saltarse" el pago al creador, garantizando una economía')
    console.log('más justa para los artistas digitales.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] La demostración de regalías falló:', error.message)
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
