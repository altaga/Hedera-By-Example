/**
 * ============================================================================
 * Lab 09: Actualización en Tesorería con Supply-Key y Bloqueo Post-Envío (HIP-850)
 * [CONCEPTO] Minteo Dinámico Pre-Distribución vs. Inmutabilidad para el Coleccionista
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Antes de la HIP-850, los creadores enfrentaban un dilema: omitir la `metadataKey`
 * (haciendo imposible corregir errores o revelar cajas misteriosas en tesorería)
 * o incluir una `metadataKey` (haciendo temer a los compradores que el emisor altere
 * su NFT DESPUÉS de haberlo comprado).
 * La HIP-850 resuelve esto en la capa de consenso: INCLUSO SIN `metadataKey`, la
 * `supplyKey` está autorizada para actualizar los metadatos vía `TokenUpdateNftsTransaction`
 * ÚNICAMENTE mientras el número de serie permanezca en la Cuenta de Tesorería.
 * ¡En el instante en que el NFT se transfiere al usuario, sus metadatos quedan bloqueados para siempre!
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Esta es la primitiva definitiva para "Blind Boxes" / Revelaciones en Web3: puedes mintear
 * 10,000 cajas misteriosas en tesorería, revelar sus metadatos con la Supply Key, y una vez
 * entregadas al usuario, la red garantiza matemáticamente que nadie jamás podrá alterar su activo.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-850
 * - https://hips.hedera.com/hip/hip-657
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M3 Lab 08: Esquema de Metadatos HIP-412
 * - Siguiente: M4 Lab 01: Transferencias HBAR
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~15 ℏ en cada ejecución (crea un token, cerca de 1 USD).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M3_Hedera_Token_Service/09_hip850_treasury_nft_lock.js
 * ============================================================================
 */

