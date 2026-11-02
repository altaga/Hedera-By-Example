/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Firmas Externas con HSM / KMS
 * [ CONCEPTO ] Seguridad de Grado Bancario y Delegación de Firma
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El SDK Agnóstico al Firmante: En arquitecturas de alta seguridad, las
 * llaves privadas residen en una "Bóveda" (HSM/KMS) y NUNCA salen de ella.
 * El SDK de Hedera es flexible: permite construir una transacción, enviarla
 * a una bóveda remota para ser firmada, e inyectar la firma resultante. Esto
 * garantiza que tu código principal jamás toque la llave privada, eliminando
 * el riesgo de filtraciones accidentales.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Elige el algoritmo de firma con intención: Ed25519 ofrece mayor rendimiento y firmas más compactas, mientras que ECDSA secp256k1 es indispensable para interoperabilidad nativa con EVM y Ethereum.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/keys-and-signatures
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M1 Lab 02: Renta de Cuentas
 * - Actual:   M1 Lab 03: Criptografía y KMS
 * - Siguiente: M1 Lab 04: Rotación de Llaves
 *
 * [ CÓMO EJECUTAR ]
 * node 03_cryptography_kms.js
 * ============================================================================
 */

import { AccountId, Hbar, PrivateKey, TransferTransaction, TransactionId } from '@hiero-ledger/sdk'

/**
 * Mock de Hardware Security Module (HSM) / Bóveda
 * Esto simula un entorno aislado donde reside la Llave Privada.
 */
class RemoteHSMVault {
  constructor () {
    // Generar llaves efímeras dentro de los límites de la bóveda aislada
    this._privateKey = PrivateKey.generateECDSA()
    this.publicKey = this._privateKey.publicKey
  }

  getPublicKey () {
    return this.publicKey
  }

  /**
   * Simulación: Firma una carga útil de forma asíncrona.
   * La llave privada NUNCA sale de esta función.
   */
  async signPayload (payloadBuffer) {
    console.log('[⚙️ PROCESO] Bóveda: Firmando carga útil de forma segura dentro del HSM...')
    return new Promise((resolve) => {
      setTimeout(() => {
        const signature = this._privateKey.sign(payloadBuffer)
        resolve(signature)
      }, 200) // Simular latencia de red/seguridad
    })
  }
}

/**
 * Lógica principal de la simulación
 */
const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Delegación de Firma KMS ---\n')

  // 1. Inicializar nuestra "Bóveda" aislada
  const vault = new RemoteHSMVault()
  const vaultPubKey = vault.getPublicKey()

  console.log(`[ℹ️ INFO] Identidad Pública de la Bóveda: ${vaultPubKey.toStringDer().substring(0, 45)}...`)

  // 2. Crear una transacción que necesita una firma
  console.log('[⚙️ PROCESO] Construyendo transacción nativa de transferencia...')
  const transaction = new TransferTransaction()
    .addHbarTransfer(AccountId.fromString('0.0.1001'), Hbar.fromTinybars(-100))
    .addHbarTransfer(AccountId.fromString('0.0.1002'), Hbar.fromTinybars(100))

  try {
    // 3. Delegación: Preparamos la transacción para que el SDK pueda calcular sus bytes
    transaction.setTransactionId(TransactionId.generate(AccountId.fromString('0.0.2')))
    transaction.setNodeAccountIds([AccountId.fromString('0.0.3')])
    transaction.freeze()

    const transactionBytes = transaction.toBytes()

    console.log('[⚙️ PROCESO] Enviando bytes a la Bóveda para firma remota...')
    const signature = await vault.signPayload(transactionBytes)

    // 4. Inyectar la firma de vuelta en el objeto de la transacción
    console.log('[⚙️ PROCESO] Inyectando firma externa en el objeto Transaction...')
    transaction.addSignature(vaultPubKey, signature)

    console.log('\n[✅ ÉXITO] Transacción firmada por Bóveda remota.')
    console.log(`[📊 REGISTRO] Firmas Detectadas: ${transaction.getSignatures().size}`)
    console.log('[ℹ️ INFO] La transacción ahora es válida para ser enviada a la red.')

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('El flujo "Delegado" es el estándar para custodios y exchanges.')
    console.log('Al separar la Construcción de la Firma, garantizas que tus activos')
    console.log('estén protegidos por hardware especializado (HSM) sin sacrificar')
    console.log('la velocidad de desarrollo.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La delegación de firma remota falló:', error.message)
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

export { RemoteHSMVault }
