/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Renta de Estado y Ciclo de Vida de la Cuenta
 * [CONCEPTO] Sostenibilidad y Almacenamiento Serverless
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * State Rent: A diferencia de otras blockchains donde el crecimiento del
 * estado es descontrolado, Hedera implementa un modelo de "Renta del Estado".
 * Cada 90 días, la red deduce una pequeña tarifa (~$0.01 USD) para cubrir
 * el costo de memoria en los nodos. Este diseño mantiene la red liviana,
 * predecible y auditable. Con unos pocos HBAR, una cuenta puede mantenerse
 * activa por décadas de forma autónoma.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El almacenamiento de estado en redes públicas no es gratuito. Configurar un periodo de auto-renovación explícito y designar una cuenta pagadora evita que contratos o entidades expiren inesperadamente.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/accounts/account-properties
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M1 Lab 01: Simulación de Consenso
 * - Actual:   M1 Lab 02: Renta de Cuentas
 * - Siguiente: M1 Lab 03: Criptografía y KMS
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 02_account_rent.js
 * ============================================================================
 */

import { AccountId, MirrorNodeAccountBalanceQuery } from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Calculadora de Ciclo de Vida de Renta ---\n')

  const { client } = getClient()
  const targetAccountId = process.env.ACCOUNT_1_ID

  if (!targetAccountId) {
    console.error('[FALLO] Falta ACCOUNT_1_ID en el archivo .env.')
    process.exitCode = 1
    return
  }

  try {
    // --- ETAPA 1: TELEMETRÍA DE MERCADO (Oráculo del Mirror Node) ---
    console.log('[PROCESO] Consultando oráculo del Mirror Node para tasa de cambio...')

    const mirrorUrl = getMirrorNodeBaseUrl()
    const response = await fetch(`${mirrorUrl}/api/v1/network/exchangerate`)
    const rateData = await response.json()

    const currentRate = rateData.current_rate
    const liveHbarPrice = (currentRate.cent_equivalent / currentRate.hbar_equivalent) / 100
    console.log(`[REGISTRO] Precio en Vivo: 1 HBAR = $${liveHbarPrice.toFixed(4)} USD`)

    // --- ETAPA 2: TELEMETRÍA DE SALDO ---
    console.log(`[PROCESO] Consultando saldo para la cuenta ${targetAccountId}...`)
    const query = new MirrorNodeAccountBalanceQuery().setAccountId(AccountId.fromString(targetAccountId))
    const balance = await query.execute(client)

    const currentHbar = Number(balance.hbars.toTinybars()) / 100000000
    console.log(`[REGISTRO] Saldo Actual: ${balance.hbars.toString()} (${currentHbar} HBAR)`)

    // --- ETAPA 3: PROYECCIÓN DE RENTA ---
    const renewalFeeUsd = 0.01 // Costo fijo por ciclo de 90 días
    const totalUsdValue = currentHbar * liveHbarPrice
    const totalCycles = totalUsdValue / renewalFeeUsd
    const totalDaysCovered = totalCycles * 90
    const totalYearsCovered = (totalDaysCovered / 365).toFixed(1)

    console.log('\n---  [REGISTRO] Resumen de Autonomía de Renta ---')
    console.log(`└─ Valor USD Total:   $${totalUsdValue.toFixed(4)} USD`)
    console.log(`└─ Ciclos de Renov.:  ${Math.floor(totalCycles)} periodos de 90 días`)
    console.log(`└─ Días Totales:      ~${Math.floor(totalDaysCovered)} Días`)
    console.log(`└─ Vida Útil Total:   ~${totalYearsCovered} Años`)

    console.log('\n[ÉXITO] Proyección de ciclo de vida calculada.')

    console.log('\n CONCEPTO CLAVE:')
    console.log('Mientras esta cuenta mantenga HBAR, pagará automáticamente su propia')
    console.log('renta cada 90 días. Si el saldo llega a 0, el nodo eventualmente')
    console.log('eliminará la cuenta para liberar memoria, garantizando la eficiencia')
    console.log('del ledger a largo plazo.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] La consulta de renta falló:', error.message)
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
