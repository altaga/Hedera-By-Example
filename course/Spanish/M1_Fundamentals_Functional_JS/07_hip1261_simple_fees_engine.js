/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 07: Motor de Tarifas Simples y Precios Deterministas HIP-1261
 * [ CONCEPTO ] Modelado de Tarifas Predecibles en Hedera (Node, Network, Service)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * A diferencia de las subastas de gas de Ethereum, donde los precios se
 * multiplican por 100 durante la congestión de la red, Hedera utiliza un
 * esquema de tarifas determinista anclado al dólar estadounidense (HIP-1261).
 *
 * El costo de cada transacción se divide estrictamente en tres componentes:
 * 1. Node Fee: Compensa al nodo de consenso específico que recibe la tx ($0.0001 USD).
 * 2. Network Fee: Compensa a todos los nodos por el gossip y el ordenamiento ($0.0008 USD).
 * 3. Service Fee: Compensa a la red por la mutación del estado (CryptoTransfer = $0.0001 USD).
 *
 * Este laboratorio interroga el archivo de tipo de cambio en vivo de Hedera, calcula
 * el costo exacto en tinybars antes de la transmisión, ejecuta la transacción y
 * verifica la tarifa liquidada con precisión sub-centavo.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * A diferencia de las subastas de gas que expulsan a los usuarios en momentos de alta congestión, las comisiones de Hedera están fijadas en USD ($0.0001 por mensaje, $0.001 por transferencia) y convertidas deterministamente a HBAR.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-1261
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M1 Lab 06: Staking Nativo
 * - Siguiente: M1 Lab 08: Asignación de Tarifas Sin Gas HIP-1068
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M1_Fundamentals_Functional_JS/07_hip1261_simple_fees_engine.js
 * ============================================================================
 */

import { TransferTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getMirrorNodeBaseUrl, updateState } from '../M99_Utilities/index.js'

/**
 * Consulta el archivo de tipo de cambio USD/HBAR en vivo desde el Mirror Node.
 *
 * @param {string} mirrorBase - URL base del Mirror Node
 * @returns {Promise<Object>} { cents, hbarEquiv, rateUsdPerHbar, expiration }
 */
const fetchExchangeRate = async (mirrorBase) => {
  const response = await fetch(`${mirrorBase}/api/v1/network/exchangerate`)
  if (!response.ok) {
    throw new Error(`Error en API de tipo de cambio del Mirror Node: ${response.statusText}`)
  }
  const data = await response.json()
  const { current_rate: current } = data
  const rateUsdPerHbar = (current.cent_equivalent / current.hbar_equivalent) / 100

  return {
    cents: current.cent_equivalent,
    hbarEquiv: current.hbar_equivalent,
    rateUsdPerHbar,
    expiration: new Date(current.expiration_time * 1000).toISOString()
  }
}

/**
 * Calcula el costo exacto en tinybars para una tarifa en USD según HIP-1261.
 *
 * @param {number} feeUsd - Tarifa en USD
 * @param {number} cents - Equivalente en centavos del tipo de cambio de la red
 * @param {number} hbarEquiv - Equivalente en HBAR del tipo de cambio de la red
 * @returns {number} Costo en tinybars (1 HBAR = 100,000,000 tinybars)
 */
