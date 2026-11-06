/**
 * ============================================================================
 * Lab 07: Asociación de Tokens (USDC Bridge)
 * [CONCEPTO] El Escudo Anti-Spam y Opt-In de Activos
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
 * - https://docs.hedera.com/evm/hedera-services/system-contracts/hts
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M8 Lab 06: Integración con Activos ERC-20 (USDC en Hedera)
 * - Siguiente: M8 Lab 08: Precompilados HTS Avanzados
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M8_Smart_Contracts_EVM/07_usdc_association.js
 * ============================================================================
 */

import {
  AccountId,
  TokenAssociateTransaction, TokenId
} from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Asociación de Activos Institucionales (Opt-In) ---\n')

  const { client, operatorId } = getClient()
  const USDC_TOKEN_ID = '0.0.429274' // ID de USDC en Testnet

  try {
    console.log(`[PROCESO] Ejecutando Opt-In oficial para USDC (${USDC_TOKEN_ID})...`)

    // Asocia primero: una cuenta debe aceptar un token antes de poder tenerlo.
    const tx = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(operatorId))
      .setTokenIds([TokenId.fromString(USDC_TOKEN_ID)])
      .execute(client)

    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const receipt = await tx.getReceipt(client)

    console.log(`\n[ÉXITO] Asociación de USDC exitosa. Estado: ${receipt.status.toString()}`)
    console.log('[INFO] El Operador está ahora autorizado para poseer y transferir USDC.')

    console.log('\n CONCEPTO CLAVE:')
    console.log('La asociación es una característica de seguridad única de Hedera.')
    console.log('Protege a los usuarios de "AirDrops de Spam" y ataques de phishing')
    console.log('basados en tokens maliciosos, asegurando que solo los activos')
    console.log('validados por el usuario residan en su balance de cuenta.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    if (error.message.includes('TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT')) {
      console.log('\n [ÉXITO] El Operador ya está asociado con USDC. Saltando paso.')
    } else {
      console.error(`\n[FALLO] El proceso de asociación falló: ${error.message}`)
      process.exitCode = 1
    }
    client.close()
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
