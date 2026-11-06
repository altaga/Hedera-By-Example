/**
 * ============================================================================
 * Lab 08: Asignaciones de HBAR y Gasto Patrocinado (HIP-336)
 * [CONCEPTO] Que un Usuario Gaste de la Tesorería de un Patrocinador sin su Clave
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * HIP-336 (API de Aprobaciones y Asignaciones) permite que un dueño apruebe a un
 * gastador hasta un monto máximo de HBAR (`AccountAllowanceApproveTransaction`). El
 * gastador construye una transferencia con `addApprovedHbarTransfer(dueño, -monto)` y la
 * firma SOLO: el monto se debita del saldo del dueño, no del gastador.
 *
 * Precisión sobre comisiones: aquí el gastador es quien paga la transacción, así que
 * sigue pagando su pequeña comisión de red. Para un patrocinio real de comisiones (el
 * usuario tiene 0 HBAR) el patrocinador debe ser el pagador del TransactionId y co-firmar
 * — ver M13 Lab 02.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las asignaciones mueven valor sin compartir claves; el pagador del TransactionId decide
 * quién paga la comisión de red. Son dos herramientas distintas.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://github.com/hiero-ledger/hiero-improvement-proposals/blob/main/HIP/hip-336.md
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/approve-an-allowance
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/transactions/transaction-id
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M1 Lab 07: Motor de Tarifas Simples y Precios Deterministas HIP-1261
 * - Siguiente: M2 Lab 01: Depreciación de Consultas Sincrónicas
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el patrocinador (dueño de la asignación).
 * - Gastador: ACCOUNT_1 del .env si existe; si no, una cuenta desechable (0.5 ℏ) financiada por el operador.
 * - Costo: <1 ℏ.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M1_Fundamentals_Functional_JS/08_hip1068_gasless_fee_allowance.js
 * ============================================================================
 */

import { AccountAllowanceApproveTransaction, TransferTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getMirrorNodeBaseUrl, updateState, createClient, ensureFunded, createLabAccount, parsePrivateKey } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Asignaciones de HBAR y Gasto Patrocinado (HIP-336) ---\n')

  const { client, operatorId } = getClient()
  const mirrorBase = getMirrorNodeBaseUrl()
  // ACCOUNT_1 del .env si existe; si no, una cuenta desechable financiada por el operador
  const spender = process.env.ACCOUNT_1_ID && process.env.ACCOUNT_1_PRIVATE_KEY
    ? { accountId: process.env.ACCOUNT_1_ID, privateKey: parsePrivateKey(process.env.ACCOUNT_1_PRIVATE_KEY) }
    : await createLabAccount(client, { hbar: 0.5 })
  const spenderId = spender.accountId.toString()
  const spenderKey = spender.privateKey
  const recipientId = process.env.ACCOUNT_2_ID || operatorId.toString()

  try {
    const ALLOWANCE_AMOUNT_HBAR = 0.1
    const SPONSORED_TRANSFER_HBAR = 0.005

    // ETAPA 1: EL PATROCINADOR APRUEBA LA ASIGNACIÓN (O REUTILIZA ASIGNACIÓN ACTIVA ON-CHAIN)
    console.log(`[PROCESO] Etapa 1: Inspeccionando asignación on-chain activa del Patrocinador (${operatorId}) al Usuario (${spenderId})...`)

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
      console.log(`[ÉXITO] Asignación On-Chain Activa Detectada: ${activeAllowanceHbar} HBAR restantes.`)
      console.log('[INFO] Reutilizando concesión existente (Cero tarifas de aprobación redundantes).')
    } else {
      console.log(`[PROCESO] Otorgando nueva asignación de ${ALLOWANCE_AMOUNT_HBAR} HBAR en el ledger...`)
      const approveTx = await new AccountAllowanceApproveTransaction()
        .approveHbarAllowance(operatorId, spenderId, Hbar.from(ALLOWANCE_AMOUNT_HBAR))
        .freezeWith(client)

      const approveResponse = await approveTx.execute(client)
      const approveReceipt = await approveResponse.getReceipt(client)
      console.log(`[ÉXITO] Asignación Concedida: Estado ${approveReceipt.status.toString()}`)
      console.log(`[EXPLORADOR] Aprobación HashScan: ${getHashscanUrl(approveResponse)}`)
    }

    // ETAPA 2: EL USUARIO EJECUTA TRANSFERENCIA PATROCINADA SIN FIRMA DEL PATROCINADOR
    console.log(`\n[PROCESO] Etapa 2: Usuario (${spenderId}) transfiriendo ${SPONSORED_TRANSFER_HBAR} HBAR debitados de la asignación del patrocinador...`)

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

    console.log(`[ÉXITO] Transferencia Patrocinada Liquidada: Estado ${transferReceipt.status.toString()}`)
    console.log(`[REGISTRO] ID de Transacción: ${transferResponse.transactionId.toString()}`)
    console.log(`[EXPLORADOR] Transferencia HashScan: ${getHashscanUrl(transferResponse)}`)

    // ETAPA 3: INTERROGAR ASIGNACIONES RESTANTES DEL PATROCINADOR VÍA MIRROR NODE
    console.log('\n[PROCESO] Etapa 3: Verificando asignación restante en la API REST del Mirror Node...')
    const allowanceRes = await fetch(`${mirrorBase}/api/v1/accounts/${operatorId}/allowances/crypto`)

    if (allowanceRes.ok) {
      const data = await allowanceRes.json()
      const grant = data.allowances?.find(a => a.spender === spenderId.toString())
      if (grant) {
        const remainingHbar = grant.amount / 1e8
        console.log(`[REGISTRO] Asignación Restante Verificada: ${remainingHbar} HBAR para usuario ${spenderId}`)
      }
    }

    updateState('HIP1068_SPONSOR_ID', operatorId.toString())
    updateState('HIP1068_SPENDER_ID', spenderId.toString())
    updateState('HIP1068_LAST_TRANSFER_TX_ID', transferResponse.transactionId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Gasto por asignación: el gastador firmó solo (y pagó su propia comisión de red).')
    console.log('Los fondos se debitaron directamente del patrocinador sin requerir co-firmas.')
    console.log('Para patrocinar también la comisión, haz al patrocinador pagador del TransactionId (M13 Lab 02).')

    client.close()
    spenderClient.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error(`\n[FALLO] Falló la Ejecución de Asignación Sin Gas: ${error.message}`)
    process.exitCode = 1
    if (client) client.close()
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
