/**
 * ============================================================================
 * Lab 07: Cancelación de Airdrops y Rechazo Anti-Spam de Tokens (HIP-904)
 * [CONCEPTO] Recuperación del Emisor y Soberanía de Billetera contra Spam
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La HIP-904 no solo añadió `TokenAirdropTransaction`; introdujo un ciclo de vida
 * completo para proteger tanto a emisores como a usuarios:
 * 1. `TokenCancelAirdropTransaction`: Si un emisor envía un airdrop a una cuenta no
 *    asociada y el destinatario jamás lo reclama (o hubo un error de dirección), el
 *    emisor puede cancelar el airdrop pendiente y recuperar sus activos.
 * 2. `TokenRejectTransaction`: Si una cuenta recibe tokens no deseados o spam (vía
 *    espacios de auto-asociación), el usuario puede ejecutar `TokenRejectTransaction`
 *    para devolver todo el saldo a la Tesorería del Token ¡exento del 100% de tarifas personalizadas!
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * En Ethereum o Solana, si un estafador envía un token malicioso con impuesto de
 * transferencia a tu billetera, interactuar con él puede vaciar tus fondos.
 * En Hedera, `TokenRejectTransaction` purga los tokens no deseados de vuelta al emisor
 * en la capa de consenso ignorando cualquier tarifa personalizada maliciosa.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-904
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M4 Lab 06: Airdrops Nativos (HIP-904)
 * - Siguiente: M4 Lab 08: Orderbook en Memoria y Liquidación Triangular Atómica en L1 (Ring Trade)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD); ~3 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M4_Token_Operations_Atomic_Swaps/07_airdrop_cancel_and_reject.js
 * ============================================================================
 */

