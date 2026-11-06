/**
 * ============================================================================
 * Laboratorio 06: Airdrops Nativos (HIP-904)
 * [CONCEPTO] Distribución de Tokens sin Fricción
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Históricamente, los usuarios tenían que asociar un token manualmente (pagando
 * una tarifa) antes de poder recibirlo. Esto hacía los airdrops muy difíciles.
 * Con la HIP-904, los desarrolladores pueden usar `TokenAirdropTransaction`
 * para enviar tokens a cuentas que no los han asociado. Los tokens entran en
 * un estado "pendiente". El usuario luego puede usar `TokenClaimAirdropTransaction`
 * para reclamarlos, lo que asocia automáticamente el token y transfiere el balance.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los airdrops nativos HIP-904 entregan tokens directamente al destinatario: si la cuenta tiene slots libres de auto-asociación, la entrega es instantánea; si están llenos, se crea un registro de reclamo pendiente.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-904
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M4 Lab 05: Transferencias Paralelas
 * - Siguiente: M4 Lab 07: Cancelación de Airdrop y Rechazo de Tokens (HIP-904)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD); ~2 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node 06_native_airdrops.js
 * ============================================================================
 */

import {
  PrivateKey,
  PendingAirdropId,
  TokenCreateTransaction,
  TokenAirdropTransaction,
  TokenClaimAirdropTransaction,
  AccountCreateTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Airdrops Nativos ---\n')

  const { client, operatorKey, operatorId } = getClient()
  const supplyKey = PrivateKey.fromString(operatorKey)

  try {
    // 1. Crear una cuenta receptora (¡que NO asociará el token!)
    console.log('[PROCESO] Creando una nueva cuenta receptora...')
    const receiverKey = PrivateKey.generateED25519()
    let tx = await new AccountCreateTransaction()
      .setKey(receiverKey)
      .setInitialBalance(new Hbar(0))
      .execute(client)

    const receipt = await tx.getReceipt(client)
    const receiverId = receipt.accountId
    console.log(`[ÉXITO] Cuenta Receptora creada: ${receiverId.toString()}`)

    // 2. Crear un nuevo token fungible
    console.log('\n[PROCESO] Creando un Token para Airdrop...')
    const tokenId = await reuseToken('REUSE_M4_06_TOKEN', async () => {
      const createTx = await new TokenCreateTransaction()
        .setTokenName('AirdropCoin')
        .setTokenSymbol('DROP')
        .setDecimals(2)
        .setInitialSupply(100000) // 1,000.00
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(supplyKey)
        .freezeWith(client)
      return (await (await (await createTx.sign(supplyKey)).execute(client)).getReceipt(client)).tokenId
    }, { minBalance: 500 })
    console.log(`[ÉXITO] Token creado: ${tokenId.toString()}`)

    // 3. Realizar el Airdrop (¡enviando a una cuenta no asociada!)
    console.log(`\n[PROCESO] Haciendo Airdrop de 5.00 DROP a ${receiverId.toString()}...`)
    tx = await new TokenAirdropTransaction()
      .addTokenTransfer(tokenId, operatorId, -500) // 5.00 DROP (2 decimales)
      .addTokenTransfer(tokenId, receiverId, 500)
      .execute(client)

    const airdropRecord = await tx.getRecord(client)
    const pendingAirdropId = airdropRecord.newPendingAirdrops?.[0]?.airdropId ||
      new PendingAirdropId({ senderId: operatorId, receiverId, tokenId })
    console.log('[ÉXITO] ¡Transacción de airdrop enviada! Los tokens ahora están PENDIENTES.')

    // 4. El receptor reclama el airdrop
    console.log('\n[PROCESO] El receptor está reclamando el airdrop pendiente...')
    tx = await new TokenClaimAirdropTransaction()
      .addPendingAirdropId(pendingAirdropId)
      .freezeWith(client)

    const signTx = await tx.sign(receiverKey)
    const submitTx = await signTx.execute(client)
    await submitTx.getReceipt(client)

    console.log('[ÉXITO] ¡Airdrop reclamado exitosamente!')

    console.log('\n CONCEPTO CLAVE:')
    console.log('Los Airdrops ya no requieren contratos inteligentes complejos ni rogarle')
    console.log('a los usuarios que asocien tu token primero. Tú envías los tokens, ellos los reclaman.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Error de Ejecución:', error.message)
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
