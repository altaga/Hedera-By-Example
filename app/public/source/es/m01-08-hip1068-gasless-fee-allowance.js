/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 08: Patrocinio de Gas y Concesión de Asignaciones Nativas (HIP-1068)
 * [ CONCEPTO ] Experiencia de Usuario Web3 Sin Gas mediante Asignaciones de Cuenta
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En las aplicaciones Web3 masivas, obligar a los usuarios finales a comprar
 * cripto nativa (HBAR) antes de su primera transacción crea una fricción
 * de incorporación inmensa.
 *
 * Hedera resuelve esto de forma nativa sin contratos inteligentes complejos a
 * través del marco de Asignaciones de Cuenta (Account Allowances, bajo principios HIP-1068).
 *
 * Una cuenta patrocinadora (Tesorería Corporativa o Paymaster de dApp) otorga una
 * asignación de HBAR a la cuenta del usuario (`AccountAllowanceApproveTransaction`).
 * El usuario puede entonces despachar una transferencia aprobada (`addApprovedHbarTransfer`)
 * donde los fondos se debitan directamente del saldo del patrocinador, logrando
 * un onboarding sin fricción "Gasless" mientras se preserva la seguridad del ledger.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El patrocinio de comisiones bajo HIP-1068 permite a las empresas subsidiar los costos a sus usuarios: los clientes firman sus propias operaciones mientras las comisiones se debitan de la asignación de tesorería corporativa.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-1068
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M1 Lab 07: Motor de Tarifas Simples HIP-1261
 * - Siguiente: M2 Lab 01: Depreciación de Consultas Síncronas
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M1_Fundamentals_Functional_JS/08_hip1068_gasless_fee_allowance.js
 * ============================================================================
 */