import {
  AccountCreateTransaction,
  Hbar,
  MirrorNodeTokenBalanceQuery,
  PendingAirdropId,
  PrivateKey,
  TokenAirdropTransaction,
  TokenCancelAirdropTransaction,
  TokenCreateTransaction,
  TokenRejectTransaction
} from '@hiero-ledger/sdk'
import { getClient, sleep, updateState, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Cancelación de Airdrops y Rechazo de Tokens (HIP-904) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const supplyKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Crear un Token Fungible para la Prueba del Ciclo de Vida de Airdrops
    console.log('[PROCESO] Creando Token Fungible (SPAM / PROMO)...')
    const tokenId = await reuseToken('REUSE_M4_07_TOKEN', async () => {
      // Crea el token: sus llaves (admin, supply, KYC, freeze...) deciden quién puede cambiarlo después.
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('Token Promo Drop')
        .setTokenSymbol('PROMO')
        .setDecimals(0)
        .setInitialSupply(10000)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(supplyKey)
        .freezeWith(client)

      const signedToken = await tokenTx.sign(supplyKey)
      const tokenRes = await signedToken.execute(client)
      // Espera el consenso: el recibo dice si la red aceptó la transacción.
      return (await tokenRes.getReceipt(client)).tokenId
    }, { minBalance: 1000 })
    console.log(`[ÉXITO] Token Creado: ${tokenId.toString()} (Suministro Inicial: 10,000 PROMO)`)

    // 2. PARTE A: El Emisor Cancela un Airdrop Pendiente No Reclamado (`TokenCancelAirdropTransaction`)
    console.log('\n[PROCESO] Parte A: Creando Cuenta Inactiva (0 Espacios de Auto-Asociación)...')
    // Genera una llave localmente: la llave privada nunca sale de este proceso.
    const dormantKey = PrivateKey.generateED25519()
    // Crea una cuenta: su llave la controla; el saldo inicial lo pone quien paga.
    const dormantRes = await new AccountCreateTransaction()
      .setKeyWithoutAlias(dormantKey.publicKey)
      .setInitialBalance(new Hbar(0))
      .setMaxAutomaticTokenAssociations(0) // Fuerza el airdrop al estado PENDIENTE
      .execute(client)
    const dormantId = (await dormantRes.getReceipt(client)).accountId
    console.log(`[ACTOR] Receptor Inactivo: ${dormantId.toString()}`)

    console.log(`[PROCESO] Enviando Airdrop de 500 PROMO a ${dormantId.toString()} (Entra en Cola Pendiente)...`)
    // Airdrop (HIP-904): se entrega de inmediato si hay un espacio de auto-asociación libre; si no, queda pendiente hasta reclamarlo.
    const pendingDropRes = await new TokenAirdropTransaction()
      .addTokenTransfer(tokenId, operatorId, -500)
      .addTokenTransfer(tokenId, dormantId, 500)
      .execute(client)
    const pendingDropRecord = await pendingDropRes.getRecord(client)
    const pendingAirdropId = pendingDropRecord.newPendingAirdrops?.[0]?.airdropId ||
      new PendingAirdropId({ senderId: operatorId, receiverId: dormantId, tokenId })
    console.log('[ÉXITO] El Airdrop se encuentra PENDIENTE en el ledger.')

    console.log('[PROCESO] Emisor ejecutando `TokenCancelAirdropTransaction` para recuperar el airdrop no reclamado...')
    // Cancela: quien envía recupera un airdrop que nunca se reclamó.
    const cancelRes = await new TokenCancelAirdropTransaction()
      .addPendingAirdropId(pendingAirdropId)
      .execute(client)
    const cancelReceipt = await cancelRes.getReceipt(client)
    console.log(`[ÉXITO] ¡Airdrop Pendiente Cancelado! Estado: ${cancelReceipt.status.toString()}`)

    // 3. PARTE B: El Destinatario Rechaza un Airdrop Auto-Asociado (`TokenRejectTransaction`)
    console.log('\n[PROCESO] Parte B: Creando Cuenta de Usuario Soberano (Con Auto-Asociación Activa)...')
    const userKey = PrivateKey.generateED25519()
    const userRes = await new AccountCreateTransaction()
      .setKeyWithoutAlias(userKey.publicKey)
      .setInitialBalance(new Hbar(0))
      .setMaxAutomaticTokenAssociations(5) // ¡El airdrop entra directo a la billetera!
      .execute(client)
    const userId = (await userRes.getReceipt(client)).accountId
    console.log(`[ACTOR] Usuario Soberano: ${userId.toString()} (Espacios Auto-Asociación: 5)`)

    console.log(`[PROCESO] Enviando Airdrop de 750 PROMO directamente a ${userId.toString()}...`)
    const instantDropRes = await new TokenAirdropTransaction()
      .addTokenTransfer(tokenId, operatorId, -750)
      .addTokenTransfer(tokenId, userId, 750)
      .execute(client)
    await instantDropRes.getReceipt(client)

    await sleep(3500)
    const userBalBefore = await new MirrorNodeTokenBalanceQuery()
      .setAccountId(userId)
      .setTokenId(tokenId)
      .execute(client)
    console.log(`[REGISTRO] Balance del Usuario Antes de Rechazar: ${userBalBefore.balance.toString()} PROMO`)

    console.log('[PROCESO] Usuario ejecutando `TokenRejectTransaction` para devolver los tokens a Tesorería...')
    // Rechaza: el tenedor devuelve a la tesorería tokens no deseados (anti-spam).
    const rejectTx = await new TokenRejectTransaction()
      .setOwnerId(userId)
      .addTokenId(tokenId)
      .freezeWith(client)
    const signedReject = await rejectTx.sign(userKey)
    const rejectRes = await signedReject.execute(client)
    const rejectReceipt = await rejectRes.getReceipt(client)
    console.log(`[ÉXITO] ¡Token Rechazado por el Usuario! Estado: ${rejectReceipt.status.toString()}`)

    await sleep(3500)
    const treasuryBalAfter = await new MirrorNodeTokenBalanceQuery()
      .setAccountId(operatorId)
      .setTokenId(tokenId)
      .execute(client)
    console.log(`[REGISTRO] Balance de Tesorería Restaurado: ${treasuryBalAfter.balance.toString()} / 10000 PROMO`)

    updateState('HIP904_PROMO_TOKEN_ID', tokenId.toString())
    updateState('HIP904_REJECT_STATUS', rejectReceipt.status.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('La HIP-904 cierra el círculo de distribución de tokens: los emisores pueden cancelar')
    console.log('airdrops no reclamados y los usuarios pueden rechazar tokens no deseados devolviéndolos')
    console.log('a la tesorería sin pagar las tarifas personalizadas del token.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('No transfieras tokens spam a mano: una transferencia normal puede cobrar las tarifas personalizadas del token.')
    console.log('`TokenRejectTransaction` los devuelve a la tesorería sin esas tarifas.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en Cancelación/Rechazo HIP-904:', error.message)
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
