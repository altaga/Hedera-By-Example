/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Emisión de Token Fungible con HTS
 * [ CONCEPTO CLAVE ]
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Inmutabilidad y Confianza: En Hedera, los tokens son entidades NATIVAS del
 * protocolo, no Smart Contracts. Esto elimina el riesgo de bugs en Solidity
 * y reduce costos operativos. Un token cuya `supplyKey` y `adminKey` están
 * fijadas es matemáticamente INMUTABLE: ninguna entidad, ni siquiera el
 * creador, puede alterar su suministro total o sus propiedades una vez
 * desplegado. Esta es la base de la confianza en las finanzas
 * descentralizadas (DeFi) institucionales.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * La omisión es verdadera inmutabilidad: al omitir la adminKey al crear un token, renuncias permanentemente al control. Las reglas y suministro quedan fijadas matemáticamente por la capa de consenso para siempre.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/define-a-token
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M2 Lab 03: Paginación Recursiva
 * - Actual:   M3 Lab 01: Emisión de Token
 * - Siguiente: M3 Lab 02: Identidad Financiera
 *
 * [ CÓMO EJECUTAR ]
 * node 01_immutable_issuance.js
 * ============================================================================
 */

import {
  AccountId, PrivateKey,
  TokenCreateTransaction, TokenType, TokenSupplyType
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Emisión de Activos Nativos (HTS) ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const treasuryKey = PrivateKey.fromString(operatorKey)

  try {
    console.log('[⚙️ PROCESO] Creando "Hedera Syllabus Coin" (HSC) en el Ledger...')

    // 1. Definir y Ejecutar la Creación del Token Nativo
    const tokenId = await reuseToken('REUSE_M3_01_TOKEN', async () => {
      const transaction = await new TokenCreateTransaction()
        .setTokenName('Hedera Syllabus Coin')
        .setTokenSymbol('HSC')
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(2)
        .setInitialSupply(1000000) // 10,000.00 HSC (2 decimales)
        .setMaxSupply(10000000)
        .setSupplyType(TokenSupplyType.Finite)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setAdminKey(treasuryKey)
        .setSupplyKey(treasuryKey) // Permite mint/burn controlado
        .setPauseKey(treasuryKey) // Freno de emergencia protocolar
        .freezeWith(client)

      const response = await transaction.execute(client)

      console.log(`[📊 REGISTRO] Transacción enviada: ${response.transactionId.toString()}`)
      console.log(`[📊 REGISTRO] Ver en HashScan: ${getHashscanUrl(response)}`)

      const receipt = await response.getReceipt(client)
      return receipt.tokenId
    })

    console.log('\n[✅ ÉXITO] Token Nativo emitido exitosamente.')
    console.log(`[📊 REGISTRO] Token ID: ${tokenId.toString()}`)
    console.log(`[📊 REGISTRO] Cuenta de Tesorería: ${operatorId}`)

    // Persistir el Token ID para laboratorios posteriores
    console.log('[ℹ️ INFO] Guardando Token ID en el estado local del módulo...')
    updateState('FT_TOKEN_ID', tokenId.toString())

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Al ser un activo nativo, las transferencias de este token')
    console.log('tienen la misma seguridad y finalidad que el HBAR base,')
    console.log('sin los riesgos de seguridad asociados a los Smart Contracts')
    console.log('de terceros.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] El despliegue del token falló:', error.message)
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
