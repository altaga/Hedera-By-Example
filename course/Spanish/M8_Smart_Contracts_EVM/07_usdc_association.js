/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 07: Asociación de Tokens (USDC Bridge)
 * [ CONCEPTO ] El Escudo Anti-Spam y Opt-In de Activos
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Seguridad del Estado: En Hedera, no es posible enviar tokens a una cuenta
 * de forma no solicitada (Spam). Para recibir cualquier tipo de activo
 * (FT o NFT), la cuenta debe realizar explícitamente un "Opt-In" mediante una
 * operación de `TokenAssociate`. Este mecanismo garantiza que tu billetera
 * nunca se sature con activos inútiles o maliciosos, permitiendo que el
 * estado de tu cuenta sea utilizado únicamente para los activos en los que
 * confías y has decidido participar voluntariamente.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Al desplegar smart contracts que manejen o almacenen USDC u otros tokens de HTS, el contrato debe asociar el token (vía el precompilado 0x167 o previo a transferencias) para recibir fondos con éxito.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/smart-contracts/system-contracts/hedera-token-service
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M8 Lab 06: Interacción ERC-20 (USDC)
 * - Actual:   M8 Lab 07: Asociación de Tokens (USDC)
 * - Siguiente: M9 Lab 01: Persistencia IA (HCS-1)
 *
 * [ CÓMO EJECUTAR ]
 * node 07_usdc_association.js
 * ============================================================================
 */

import {
  AccountId,
  TokenAssociateTransaction, TokenId
} from '@hiero-ledger/sdk'
import { getClient, getState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Asociación de Activos Institucionales (Opt-In) ---\n')

  const { client, operatorId } = getClient()
  const USDC_TOKEN_ID = '0.0.429274' // ID de USDC en Testnet

  try {
    console.log(`[⚙️ PROCESO] Ejecutando Opt-In oficial para USDC (${USDC_TOKEN_ID})...`)

    const tx = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(operatorId))
      .setTokenIds([TokenId.fromString(USDC_TOKEN_ID)])
      .execute(client)

    const receipt = await tx.getReceipt(client)

    console.log(`\n[✅ ÉXITO] Asociación de USDC exitosa. Estado: ${receipt.status.toString()}`)
    console.log('[ℹ️ INFO] El Operador está ahora autorizado para poseer y transferir USDC.')

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('La asociación es una característica de seguridad única de Hedera.')
    console.log('Protege a los usuarios de "AirDrops de Spam" y ataques de phishing')
    console.log('basados en tokens maliciosos, asegurando que solo los activos')
    console.log('validados por el usuario residan en su balance de cuenta.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    if (error.message.includes('TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT')) {
      console.log('\n✔ [✅ ÉXITO] El Operador ya está asociado con USDC. Saltando paso.')
    } else {
      console.error(`\n[❌ FALLO] El proceso de asociación falló: ${error.message}`)
    }
    client.close()
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