import {
  AccountCreateTransaction,
  Hbar,
  NftId,
  PrivateKey,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenNftInfoQuery,
  TokenSupplyType,
  TokenType,
  TokenUpdateNftsTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Actualización en Tesorería y Bloqueo HIP-850 ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const supplyKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Crear Colección NFT SOLO con SupplyKey (¡SIN MetadataKey!)
    console.log('[PROCESO] Creando Colección NFT únicamente con SupplyKey (Sin MetadataKey)...')
    // Crea el token: sus llaves (admin, supply, KYC, freeze...) deciden quién puede cambiarlo después.
    const createTx = await new TokenCreateTransaction()
      .setTokenName('Boveda Misteriosa HIP-850')
      .setTokenSymbol('VAULT')
      .setTokenType(TokenType.NonFungibleUnique)
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(50)
      .setTreasuryAccountId(operatorId)
      .setSupplyKey(supplyKey)
      .freezeWith(client)

    const signedCreate = await createTx.sign(supplyKey)
    const createRes = await signedCreate.execute(client)
    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const createReceipt = await createRes.getReceipt(client)
    const tokenId = createReceipt.tokenId
    console.log(`[ÉXITO] Colección Creada: ${tokenId.toString()} (MetadataKey: NINGUNA)`)

    // 2. Mintear Serie #1 con metadatos "Caja Misteriosa Sin Revelar" en Tesorería
    console.log('\n[PROCESO] Minteando Serie #1 en Tesorería (Estado Sin Revelar)...')
    const unrevealedMeta = Buffer.from('ipfs://bafkrei-mystery-box-unrevealed/box1.json')
    // Acuña: solo la supply key puede crear nuevas unidades o seriales NFT.
    const mintTx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata([unrevealedMeta])
      .freezeWith(client)

    const signedMint = await mintTx.sign(supplyKey)
    const mintRes = await signedMint.execute(client)
    const mintReceipt = await mintRes.getReceipt(client)
    const serialNum = mintReceipt.serials[0].toNumber()

    let nftInfo = await new TokenNftInfoQuery()
      .setNftId(new NftId(tokenId, serialNum))
      .execute(client)
    console.log(`[REGISTRO] Serie #${serialNum} Metadatos Iniciales: ${Buffer.from(nftInfo[0].metadata).toString()}`)

    // 3. HIP-850 en Acción: ¡Actualizar Metadatos en Tesorería usando SOLO la SupplyKey!
    console.log('\n[PROCESO] [HIP-850] Revelando Serie #1 en Tesorería usando SupplyKey...')
    const revealedMeta = Buffer.from('ipfs://bafkrei-genesis-dragon-revealed/dragon1.json')
    // Actualiza la metadata del NFT: solo la metadata key puede hacerlo (HIP-657).
    const updateTreasuryTx = await new TokenUpdateNftsTransaction()
      .setTokenId(tokenId)
      .setSerialNumbers([serialNum])
      .setMetadata(revealedMeta)
      .freezeWith(client)

    const signedTreasuryUpdate = await updateTreasuryTx.sign(supplyKey)
    const updateRes = await signedTreasuryUpdate.execute(client)
    await updateRes.getReceipt(client)

    nftInfo = await new TokenNftInfoQuery()
      .setNftId(new NftId(tokenId, serialNum))
      .execute(client)
    console.log('[ÉXITO] ¡Revelación en Tesorería HIP-850 Exitosa!')
    console.log(`[REGISTRO] Serie #${serialNum} Metadatos Revelados: ${Buffer.from(nftInfo[0].metadata).toString()}`)

    // 4. Transferir Serie #1 fuera de la Tesorería hacia la Cuenta del Coleccionista
    console.log('\n[PROCESO] Creando Cuenta de Coleccionista y transfiriendo Serie #1 fuera de Tesorería...')
    // Genera una llave localmente: la llave privada nunca sale de este proceso.
    const collectorKey = PrivateKey.generateED25519()
    // Crea una cuenta: su llave la controla; el saldo inicial lo pone quien paga.
    const accRes = await new AccountCreateTransaction()
      .setKeyWithoutAlias(collectorKey.publicKey)
      .setInitialBalance(new Hbar(0))
      .setMaxAutomaticTokenAssociations(5)
      .execute(client)
    const collectorId = (await accRes.getReceipt(client)).accountId

    // Arma la transferencia: los débitos (negativos) y créditos (positivos) de una transacción deben sumar cero.
    const transferRes = await new TransferTransaction()
      .addNftTransfer(tokenId, serialNum, operatorId, collectorId)
      .execute(client)
    await transferRes.getReceipt(client)
    console.log(`[ÉXITO] ¡Serie #${serialNum} entregado al Coleccionista (${collectorId.toString()})!`)

    // 5. Demostrar el Bloqueo de Inmutabilidad Post-Distribución: ¡SupplyKey YA NO PUEDE mutarlo!
    console.log('\n[PROCESO] Intentando mutar Serie #1 DESPUÉS de salir de Tesorería (Debe FALLAR)...')
    let lockedAsExpected = false
    try {
      const illegalUpdateTx = await new TokenUpdateNftsTransaction()
        .setTokenId(tokenId)
        .setSerialNumbers([serialNum])
        .setMetadata(Buffer.from('ipfs://rugged-metadata'))
        .freezeWith(client)
      const signedIllegal = await illegalUpdateTx.sign(supplyKey)
      const illegalRes = await signedIllegal.execute(client)
      await illegalRes.getReceipt(client)
    } catch (err) {
      lockedAsExpected = true
      console.log(`[ INMUTABILIDAD BLOQUEADA] El consenso rechazó la edición post-distribución: ${err.message}`)
    }

    updateState('HIP850_TOKEN_ID', tokenId.toString())
    updateState('HIP850_COLLECTOR_ID', collectorId.toString())
    updateState('HIP850_IMMUTABILITY_VERIFIED', lockedAsExpected)

    console.log('\n CONCEPTO CLAVE:')
    console.log('La HIP-850 otorga flexibilidad pre-distribución en la Cuenta de Tesorería')
    console.log('mientras garantiza un 100% de inmutabilidad matemática cuando el NFT llega al coleccionista.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('La seguridad y la experiencia de usuario no tienen por qué oponerse. Al vincular la mutabilidad')
    console.log('a la custodia en Tesorería, Hedera elimina el riesgo de "rug-pull de metadatos" para el comprador.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo en Ejecución de HIP-850:', error.message)
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