const calculateTinybars = (feeUsd, cents, hbarEquiv) => {
  const tinybars = Math.round((feeUsd * 100 * hbarEquiv * 100_000_000) / cents)
  return tinybars
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Motor de Tarifas Simples HIP-1261 ---\n')

  const { client, operatorId } = getClient()
  const mirrorBase = getMirrorNodeBaseUrl()

  try {
    console.log('[⚙️ PROCESO] Paso 1: Interrogando tipo de cambio de red en vivo desde Mirror Node...')
    const rateInfo = await fetchExchangeRate(mirrorBase)

    console.log('\n--- 💱 TIPO DE CAMBIO ON-CHAIN EN HEDERA ---')
    console.log(`🔹 Tasa USD por HBAR:   $${rateInfo.rateUsdPerHbar.toFixed(4)}`)
    console.log(`🔹 Equivalente HBAR:    ${rateInfo.hbarEquiv} ℏ`)
    console.log(`🔹 Equivalente Céntimos: ${rateInfo.cents} ¢`)
    console.log(`🔹 Vencimiento de Tasa: ${rateInfo.expiration}`)

    console.log('\n[⚙️ PROCESO] Paso 2: Descomponiendo esquema de tarifas HIP-1261 para CryptoTransfer...')

    // Constantes en USD de la tabla de tarifas estándar de Hedera para CryptoTransfer
    const NODE_FEE_USD = 0.0001
    const NETWORK_FEE_USD = 0.0008
    const SERVICE_FEE_USD = 0.0001
    const TOTAL_STANDARD_FEE_USD = NODE_FEE_USD + NETWORK_FEE_USD + SERVICE_FEE_USD // $0.0010 USD total

    const nodeFeeTinybars = calculateTinybars(NODE_FEE_USD, rateInfo.cents, rateInfo.hbarEquiv)
    const networkFeeTinybars = calculateTinybars(NETWORK_FEE_USD, rateInfo.cents, rateInfo.hbarEquiv)
    const serviceFeeTinybars = calculateTinybars(SERVICE_FEE_USD, rateInfo.cents, rateInfo.hbarEquiv)
    const totalPredictedTinybars = nodeFeeTinybars + networkFeeTinybars + serviceFeeTinybars

    console.log('\n--- 📊 DESGLOSE PREDICTIVO DE TARIFAS (HIP-1261) ---')
    console.log(`🔹 Node Fee:     $${NODE_FEE_USD.toFixed(4)} USD -> ${nodeFeeTinybars.toLocaleString()} tinybars`)
    console.log(`🔹 Network Fee:  $${NETWORK_FEE_USD.toFixed(4)} USD -> ${networkFeeTinybars.toLocaleString()} tinybars`)
    console.log(`🔹 Service Fee:  $${SERVICE_FEE_USD.toFixed(4)} USD -> ${serviceFeeTinybars.toLocaleString()} tinybars`)
    console.log(`🔹 Cotización:   $${TOTAL_STANDARD_FEE_USD.toFixed(4)} USD -> ${totalPredictedTinybars.toLocaleString()} tinybars (~${(totalPredictedTinybars / 1e8).toFixed(6)} ℏ)`)

    console.log('\n[⚙️ PROCESO] Paso 3: Ejecutando CryptoTransfer en vivo para verificar facturación de consenso...')

    // Transacción de prueba: transferir 0 HBAR a sí mismo
    const transaction = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(0))
      .freezeWith(client)

    const response = await transaction.execute(client)
    const record = await response.getRecord(client)
    const actualFeeTinybars = record.transactionFee.toTinybars().toNumber()
    const actualFeeUsd = (actualFeeTinybars / 1e8) * rateInfo.rateUsdPerHbar

    console.log('\n--- 🎯 VERIFICACIÓN DE FACTURACIÓN EN CONSENSO ---')
    console.log(`🔹 Estado de Consenso:  ${record.receipt.status.toString()}`)
    console.log(`🔹 ID de Transacción:   ${response.transactionId.toString()}`)
    console.log(`🔹 Tarifa Real Cobrada: ${actualFeeTinybars.toLocaleString()} tinybars (${record.transactionFee.toString()})`)
    console.log(`🔹 Tarifa Real en USD:  $${actualFeeUsd.toFixed(6)} USD`)
    console.log(`🔹 Variación vs Cuota:  ${Math.abs(actualFeeTinybars - totalPredictedTinybars).toLocaleString()} tinybars`)
    console.log(`[🔗 EXPLORADOR] Ver en HashScan: ${getHashscanUrl(response)}`)

    updateState('HIP1261_LAST_TX_ID', response.transactionId.toString())
    updateState('HIP1261_ACTUAL_FEE_TINYBARS', actualFeeTinybars)
    updateState('HIP1261_RATE_USD_PER_HBAR', rateInfo.rateUsdPerHbar)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Cero Subastas de Gas: En Hedera, las tarifas son fijas en USD y deterministas.')
    console.log('Las empresas presupuestan sus costos de ledger con 100% de previsibilidad financiera,')
    console.log('sabiendo que una transferencia cuesta exactamente $0.001 USD sin importar el volumen de red.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error(`\n[❌ ERROR] Falló el Cálculo del Motor de Tarifas: ${error.message}`)
    if (client) client.close()
    process.exit(1)
  }
}

main()
