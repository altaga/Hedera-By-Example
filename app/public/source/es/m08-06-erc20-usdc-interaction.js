/**
 * ============================================================================
 * Lab 06: Integración con Activos ERC-20 (USDC en Hedera)
 * [CONCEPTO] Interoperabilidad Real con Activos de Valor Institucional
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
 * - https://docs.hedera.com/evm/development/addresses
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M8 Lab 05: Protocolos de Autorización Nativa (Allowances)
 * - Siguiente: M8 Lab 07: Asociación de Tokens (USDC Bridge)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: ~2 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M8_Smart_Contracts_EVM/06_erc20_usdc_interaction.js
 * ============================================================================
 */

import {
  AccountId, TokenId,
  ContractExecuteTransaction, ContractFunctionParameters,
  ContractCallQuery, ContractId, TokenAssociateTransaction
} from '@hiero-ledger/sdk'
import { getClient, getState, executeWithGas, withGasRetry, getAccountEvmAddress } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Ecosistema ERC-20 (USDC) ---\n')

  const { client, operatorId } = getClient()
  const USDC_TOKEN_ID = '0.0.429274' // ID de USDC en Testnet
  // La dirección que la red realmente usa para el operador (alias o long-zero).
  // Derivarla de la llave solo funciona para cuentas creadas desde una dirección EVM.
  const ownerEVM = await getAccountEvmAddress(operatorId)
  const spenderIdStr = getState('ACCOUNT_1_ID')

  if (!ownerEVM || !spenderIdStr) {
    console.error('[FALLO] Faltan OPERATOR_EVM_ADDRESS o ACCOUNT_1_ID en la configuración.')
    process.exitCode = 1
    return
  }

  try {
    const contractId = ContractId.fromString(USDC_TOKEN_ID)
    const usdcSolidityAddress = '0x' + contractId.toEvmAddress()

    // --- ETAPA 1: INTROSPECCIÓN DEL ACTIVO (Metadatos) ---
    console.log('[PROCESO] Extrayendo metadatos dinámicos del token ERC-20...')

    // Consulta de Nombre
    const nameQuery = await withGasRetry((gas) => new ContractCallQuery()
      .setContractId(contractId).setGas(gas)
      .setFunction('name').execute(client), { gas: 100000 })
    const name = nameQuery.getString(0)

    // Consulta de Símbolo
    const symbolQuery = await withGasRetry((gas) => new ContractCallQuery()
      .setContractId(contractId).setGas(gas)
      .setFunction('symbol').execute(client), { gas: 100000 })
    const symbol = symbolQuery.getString(0)

    // Consulta de Decimales
    const decimalsQuery = await withGasRetry((gas) => new ContractCallQuery()
      .setContractId(contractId).setGas(gas)
      .setFunction('decimals').execute(client), { gas: 100000 })
    const decimals = decimalsQuery.getUint8(0)

    console.log('\n---  [REGISTRO] FICHA TÉCNICA DEL ACTIVO ---')
    console.log(`[INFO]     ${name}`)
    console.log(`[INFO]   ${symbol}`)
    console.log(`[INFO] ${decimals}`)
    console.log(`[INFO] ${usdcSolidityAddress}`)
    console.log('------------------------------------------\n')

    // El operador debe estar asociado a USDC para tenerlo o aprobarlo. Asociar dos
    // veces devuelve TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT, lo cual está bien.
    try {
      await (await new TokenAssociateTransaction()
        .setAccountId(operatorId)
        .setTokenIds([TokenId.fromString(USDC_TOKEN_ID)])
        .execute(client)).getReceipt(client)
      console.log('[ÉXITO] Operador asociado a USDC.')
    } catch (error) {
      if (!/TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT/.test(error.message)) throw error
    }

    // --- ETAPA 2: TELEMETRÍA DE SALDO ---
    console.log('[PROCESO] Obteniendo telemetría de saldo en tiempo real...')
    const balanceTx = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(contractId).setGas(gas)
      .setFunction('balanceOf', new ContractFunctionParameters().addAddress(ownerEVM)), client, { gas: 1000000 })

    const balanceRec = await balanceTx.getRecord(client)
    const rawBalance = balanceRec.contractFunctionResult.getUint256(0)
    const formattedBalance = Number(rawBalance) / Math.pow(10, decimals)

    console.log(`[ÉXITO] Saldo actual: $${formattedBalance.toFixed(decimals)} ${symbol}`)

    // --- ETAPA 3: AUTORIZACIÓN ERC-20 (Approve) ---
    const amountToAuthorize = 1 * Math.pow(10, decimals) // Autorizar $1.00 USDC
    const spenderSolidity = '0x' + AccountId.fromString(spenderIdStr).toEvmAddress()

    console.log('\n[PROCESO] Aplicando protocolo de autorización ($1.00 USDC)...')
    console.log(`[INFO] Autorizado (Spender): ${spenderIdStr} (${spenderSolidity})`)

    try {
      const approveTx = await executeWithGas((gas) => new ContractExecuteTransaction()
        .setContractId(contractId).setGas(gas)
        .setFunction('approve', new ContractFunctionParameters()
          .addAddress(spenderSolidity)
          .addUint256(amountToAuthorize)
        ), client, { gas: 2000000 })

      await approveTx.getReceipt(client)
      console.log('[ÉXITO] Autorización ERC-20 confirmada por el consenso.')
    } catch (e) {
      console.log(`\n [INFO] La autorización falló: ${e.message}`)
      console.log(`Asegúrate de que la cuenta ${ownerEVM} tenga saldo de USDC.`)
    }

    // --- ETAPA 4: VERIFICACIÓN DE ASIGNACIÓN (Allowance) ---
    console.log('\n[PROCESO] Verificando asignación activa en el ledger...')
    const allowanceQuery = await withGasRetry((gas) => new ContractCallQuery()
      .setContractId(contractId).setGas(gas)
      .setFunction('allowance', new ContractFunctionParameters()
        .addAddress(ownerEVM)
        .addAddress(spenderSolidity)
      )
      .execute(client), { gas: 100000 })

    const activeAllowance = Number(allowanceQuery.getUint256(0)) / Math.pow(10, decimals)
    console.log(`[REGISTRO] Asignación Confirmada: $${activeAllowance.toFixed(2)} USDC disponibles para gasto.`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Interactuar con USDC en Hedera es idéntico a hacerlo en')
    console.log('Ethereum, pero con el beneficio de costos de gas fijos.')
    console.log('Esto permite que desarrolladores de DeFi migren sus dApps')
    console.log('sin cambiar su lógica de contratos, ganando rendimiento')
    console.log('inmediato.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] El ciclo de vida ERC-20 falló:', error.message)
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
