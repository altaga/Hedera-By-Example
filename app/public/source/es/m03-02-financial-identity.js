/**
 * ============================================================================
 * Lab 02: Identidad Financiera y Cumplimiento Regulatorio
 * [CONCEPTO] Controles de Acceso Nativos (KYC y Freeze)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Cumplimiento Nativo: Las finanzas reguladas requieren controles de acceso
 * como KYC (Know Your Customer) y Congelamiento (Freeze). En otras redes,
 * esto requiere Smart Contracts complejos y costosos de auditar. En Hedera,
 * son parámetros NATIVOS: la `KycKey` permite al emisor autorizar cuentas
 * verificadas, y la `FreezeKey` permite bloquear saldos en caso de actividad
 * sospechosa. Esto hace que el cumplimiento sea predecible, seguro y
 * auditable directamente por los reguladores.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los activos institucionales regulados requieren llaves de KYC y Freeze. Mientras que en EVM esto requiere costosos contratos con listas negras, HTS aplica las reglas de identidad en Capa 1 con previsibilidad de microcentavos.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/native/tokens/enable-kyc
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M3 Lab 01: Emisión de Token Fungible con HTS
 * - Siguiente: M3 Lab 03: Emisión de NFT con Metadatos On-Chain (HIP-412)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD); <1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M3_Hedera_Token_Service/02_financial_identity.js
 * ============================================================================
 */

import {
  MirrorNodeAccountBalanceQuery,
  AccountId,
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenFreezeTransaction,
  TokenGrantKycTransaction,
  TokenUnfreezeTransaction
} from '@hiero-ledger/sdk'
import { getClient, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Cumplimiento Financiero ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const targetId = process.env.ACCOUNT_1_ID
  const targetKey = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!targetId || !targetKey) {
    console.error('[FALLO] Faltan credenciales de ACCOUNT_1 en el archivo .env.')
    process.exitCode = 1
    return
  }

  const adminKey = PrivateKey.fromString(operatorKey)
  const userKey = PrivateKey.fromString(targetKey)
  const userId = AccountId.fromString(targetId)

  try {
    // 1. Verificar la Identidad de la Billetera Hija
    console.log(`[INFO] Verificando cuenta del usuario ${userId.toString()}...`)
    const balance = await new MirrorNodeAccountBalanceQuery().setAccountId(userId).execute(client)
    console.log(`[ÉXITO] Usuario Activo (Saldo: ${balance.hbars.toString()})`)

    // 2. Crear un Token regulado por KYC
    console.log('\n[PROCESO] Emitiendo Token Financiero con reglas KYC/Freeze (RFT)...')
    const tokenId = await reuseToken('REUSE_M3_02_TOKEN', async () => {
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('Regulated Financial Token')
        .setTokenSymbol('RFT')
        .setDecimals(0)
        .setInitialSupply(100)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setAdminKey(adminKey)
        .setKycKey(adminKey) // Requisito de autorización de identidad
        .setFreezeKey(adminKey) // Requisito de control de activos
        .freezeWith(client)
      return (await (await tokenTx.execute(client)).getReceipt(client)).tokenId
    })

    console.log(`[ÉXITO] Token RFT creado exitosamente: ${tokenId.toString()}`)

    // 3. Asociación (Opt-in)
    console.log(`\n[PROCESO] Solicitando asociación (Opt-in) del usuario ${targetId}...`)
    const associateTx = await new TokenAssociateTransaction()
      .setAccountId(userId)
      .setTokenIds([tokenId])
      .freezeWith(client)

    // Firma Dual: Usuario acepta, Operador paga
    await associateTx.sign(userKey)
    // Al repetir el lab se reutiliza el token, y una cuenta solo se asocia una vez.
    try {
      const assocResponse = await associateTx.execute(client)
      await assocResponse.getReceipt(client)
      console.log('[ÉXITO] El usuario ya está asociado al token.')
    } catch (error) {
      if (!/TOKEN_ALREADY_ASSOCIATED/.test(String(error?.status ?? error?.message))) throw error
      console.log('[INFO] Ya estaba asociada desde una ejecución anterior: no hay nada que hacer.')
    }

    // 4. Otorgar KYC
    console.log('\n[PROCESO] Evaluando identidad y otorgando autorización KYC...')
    const kycTx = await new TokenGrantKycTransaction()
      .setAccountId(userId)
      .setTokenId(tokenId)
      .freezeWith(client)

    const kycResponse = await kycTx.execute(client)
    const kycReceipt = await kycResponse.getReceipt(client)
    console.log(`[REGISTRO] Estado del KYC: ${kycReceipt.status.toString()}`)
    console.log(`[ÉXITO] Flag KYC activo para la cuenta ${targetId}.`)

    // 5. Demostrar Control de Activos (Freeze)
    console.log('\n[PROCESO] Bloqueando activos del token (Freeze) por sospecha...')
    const freezeTx = await new TokenFreezeTransaction()
      .setAccountId(userId)
      .setTokenId(tokenId)
      .freezeWith(client)

    const freezeResponse = await freezeTx.execute(client)
    await freezeResponse.getReceipt(client)
    console.log('[ÉXITO] Cuenta congelada preventivamente.')

    // 6. Restaurar Acceso (Unfreeze)
    console.log('\n[PROCESO] Restaurando acceso (Unfreeze) tras auditoría exitosa...')
    const unfreezeTx = await new TokenUnfreezeTransaction()
      .setAccountId(userId)
      .setTokenId(tokenId)
      .freezeWith(client)

    const unfreezeResponse = await unfreezeTx.execute(client)
    await unfreezeResponse.getReceipt(client)
    console.log('[ÉXITO] Cuenta desbloqueada. Acceso financiero restaurado.')

    console.log('\n CONCEPTO CLAVE:')
    console.log('El cumplimiento normativo en Hedera es predecible y seguro.')
    console.log('Al usar llaves nativas (KycKey / FreezeKey), eliminas el factor')
    console.log('de "error humano" o "vulnerabilidad de código" en Smart Contracts,')
    console.log('cumpliendo con estándares institucionales de forma nativa.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] El flujo de cumplimiento falló:', error.message)
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
