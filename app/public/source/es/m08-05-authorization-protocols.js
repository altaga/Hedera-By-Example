/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Protocolos de Autorización Nativa (Allowances)
 * [ CONCEPTO ] Delegación de Gasto y Soberanía del Usuario
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * DeFi con Transparencia: En sistemas DeFi tradicionales, el comando
 * `approve()` de ERC-20 es una caja negra. Hedera ofrece una versión nativa
 * (`AccountAllowanceApproveTransaction`) donde las asignaciones son
 * entidades de estado de primer nivel. Esto significa que cualquier usuario
 * puede ver, auditar y revocar sus permisos de gasto directamente desde un
 * explorador de bloques, sin necesidad de interactuar con Smart Contracts
 * complejos. Es el estándar de oro para la seguridad en ecosistemas de
 * finanzas descentralizadas.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Usar CryptoApproveAllowance junto con smart contracts permite fijar límites de gasto precisos y acotados, evitando que contratos defectuosos o maliciosos drenen los fondos de la cuenta principal.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/approve-an-allowance
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M8 Lab 04: Contratos de Sistema (System Contracts)
 * - Actual:   M8 Lab 05: Protocolos de Autorización
 * - Siguiente: M8 Lab 06: Interacción ERC-20 (USDC)
 *
 * [ CÓMO EJECUTAR ]
 * node 05_authorization_protocols.js
 * ============================================================================
 */

import {
  AccountId, PrivateKey,
  AccountAllowanceApproveTransaction, Hbar
} from '@hiero-ledger/sdk'
import { getClient, getState } from '../M99_Utilities/index.js'

/**
 * Envolvedor funcional para establecer asignaciones de gasto nativas.
 */
const establishContractApproval = async (client, ownerId, ownerKey, spenderContractId) => {
  console.log(`[⚙️ PROCESO] Aprobando asignación de 5 HBAR para el contrato: ${spenderContractId}...`)

  const tx = await new AccountAllowanceApproveTransaction()
    .approveHbarAllowance(
      ownerId, // Propietario de los fondos
      spenderContractId, // Entidad autorizada (Smart Contract)
      new Hbar(5) // Límite de gasto
    )
    .freezeWith(client)

  const signedTx = await tx.sign(ownerKey)
  const txResponse = await signedTx.execute(client)

  return await txResponse.getReceipt(client)
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Autorizaciones Nativas (Allowances) ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const contractId = getState('SC_STORAGE_ID')

  if (!contractId) {
    console.error('[❌ FALLO] Falta SC_STORAGE_ID en la configuración. Ejecuta Lab 01 primero.')
    process.exitCode = 1
    return
  }

  const ownerKey = PrivateKey.fromString(operatorKey)

  try {
    const receipt = await establishContractApproval(
      client,
      AccountId.fromString(operatorId),
      ownerKey,
      contractId
    )

    console.log(`\n[✅ ÉXITO] Asignación Nativa establecida. Estado: ${receipt.status.toString()}`)
    console.log(`[ℹ️ INFO] El contrato ${contractId} está autorizado para gastar 5 HBAR del Operador.`)
    console.log('[ℹ️ INFO] Esta autorización es revocable y visible en el Mirror Node.')

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Las asignaciones de Hedera permiten que las dApps operen de')
    console.log('forma fluida sin requerir firmas constantes del usuario, mientras')
    console.log('se mantiene un registro de auditoría inmutable sobre quién puede')
    console.log('mover qué activos y bajo qué límites.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] El protocolo de autorización nativo falló:', error.message)
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

export { establishContractApproval }
