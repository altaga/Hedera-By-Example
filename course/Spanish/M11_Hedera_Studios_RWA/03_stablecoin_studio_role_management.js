/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Roles de Stablecoin en HTS (Conceptos de Stablecoin Studio)
 * [CONCEPTO] Segregación de Funciones en Stablecoins Respaldadas por Fiat
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Una stablecoin respaldada por fiat necesita poderes separados: Cash-In (acuñar/quemar),
 * Freeze, Wipe y KYC. HTS permite que cada poder sea una clave DISTINTA del token,
 * aplicada por la red. Este lab crea un token con cinco claves de rol y lo demuestra:
 *   - una acuñación firmada solo por el operador se rechaza (INVALID_SIGNATURE);
 *   - la clave Cash-In acuña; la clave KYC aprueba a un tenedor;
 *   - la clave Freeze congela al tenedor y una transferencia hacia él se rechaza;
 *   - la clave Wipe borra el saldo del tenedor (recuperación por orden judicial).
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Stablecoin Studio de Hedera construye el mismo modelo de roles con su propio SDK y
 * contratos factory; este lab muestra directamente los roles nativos de HTS.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://github.com/hashgraph/stablecoin-studio
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/define-a-token
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M11 Lab 02: Bonos por Tramos en HTS y Pago de Cupones (Conceptos ERC-1400)
 * - Siguiente: M11 Lab 04: Oráculo Proof-of-Reserve
 *
 * [SIMULADO]
 * La transferencia bancaria y las decisiones AML/judiciales son narrativas; las claves de rol, la acuñación, KYC, freeze y wipe son reales. No se usan el SDK ni los contratos de Stablecoin Studio.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (crea un token y 1 tenedor desechable).
 * - Costo: ~15 ℏ (creación del token, cerca de 1 USD) + 0.05 ℏ para el tenedor + comisiones.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/03_stablecoin_studio_role_management.js
 * ============================================================================
 */

import {
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenFreezeTransaction,
  TokenGrantKycTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType,
  TokenWipeTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { createLabAccount, getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

const run = async (tx, client, ...keys) => {
  const frozen = tx.freezeWith(client)
  for (const k of keys) await frozen.sign(k)
  const res = await frozen.execute(client)
  return { res, receipt: await res.getReceipt(client) }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Roles de Stablecoin en HTS ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Claves de rol segregadas
    console.log('[PROCESO] Paso 1: Generando claves de rol segregadas...')
    const roles = {
      cashIn: PrivateKey.generateECDSA(),
      freeze: PrivateKey.generateECDSA(),
      wipe: PrivateKey.generateECDSA(),
      kyc: PrivateKey.generateECDSA()
    }
    for (const [name, key] of Object.entries(roles)) console.log(`[LOG] ${name.padEnd(6)} clave: ${key.publicKey.toStringRaw().substring(0, 20)}...`)

    // 2. Token donde cada poder es una clave distinta
    console.log('\n[PROCESO] Paso 2: Creando la stablecoin con una clave por rol...')
    const { receipt: createReceipt } = await run(new TokenCreateTransaction()
      .setTokenName('Hedera Digital Dollar')
      .setTokenSymbol('USDD')
      .setDecimals(6)
      .setInitialSupply(0)
      .setTokenType(TokenType.FungibleCommon)
      .setSupplyType(TokenSupplyType.Infinite)
      .setTreasuryAccountId(operatorId)
      .setAdminKey(client.operatorPublicKey)
      .setSupplyKey(roles.cashIn.publicKey)
      .setFreezeKey(roles.freeze.publicKey)
      .setWipeKey(roles.wipe.publicKey)
      .setKycKey(roles.kyc.publicKey)
      .setTokenMemo('hbe:stablecoin-roles'), client)
    const tokenId = createReceipt.tokenId
    console.log(`[ÉXITO] Stablecoin ${tokenId} — https://hashscan.io/testnet/token/${tokenId}`)

    // 3. El operador solo no puede acuñar
    console.log('\n[PROCESO] Paso 3: Acuñación firmada solo por el operador (sin clave Cash-In)...')
    try {
      await run(new TokenMintTransaction().setTokenId(tokenId).setAmount(1_000_000), client)
      throw new Error('La acuñación sin la clave Cash-In debería fallar')
    } catch (error) {
      if (/should fail/.test(error.message)) throw error
      console.log(`[RECHAZADO] ${error.status ?? error.message}`)
    }

    // 4. La clave Cash-In acuña 250,000 USDD
    console.log('\n[PROCESO] Paso 4: El rol Cash-In acuña 250,000 USDD tras la transferencia bancaria (narrativa)...')
    const { res: mintRes, receipt: mintReceipt } = await run(new TokenMintTransaction().setTokenId(tokenId).setAmount(250_000 * 1_000_000), client, roles.cashIn)
    console.log(`[ÉXITO] Suministro total ${mintReceipt.totalSupply} — ${getHashscanUrl(mintRes)}`)

    // 5. KYC + transferencia a un tenedor
    console.log('\n[PROCESO] Paso 5: El rol KYC aprueba a un tenedor; la tesorería envía 1,000 USDD...')
    const holder = await createLabAccount(client, { hbar: 0.05 })
    await run(new TokenAssociateTransaction().setAccountId(holder.accountId).setTokenIds([tokenId]), client, holder.privateKey)
    await run(new TokenGrantKycTransaction().setTokenId(tokenId).setAccountId(holder.accountId), client, roles.kyc)
    const send = (amount) => run(new TransferTransaction()
      .addTokenTransfer(tokenId, operatorId, -amount)
      .addTokenTransfer(tokenId, holder.accountId, amount), client)
    await send(1_000 * 1_000_000)
    console.log(`[ÉXITO] El tenedor ${holder.accountId} recibió 1,000 USDD`)

    // 6. Rol Freeze
    console.log('\n[PROCESO] Paso 6: El rol Freeze congela al tenedor señalado; una nueva transferencia debe fallar...')
    await run(new TokenFreezeTransaction().setTokenId(tokenId).setAccountId(holder.accountId), client, roles.freeze)
    try {
      await send(1_000_000)
      throw new Error('La transferencia a una cuenta congelada debería fallar')
    } catch (error) {
      if (/should fail/.test(error.message)) throw error
      console.log(`[RECHAZADO] ${error.status ?? error.message}`)
    }

    // 7. Rol Wipe
    console.log('\n[PROCESO] Paso 7: El rol Wipe recupera el saldo del tenedor...')
    const { res: wipeRes, receipt: wipeReceipt } = await run(new TokenWipeTransaction().setTokenId(tokenId).setAccountId(holder.accountId).setAmount(1_000 * 1_000_000), client, roles.wipe)
    console.log(`[ÉXITO] Se borraron 1,000 USDD; suministro total ahora ${wipeReceipt.totalSupply} — ${getHashscanUrl(wipeRes)}`)

    updateState('STABLECOIN_TOKEN_ID', tokenId.toString())
    updateState('STABLECOIN_MINT_TX_ID', mintRes.transactionId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Cada poder es una clave separada que verifica la red: ningún administrador puede acuñar,')
    console.log('congelar y recuperar fondos por sí solo.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Falló la gobernanza de la stablecoin:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLIDO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
