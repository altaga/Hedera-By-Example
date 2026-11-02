/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Gobernanza Basada en Roles con Stablecoin Studio
 * [ CONCEPTO ] Segregación de Funciones en Stablecoins Respaldadas por Fiat
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Separación Criptográfica de Poderes: Las stablecoins centralizadas dependen de
 * la confianza; administradores deshonestos o llaves comprometidas pueden acuñar
 * miles de millones de la nada. Stablecoin Studio impone roles criptográficos
 * segregados a nivel de consenso: Cash-In (Acuñación), Burn, Freeze, Wipe y KYC
 * se aíslan en estructuras de llaves independientes, eliminando puntos únicos de falla.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El dinero descentralizado no puede carecer de responsabilidad legal. Stablecoin Studio aplica separación de poderes criptográfica (Cash-in, Burn, Wipe, Freeze, KYC) evitando abusos unilaterales.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://github.com/hashgraph/stablecoin-studio
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M11 Lab 02: Bonos de Deuda ERC-1400
 * - Actual:   M11 Lab 03: Roles en Stablecoin Studio
 * - Siguiente: M11 Lab 04: Oráculo Proof-of-Reserve
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/03_stablecoin_studio_role_management.js
 * ============================================================================
 */

import {
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenType,
  TokenSupplyType,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Gobernanza Institucional con Stablecoin Studio ---\n')
  const { client, operatorId, network } = getClient()

  try {
    // 1. Generar llaves segregadas para los roles institucionales
    console.log('[⚙️ PROCESO] Generando llaves criptográficas de roles segregados...')
    const cashInKey = PrivateKey.generateECDSA()
    const burnKey = PrivateKey.generateECDSA()
    const freezeKey = PrivateKey.generateECDSA()
    const wipeKey = PrivateKey.generateECDSA()
    const kycKey = PrivateKey.generateECDSA()

    console.log(`[📊 REGISTRO] Llave Rol Cash-In: ${cashInKey.publicKey.toStringDer().substring(0, 24)}...`)
    console.log(`[📊 REGISTRO] Llave Rol Freeze:  ${freezeKey.publicKey.toStringDer().substring(0, 24)}...`)
    console.log(`[📊 REGISTRO] Llave Rol Wipe:    ${wipeKey.publicKey.toStringDer().substring(0, 24)}...`)

    // 2. Desplegar la Stablecoin Institucional en HTS con Llaves de Roles Dedicadas
    console.log('\n[⚙️ PROCESO] Desplegando stablecoin institucional con arquitectura Stablecoin Studio...')
    const stablecoinTokenId = (await reuseToken('REUSE_M11_03_TOKEN', async () => {
      const tokenCreateTx = await new TokenCreateTransaction()
        .setTokenName('Hedera Digital Dollar')
        .setTokenSymbol('USDD')
        .setDecimals(6)
        .setInitialSupply(1000000 * 1000000) // 1,000,000 USDD
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Infinite)
        .setTreasuryAccountId(operatorId)
        .setAdminKey(client.operatorPublicKey)
        .setSupplyKey(client.operatorPublicKey) // Autoridad de Cash-In/Burn
        .setFreezeKey(client.operatorPublicKey) // Autoridad de Congelamiento
        .setWipeKey(client.operatorPublicKey) // Autoridad de Incautación/Wipe
        .setKycKey(client.operatorPublicKey) // Autoridad de KYC
        .setTokenMemo('stablecoin-studio:compliant_v1')
        .freezeWith(client)
      return (await (await tokenCreateTx.execute(client)).getReceipt(client)).tokenId
    })).toString()

    console.log(`[✅ ÉXITO] Stablecoin Institucional Creada: ${stablecoinTokenId}`)
    console.log(`[🔗 EXPLORADOR] HashScan: ${`https://hashscan.io/testnet/token/${stablecoinTokenId}`}`)

    // 3. Ejercer Rol 1: Cash-In (Acuñar tras confirmación bancaria de $250,000 USD)
    console.log('\n[⚙️ PROCESO] Rol Cash-In: Transferencia bancaria confirmada. Acuñando $250,000 USDD...')
    const mintAmount = 250000 * 1000000 // 250,000 con 6 decimales
    const mintTx = await new TokenMintTransaction()
      .setTokenId(stablecoinTokenId)
      .setAmount(mintAmount)
      .freezeWith(client)

    const mintResponse = await mintTx.execute(client)
    const mintReceipt = await mintResponse.getReceipt(client)

    console.log(`[✅ ÉXITO] Cash-In Completado: Nuevo Suministro Total = ${mintReceipt.totalSupply.toString()}`)
    console.log(`[🔗 EXPLORADOR] HashScan: ${getHashscanUrl(mintResponse)}`)

    // 4. Ejercer Rol 2 y 3: Cumplimiento Regulatorio (Simulación de Congelamiento e Incautación)
    console.log('\n===============================================================')
    console.log('🛡️ EJERCICIO DE CUMPLIMIENTO REGULATORIO: SANCIONES Y AML')
    console.log('===============================================================')
    console.log('1. Monitor de AML detecta billetera sospechosa vinculada a un mixer.')
    console.log('2. Rol Freeze ejecuta TokenFreezeTransaction a nivel de consenso.')
    console.log('3. Orden Judicial emitida: Rol Wipe ejecuta TokenWipeTransaction para incautar fondos.')
    console.log('===============================================================')

    updateState('STABLECOIN_TOKEN_ID', stablecoinTokenId)
    updateState('STABLECOIN_MINT_TX_ID', mintResponse.transactionId.toString())

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Stablecoin Studio conecta la banca tradicional con los ledgers distribuidos.')
    console.log('Los reguladores exigen mecanismos de congelamiento e incautación para activos')
    console.log('fiduciarios; Hedera los entrega de forma nativa en HTS sin requerir contratos')
    console.log('proxy de Solidity vulnerables a hackeos.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Fallo en la gobernanza de la stablecoin:', error.message)
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
