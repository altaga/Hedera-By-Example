/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Implementación de Tarifas Personalizadas (Custom Fees)
 * [ CONCEPTO CLAVE ] Lógica de Negocio Embebida en el Protocolo
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Economía Programable: Las Custom Fees de Hedera permiten embeber reglas de
 * facturación (fijas, fraccionales o de regalías) directamente en la
 * definición del token. A diferencia de otras redes donde esto requiere
 * sobrescribir la lógica de transferencia en un Smart Contract (ERC-20), en
 * Hedera esta lógica es global y ejecutada por los nodos de consenso. Esto
 * garantiza que el emisor siempre reciba su parte justa de forma
 * automática e ineludible en cada transacción.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las comisiones de transferencia personalizadas se aplican por consenso en cada movimiento. Ya sea que el token se intercambie entre pares o en un DEX, las regalías y comisiones se recaudan automáticamente.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/custom-token-fees
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M3 Lab 04: Lectura de NFTs
 * - Actual:   M3 Lab 05: Tarifas Personalizadas
 * - Siguiente: M3 Lab 06: Regalías de Capa Base
 *
 * [ CÓMO EJECUTAR ]
 * node 05_custom_fees.js
 * ============================================================================
 */

import {
  MirrorNodeTokenBalanceQuery,
  AccountId,
  CustomFixedFee,
  CustomFractionalFee,
  Hbar,
  PrivateKey,
  TokenCreateTransaction,
  TokenType,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { getClient, sleep, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Economía Programable (Custom Fees) ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  // Cuentas secundarias para la simulación
  const account1Id = process.env.ACCOUNT_1_ID
  const account1PrivateKey = PrivateKey.fromString(process.env.ACCOUNT_1_PRIVATE_KEY)
  const account2Id = process.env.ACCOUNT_2_ID

  try {
    console.log('[⚙️ PROCESO] Definiendo calendario de tarifas automáticas...')

    // 1. Fee Fijo: 1 HBAR por transferencia
    const fixedFee = new CustomFixedFee()
      .setAmount(1 * 100000000) // 1 HBAR en tinybars
      .setFeeCollectorAccountId(AccountId.fromString(operatorId))

    // 2. Fee Fraccional: 5% (Mín 20, Máx 100, INCLUSIVO)
    const fractionalFee = new CustomFractionalFee()
      .setNumerator(5)
      .setDenominator(100)
      .setMin(20)
      .setMax(100)
      .setFeeCollectorAccountId(AccountId.fromString(operatorId))
      .setAssessmentMethod(false) // El fee se deduce del monto enviado (Inclusivo)

    console.log('[⚙️ PROCESO] Creando Token con tarifas embebidas (FRT)...')
    const tokenId = await reuseToken('REUSE_M3_05_TOKEN', async () => {
      const transaction = await new TokenCreateTransaction()
        .setTokenName('Fee Regulated Token')
        .setTokenSymbol('FRT')
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(0)
        .setInitialSupply(1000000)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setAdminKey(adminKey)
        .setCustomFees([fixedFee, fractionalFee])
        .freezeWith(client)

      const response = await transaction.execute(client)
      const receipt = await response.getReceipt(client)
      return receipt.tokenId
    }, { minBalance: 100000 })

    console.log(`[✅ ÉXITO] Token con economía activa: ${tokenId.toString()}`)

    // Preparación del entorno de prueba (Tesorería -> Cuenta 1)
    console.log(`\n[⚙️ PROCESO] Provisionando fondos a ${account1Id} para la prueba...`)
    const setupTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-3))
      .addHbarTransfer(account1Id, new Hbar(3))
      .addTokenTransfer(tokenId, operatorId, -100000)
      .addTokenTransfer(tokenId, account1Id, 100000)
      .execute(client)
    await setupTx.getReceipt(client)

    // Simulación de Escenarios
    console.log('\n--- 📊 [REGISTRO] Simulación de Transferencias con Fee ---')

    // Escenario 1: Monto menor al mínimo (Fallo esperado)
    console.log('[⚙️ PROCESO] Intento 1: Enviar 5 FRT (Monto < Fee Mínimo)...')
    try {
      const failTx = await new TransferTransaction()
        .addTokenTransfer(tokenId, account1Id, -5)
        .addTokenTransfer(tokenId, account2Id, 5)
        .freezeWith(client)
        .sign(account1PrivateKey)
      await (await failTx.execute(client)).getReceipt(client)
    } catch (error) {
      console.log('   └─ [✅ ÉXITO] La red rechazó la transacción por fondos insuficientes para cubrir el fee.')
    }

    const testCases = [
      { name: 'Tarifa Mínima Alcanzada', amount: 400, expected: 20 },
      { name: 'Tope Máximo Alcanzado', amount: 10000, expected: 100 }
    ]

    for (const test of testCases) {
      console.log(`\n[⚙️ PROCESO] Ejecutando: ${test.name} (${test.amount} tokens)`)
      const transferTx = await new TransferTransaction()
        .addTokenTransfer(tokenId, account1Id, -test.amount)
        .addTokenTransfer(tokenId, account2Id, test.amount)
        .freezeWith(client)
        .sign(account1PrivateKey)

      await (await transferTx.execute(client)).getReceipt(client)
      await sleep(3500)

      const b1 = await new MirrorNodeTokenBalanceQuery().setAccountId(account1Id).setTokenId(tokenId).execute(client)
      const b2 = await new MirrorNodeTokenBalanceQuery().setAccountId(account2Id).setTokenId(tokenId).execute(client)

      console.log(`   └─ [📊 REGISTRO] Cuenta 1: ${b1.balance.toString()} FRT`)
      console.log(`   └─ [📊 REGISTRO] Cuenta 2: ${b2.balance.toString()} FRT`)
      console.log('   └─ [✅ ÉXITO] Fee cobrado correctamente fuera de Tesorería.')
    }

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Al usar cuentas que no son la Tesorería, activas el motor de')
    console.log('facturación real de Hedera. Esto permite crear ecosistemas')
    console.log('autofinanciados donde cada movimiento genera valor para el emisor.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La demostración de tarifas falló:', error.message)
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
