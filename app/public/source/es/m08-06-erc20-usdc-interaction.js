/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Integración con Activos ERC-20 (USDC en Hedera)
 * [ CONCEPTO ] Interoperabilidad Real con Activos de Valor Institucional
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La Regla de Precisión: USDC en Hedera es un token ERC-20 real que existe
 * en la EVM. Su interfaz es 100% idéntica a la de Ethereum, operando con
 * 6 decimales. En finanzas descentralizadas (DeFi), 1 USDC = 1,000,000 de
 * unidades mínimas. Un error de redondeo puede significar pérdidas reales
 * para los usuarios; por ello, es una práctica crítica de seguridad
 * consultar siempre el método `decimals()` dinámicamente antes de realizar
 * cualquier cálculo monetario o autorización de gasto (`approve`).
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los tokens nativos de HTS (como Circle USDC en Hedera) son accesibles automáticamente como contratos ERC-20 estándar en sus direcciones EVM derivadas, permitiendo compatibilidad total con DeFi.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/tokens/token-evm-addresses
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M8 Lab 05: Protocolos de Autorización
 * - Actual:   M8 Lab 06: Interacción ERC-20 (USDC)
 * - Siguiente: M8 Lab 07: Asociación de Tokens (Bridge HTS)
 *
 * [ CÓMO EJECUTAR ]
 * node 06_erc20_usdc_interaction.js
 * ============================================================================
 */

import {
  AccountId, TokenId,
  ContractExecuteTransaction, ContractFunctionParameters,
  ContractCallQuery, ContractId
} from '@hiero-ledger/sdk'
import { getClient, getState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Ecosistema ERC-20 (USDC) ---\n')

  const { client } = getClient()
  const USDC_TOKEN_ID = '0.0.429274' // ID de USDC en Testnet
  const ownerEVM = getState('OPERATOR_EVM_ADDRESS')
  const spenderIdStr = getState('ACCOUNT_1_ID')

  if (!ownerEVM || !spenderIdStr) {
    console.error('[❌ FALLO] Faltan OPERATOR_EVM_ADDRESS o ACCOUNT_1_ID en la configuración.')
    return
  }

  try {
    const contractId = ContractId.fromString(USDC_TOKEN_ID)
    const usdcSolidityAddress = '0x' + contractId.toEvmAddress()

    // --- ETAPA 1: INTROSPECCIÓN DEL ACTIVO (Metadatos) ---
    console.log('[⚙️ PROCESO] Extrayendo metadatos dinámicos del token ERC-20...')

    // Consulta de Nombre
    const nameQuery = await new ContractCallQuery()
      .setContractId(contractId).setGas(100000)
      .setFunction('name').execute(client)
    const name = nameQuery.getString(0)

    // Consulta de Símbolo
    const symbolQuery = await new ContractCallQuery()
      .setContractId(contractId).setGas(100000)
      .setFunction('symbol').execute(client)
    const symbol = symbolQuery.getString(0)

    // Consulta de Decimales
    const decimalsQuery = await new ContractCallQuery()
      .setContractId(contractId).setGas(100000)
      .setFunction('decimals').execute(client)
    const decimals = decimalsQuery.getUint8(0)

    console.log('\n--- 📊 [REGISTRO] FICHA TÉCNICA DEL ACTIVO ---')
    console.log(`[ℹ️ INFO]     ${name}`)
    console.log(`[ℹ️ INFO]   ${symbol}`)
    console.log(`[ℹ️ INFO] ${decimals}`)
    console.log(`[ℹ️ INFO] ${usdcSolidityAddress}`)
    console.log('------------------------------------------\n')

    // --- ETAPA 2: TELEMETRÍA DE SALDO ---
    console.log('[⚙️ PROCESO] Obteniendo telemetría de saldo en tiempo real...')
    const balanceTx = await new ContractExecuteTransaction()
      .setContractId(contractId).setGas(1000000)
      .setFunction('balanceOf', new ContractFunctionParameters().addAddress(ownerEVM))
      .execute(client)

    const balanceRec = await balanceTx.getRecord(client)
    const rawBalance = balanceRec.contractFunctionResult.getUint256(0)
    const formattedBalance = Number(rawBalance) / Math.pow(10, decimals)

    console.log(`[✅ ÉXITO] Saldo actual: $${formattedBalance.toFixed(decimals)} ${symbol}`)

    // --- ETAPA 3: AUTORIZACIÓN ERC-20 (Approve) ---
    const amountToAuthorize = 1 * Math.pow(10, decimals) // Autorizar $1.00 USDC
    const spenderSolidity = '0x' + AccountId.fromString(spenderIdStr).toEvmAddress()

    console.log('\n[⚙️ PROCESO] Aplicando protocolo de autorización ($1.00 USDC)...')
    console.log(`[ℹ️ INFO] Autorizado (Spender): ${spenderIdStr} (${spenderSolidity})`)

    try {
      const approveTx = await new ContractExecuteTransaction()
        .setContractId(contractId).setGas(2000000)
        .setFunction('approve', new ContractFunctionParameters()
          .addAddress(spenderSolidity)
          .addUint256(amountToAuthorize)
        )
        .execute(client)

      await approveTx.getReceipt(client)
      console.log('[✅ ÉXITO] Autorización ERC-20 confirmada por el consenso.')
    } catch (e) {
      console.log(`\n⚠️ [ℹ️ INFO] La autorización falló: ${e.message}`)
      console.log(`👉 Asegúrate de que la cuenta ${ownerEVM} tenga saldo de USDC.`)
    }

    // --- ETAPA 4: VERIFICACIÓN DE ASIGNACIÓN (Allowance) ---
    console.log('\n[⚙️ PROCESO] Verificando asignación activa en el ledger...')
    const allowanceQuery = await new ContractCallQuery()
      .setContractId(contractId).setGas(100000)
      .setFunction('allowance', new ContractFunctionParameters()
        .addAddress(ownerEVM)
        .addAddress(spenderSolidity)
      )
      .execute(client)

    const activeAllowance = Number(allowanceQuery.getUint256(0)) / Math.pow(10, decimals)
    console.log(`[📊 REGISTRO] Asignación Confirmada: $${activeAllowance.toFixed(2)} USDC disponibles para gasto.`)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Interactuar con USDC en Hedera es idéntico a hacerlo en')
    console.log('Ethereum, pero con el beneficio de costos de gas fijos.')
    console.log('Esto permite que desarrolladores de DeFi migren sus dApps')
    console.log('sin cambiar su lógica de contratos, ganando rendimiento')
    console.log('inmediato.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] El ciclo de vida ERC-20 falló:', error.message)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ FALLO] Error de Ejecución:', error.message)
    process.exit(1)
  })
}
