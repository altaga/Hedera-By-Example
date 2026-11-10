/**
 * ============================================================================
 * Lab 03: Firmas Externas con HSM / KMS
 * [CONCEPTO] Seguridad de Grado Bancario y Delegación de Firma
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
 * - Anterior:  M1 Lab 02: Renta de Estado y Ciclo de Vida de la Cuenta
 * - Siguiente: M1 Lab 04: Rotación de Llaves
 *
 * La "bóveda" aquí es WebCrypto: la llave se genera como no extraíble, así que este código puede
 * pedirle que firme pero nunca puede leer la llave privada (el lab lo demuestra intentándolo). En
 * producción, un KMS en la nube o un HSM de hardware cumplen el mismo papel; el lado del SDK
 * (signWith) es idéntico.
 *
 * [ SECUENCIA ]
 * App -> Bóveda: Genera una llave Ed25519 no extraíble
 * App -> Hedera: Crea una cuenta controlada por la llave pública de la bóveda
 * App -> Bóveda: Firma los bytes del cuerpo de la transacción (signWith)
 * App -> Hedera: Envía; la red comprueba la firma de la bóveda
 * App -> Hedera: Borra la cuenta (también firmado por la bóveda), el saldo vuelve a ti
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (fondea una cuenta temporal de la bóveda y recupera el saldo).
 * - Costo: <1 ℏ (creación de la cuenta y comisiones; el depósito de 0.2 ℏ regresa).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M1_Fundamentals_Functional_JS/03_cryptography_kms.js
 * ============================================================================
 */

import { AccountCreateTransaction, AccountDeleteTransaction, Hbar, PublicKey, TransferTransaction, TransactionId } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl } from '../M99_Utilities/index.js'

/**
 * Una bóveda de firma respaldada por WebCrypto. La llave privada se crea no extraíble:
 * esta clase puede pedirle que firme, pero nada (ni siquiera este código) puede exportarla.
 */
class WebCryptoVault {
  async init () {
    const pair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    this._privateKey = pair.privateKey
    const rawPublic = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey))
    this.publicKey = PublicKey.fromBytesED25519(rawPublic)
    return this
  }

  // Firma los bytes dentro de la bóveda y devuelve solo la firma de 64 bytes.
  async sign (bytes) {
    return new Uint8Array(await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, this._privateKey, bytes))
  }

  // Intenta sacar la llave privada de la bóveda; WebCrypto se niega.
  async tryExport () {
    try {
      await globalThis.crypto.subtle.exportKey('pkcs8', this._privateKey)
      return 'EXPORTADA (¡la llave era extraíble!)'
    } catch (error) {
      return `rechazada (${error.name})`
    }
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Delegación de Firma a una Bóveda ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. La bóveda crea su llave; solo vemos la mitad pública
    const vault = await new WebCryptoVault().init()
    console.log(`[INFO] Llave de la bóveda creada (Ed25519, no extraíble). Llave pública: ${vault.publicKey.toStringDer().slice(0, 30)}...`)
    console.log(`[VERIFY] Exportación de la llave privada: ${await vault.tryExport()}`)

    // 2. Una cuenta de testnet cuya única llave es la de la bóveda
    console.log('\n[PROCESO] Creando una cuenta de testnet controlada por la llave de la bóveda (depósito de 0.2 ℏ)...')
    const createRes = await new AccountCreateTransaction()
      .setKeyWithoutAlias(vault.publicKey)
      .setInitialBalance(new Hbar(0.2))
      .execute(client)
    const vaultAccountId = (await createRes.getReceipt(client)).accountId
    console.log(`[ÉXITO] Cuenta de la bóveda: ${vaultAccountId}`)

    // 3. La cuenta de la bóveda paga y firma su propia transferencia: solo la bóveda puede autorizarla
    console.log('\n[PROCESO] Armando una transferencia pagada por la cuenta de la bóveda y pidiéndole a la bóveda que la firme...')
    const transfer = new TransferTransaction()
      .addHbarTransfer(vaultAccountId, Hbar.fromTinybars(-1_000_000))
      .addHbarTransfer(operatorId, Hbar.fromTinybars(1_000_000))
      .setTransactionId(TransactionId.generate(vaultAccountId))
      .freezeWith(client)
    // signWith le entrega a la bóveda exactamente los bytes del cuerpo que la red va a comprobar.
    await transfer.signWith(vault.publicKey, (bodyBytes) => vault.sign(bodyBytes))
    const transferRes = await transfer.execute(client)
    const transferReceipt = await transferRes.getReceipt(client)
    console.log(`[ÉXITO] La red aceptó la firma de la bóveda: ${transferReceipt.status.toString()}`)
    console.log(`[EXPLORADOR] ${getHashscanUrl(transferRes)}`)

    // 4. Limpieza: borrar la cuenta (firmado por la bóveda), su saldo vuelve a ti
    console.log('\n[PROCESO] Borrando la cuenta de la bóveda; la bóveda firma otra vez...')
    const del = new AccountDeleteTransaction()
      .setAccountId(vaultAccountId)
      .setTransferAccountId(operatorId)
      .freezeWith(client)
    await del.signWith(vault.publicKey, (bodyBytes) => vault.sign(bodyBytes))
    const delReceipt = await (await del.execute(client)).getReceipt(client)
    console.log(`[ÉXITO] Cuenta de la bóveda borrada: ${delReceipt.status.toString()} (el saldo restante volvió a ${operatorId})`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('El SDK de Hedera es "agnóstico al firmante": no le importa *cómo* se genera una')
    console.log('firma, mientras sea válida. Aquí una llave que ningún código pudo leer firmó dos')
    console.log('transacciones reales; un KMS o un HSM se conectan a signWith de la misma forma.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la delegación de firma:', error.message)
    process.exitCode = 1
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de Ejecución:', error.message)
      process.exit(1)
    })
}