import { AccountAllowanceApproveTransaction, TransferTransaction, Hbar, PrivateKey, Client } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getMirrorNodeBaseUrl, updateState, createClient, ensureFunded } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Patrocinio de Gas y Asignaciones (HIP-1068) ---\n')

  const { client, operatorId } = getClient()
  const spenderId = process.env.ACCOUNT_1_ID
  const spenderKeyStr = process.env.ACCOUNT_1_PRIVATE_KEY
  const recipientId = process.env.ACCOUNT_2_ID || operatorId.toString()
  const mirrorBase = getMirrorNodeBaseUrl()

  if (!spenderId || !spenderKeyStr) {
    console.error('[❌ FALLO] Faltan ACCOUNT_1_ID o ACCOUNT_1_PRIVATE_KEY en la configuración .env.')
    process.exitCode = 1
    console.log('[ℹ️ INFO] Ejecuta M0 Lab 04 para aprovisionar cuentas secundarias primero.')
    return
  }

  const spenderKey = PrivateKey.fromStringDer(spenderKeyStr)

  try {
    const ALLOWANCE_AMOUNT_HBAR = 0.1
    const SPONSORED_TRANSFER_HBAR = 0.005

    // ETAPA 1: EL PATROCINADOR APRUEBA LA ASIGNACIÓN (O REUTILIZA ASIGNACIÓN ACTIVA ON-CHAIN)
    console.log(`[⚙️ PROCESO] Etapa 1: Inspeccionando asignación on-chain activa del Patrocinador (${operatorId}) al Usuario (${spenderId})...`)

    let activeAllowanceHbar = 0
    try {
      const checkRes = await fetch(`${mirrorBase}/api/v1/accounts/${operatorId}/allowances/crypto`)
      if (checkRes.ok) {
        const checkData = await checkRes.json()
        const found = checkData.allowances?.find(a => a.spender === spenderId.toString())
        if (found) activeAllowanceHbar = found.amount / 1e8
      }
    } catch (_) {}

    if (activeAllowanceHbar >= SPONSORED_TRANSFER_HBAR) {
      console.log(`[✅ ÉXITO] Asignación On-Chain Activa Detectada: ${activeAllowanceHbar} HBAR restantes.`)
      console.log('[ℹ️ INFO] Reutilizando concesión existente (Cero tarifas de aprobación redundantes).')
    } else {
      console.log(`[⚙️ PROCESO] Otorgando nueva asignación de ${ALLOWANCE_AMOUNT_HBAR} HBAR en el ledger...`)
      const approveTx = await new AccountAllowanceApproveTransaction()
        .approveHbarAllowance(operatorId, spenderId, Hbar.from(ALLOWANCE_AMOUNT_HBAR))
        .freezeWith(client)

      const approveResponse = await approveTx.execute(client)
      const approveReceipt = await approveResponse.getReceipt(client)
      console.log(`[✅ ÉXITO] Asignación Concedida: Estado ${approveReceipt.status.toString()}`)
      console.log(`[🔗 EXPLORADOR] Aprobación HashScan: ${getHashscanUrl(approveResponse)}`)
    }

    // ETAPA 2: EL USUARIO EJECUTA TRANSFERENCIA PATROCINADA SIN FIRMA DEL PATROCINADOR
    console.log(`\n[⚙️ PROCESO] Etapa 2: Usuario (${spenderId}) transfiriendo ${SPONSORED_TRANSFER_HBAR} HBAR debitados de la asignación del patrocinador...`)

    // Inicializar instancia de cliente del usuario (La clave del patrocinador NO está presente aquí)
    // Aquí ACCOUNT_1 paga las comisiones de sus transacciones; se mantiene con saldo.
    await ensureFunded(client, spenderId, 1)
    const spenderClient = createClient()
    spenderClient.setOperator(spenderId, spenderKey)

    const transferTx = await new TransferTransaction()
      .addApprovedHbarTransfer(operatorId, new Hbar(-SPONSORED_TRANSFER_HBAR))
      .addHbarTransfer(recipientId, new Hbar(SPONSORED_TRANSFER_HBAR))
      .freezeWith(spenderClient)

    const transferResponse = await transferTx.execute(spenderClient)
    const transferReceipt = await transferResponse.getReceipt(spenderClient)

    console.log(`[✅ ÉXITO] Transferencia Patrocinada Liquidada: Estado ${transferReceipt.status.toString()}`)
    console.log(`[📊 REGISTRO] ID de Transacción: ${transferResponse.transactionId.toString()}`)
    console.log(`[🔗 EXPLORADOR] Transferencia HashScan: ${getHashscanUrl(transferResponse)}`)

    // ETAPA 3: INTERROGAR ASIGNACIONES RESTANTES DEL PATROCINADOR VÍA MIRROR NODE
    console.log('\n[⚙️ PROCESO] Etapa 3: Verificando asignación restante en la API REST del Mirror Node...')
    const allowanceRes = await fetch(`${mirrorBase}/api/v1/accounts/${operatorId}/allowances/crypto`)

    if (allowanceRes.ok) {
      const data = await allowanceRes.json()
      const grant = data.allowances?.find(a => a.spender === spenderId.toString())
      if (grant) {
        const remainingHbar = grant.amount / 1e8
        console.log(`[📊 REGISTRO] Asignación Restante Verificada: ${remainingHbar} HBAR para usuario ${spenderId}`)
      }
    }

    updateState('HIP1068_SPONSOR_ID', operatorId.toString())
    updateState('HIP1068_SPENDER_ID', spenderId.toString())
    updateState('HIP1068_LAST_TRANSFER_TX_ID', transferResponse.transactionId.toString())

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('UX Sin Gas y Sin Fricción: El usuario final firmó ÚNICAMENTE como usuario gestor.')
    console.log('Los fondos se debitaron directamente del patrocinador sin requerir co-firmas.')
    console.log('Esto permite que juegos, boletaje empresarial y dApps subsidien la actividad')
    console.log('de sus usuarios sin introducir vulnerabilidades de smart contracts.')

    client.close()
    spenderClient.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error(`\n[❌ ERROR] Falló la Ejecución de Asignación Sin Gas: ${error.message}`)
    process.exitCode = 1
    if (client) client.close()
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
