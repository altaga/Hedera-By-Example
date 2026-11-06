/**
 * ============================================================================
 * Laboratorio 04: Autenticador Biométrico Passkeys y WebAuthn P-256
 * [CONCEPTO] Criptografía de Hardware Sin Semilla (NIST P-256 / secp256r1) en Hedera
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Las frases semilla (seed phrases) y las claves privadas en texto plano representan
 * el mayor vector de ataque en Web3. El estándar W3C WebAuthn / FIDO2 permite a los
 * usuarios autenticarse directamente mediante biometría de hardware nativa (Apple FaceID/TouchID,
 * huella dactilar Android, Windows Hello, YubiKey) usando la curva elíptica NIST P-256 (`secp256r1`).
 * Un autenticador emulado firma desafíos dentro de un secure enclave, produciendo
 * `authenticatorData` y `clientDataJSON`. Una pasarela en Hedera verifica esta aserción
 * biométrica para autorizar transacciones sin que el usuario gestione ni exponga claves privadas.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los autenticadores WebAuthn no firman mensajes arbitrarios sin contexto. Garantizan una estricta
 * resistencia al phishing vinculando las firmas a un Origen y a un ID de Entidad Reclamante (RP ID),
 * aplicando hash a banderas de `authenticatorData` (Usuario Presente `UP=1`, Usuario Verificado `UV=1`)
 * y a `clientDataJSON`. La verificación de estas aserciones criptográficas elimina el 100% del
 * phishing remoto y del robo de credenciales.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M15 Lab 03: Solver de Liquidación DeFi Basado en Intenciones (ERC-7683)
 * - Siguiente: M15 Lab 05: zk-TLS y Pruebas Criptográficas Web (Modelo TLSNotary)
 *
 * [ REFERENCIAS OFICIALES ]
 * - Autenticación Web W3C (WebAuthn) Nivel 3: https://www.w3.org/TR/webauthn-3/
 * - Especificaciones de la Alianza FIDO: https://fidoalliance.org/specs/
 * - EIP-7212: Contrato Precompilado para la Curva secp256r1: https://eips.ethereum.org/EIPS/eip-7212
 *
 * [SIMULADO]
 * El autenticador biométrico se emula por software (en el sitio puedes probar una passkey real). Las firmas P-256 y la auditoría en HCS son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M15_DePIN_and_Future_Crypto/04_passkeys_webauthn_p256_authenticator.js
 * ============================================================================
 */

import {
  TransferTransaction,
  Hbar,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  AccountId
} from '@hiero-ledger/sdk'
import crypto from 'node:crypto'
import { getClient, updateState, getHashscanUrl } from '../M99_Utilities/index.js'

/**
 * Emula un Autenticador Biométrico de Hardware (Apple Secure Enclave / TouchID / FaceID)
 * Operando sobre la curva elíptica NIST P-256 (secp256r1 / prime256v1).
 */
class WebAuthnBiometricAuthenticator {
  constructor (userName = 'alice.biometrics@enterprise.vault') {
    this.userName = userName
    // Genera un par de claves P-256 (prime256v1) simulando hardware
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1'
    })
    this.privateKey = privateKey
    this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
    this.credentialId = crypto.randomBytes(32).toString('hex')
    this.signCount = 0
  }

  /**
   * Simula `navigator.credentials.get({ publicKey: ... })` siguiendo la especificación W3C WebAuthn.
   */
  generateAssertion (challengeHex, rpId = 'vault.hedera.network', origin = 'https://vault.hedera.network') {
    this.signCount += 1

    // 1. Construir clientDataJSON
    const clientDataObj = {
      type: 'webauthn.get',
      challenge: challengeHex,
      origin,
      crossOrigin: false
    }
    const clientDataJSON = Buffer.from(JSON.stringify(clientDataObj))
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest()

    // 2. Construir authenticatorData: rpIdHash (32) + flags (1) + signCount (4)
    const rpIdHash = crypto.createHash('sha256').update(rpId).digest()
    const flags = Buffer.from([0x05]) // Bit 0 (Usuario Presente = 1), Bit 2 (Usuario Verificado = 1)
    const counterBuf = Buffer.alloc(4)
    counterBuf.writeUInt32BE(this.signCount, 0)

    const authenticatorData = Buffer.concat([rpIdHash, flags, counterBuf])

    // 3. Firma sobre authenticatorData || sha256(clientDataJSON)
    const signedData = Buffer.concat([authenticatorData, clientDataHash])
    const signatureDer = crypto.sign('SHA256', signedData, this.privateKey)

    return {
      credentialId: this.credentialId,
      authenticatorDataHex: authenticatorData.toString('hex'),
      clientDataJSONBase64: clientDataJSON.toString('base64'),
      signatureHex: signatureDer.toString('hex'),
      publicKeyPem: this.publicKeyPem,
      signCount: this.signCount
    }
  }
}

/**
 * Entidad Reclamante (RP) Empresarial / Pasarela de Verificación WebAuthn en Hedera
 */
class HederaWebAuthnGateway {
  constructor (rpId = 'vault.hedera.network', origin = 'https://vault.hedera.network') {
    this.rpId = rpId
    this.origin = origin
    this.registeredPasskeys = {} // credentialId -> publicKeyPem
    this.activeChallenges = new Map()
  }

  registerPasskey (credentialId, publicKeyPem) {
    this.registeredPasskeys[credentialId] = publicKeyPem
  }

  generateChallenge () {
    const challengeHex = crypto.randomBytes(32).toString('hex')
    this.activeChallenges.set(challengeHex, Date.now() + 60000)
    return challengeHex
  }

  verifyAssertion (assertion) {
    const { credentialId, authenticatorDataHex, clientDataJSONBase64, signatureHex } = assertion
    const publicKeyPem = this.registeredPasskeys[credentialId]

    if (!publicKeyPem) {
      return { verified: false, error: 'ID de credencial de passkey no registrado' }
    }

    // Decodificar clientDataJSON
    const clientDataBuffer = Buffer.from(clientDataJSONBase64, 'base64')
    const clientData = JSON.parse(clientDataBuffer.toString('utf8'))

    // Verificar desafío
    if (!this.activeChallenges.has(clientData.challenge)) {
      return { verified: false, error: 'Desafío expirado o inválido' }
    }
    this.activeChallenges.delete(clientData.challenge)

    // Verificar origen
    if (clientData.origin !== this.origin) {
      return { verified: false, error: `Discrepancia de origen: esperado ${this.origin}, recibido ${clientData.origin}` }
    }

    // Verificar banderas de authenticatorData (Usuario Presente y Usuario Verificado)
    const authDataBuf = Buffer.from(authenticatorDataHex, 'hex')
    const flagsByte = authDataBuf[32]
    const userPresent = (flagsByte & 0x01) !== 0
    const userVerified = (flagsByte & 0x04) !== 0

    if (!userPresent || !userVerified) {
      return { verified: false, error: 'Bandera de verificación biométrica no establecida' }
    }

    // Verificar firma criptográfica ECDSA sobre SHA-256
    const clientDataHash = crypto.createHash('sha256').update(clientDataBuffer).digest()
    const signedData = Buffer.concat([authDataBuf, clientDataHash])

    const isCryptoValid = crypto.verify(
      'SHA256',
      signedData,
      publicKeyPem,
      Buffer.from(signatureHex, 'hex')
    )

    if (!isCryptoValid) {
      return { verified: false, error: 'Discrepancia en la firma criptográfica P-256' }
    }

    return {
      verified: true,
      credentialId,
      signCount: authDataBuf.readUInt32BE(33),
      userPresent,
      userVerified
    }
  }
}

async function main () {
  console.log('====================================================================')
  console.log('PASSEKEYS LAB 04: AUTENTICADOR BIOMÉTRICO WEBAUTHN P-256')
  console.log('====================================================================\n')

  const { client, operatorId, network } = getClient()

  try {
    console.log(`[OPERADOR] Autenticado como ${operatorId} en Hedera ${network.toUpperCase()}`)

    // 1. Crear Tópico HCS para Auditoría Biométrica WebAuthn
    console.log('\n[1/5] Creando Tópico HCS Dedicado para Auditoría WebAuthn...')
    const topicCreateTx = await new TopicCreateTransaction()
      .setTopicMemo('Hedera WebAuthn P-256 Biometric Authentication Log')
      .execute(client)

    const topicReceipt = await topicCreateTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[ TÓPICO CREADO] ID: ${topicId}`)
    console.log(`[EXPLORADOR] https://hashscan.io/${network}/topic/${topicId}`)

    // 2. Inicializar Secure Enclave de Hardware y Pasarela
    console.log('\n[2/5] Inicializando Secure Enclave de Hardware y Pasarela...')
    const authenticator = new WebAuthnBiometricAuthenticator('alice.biometrics@enterprise.vault')
    const gateway = new HederaWebAuthnGateway()

    // Registrar Passkey
    gateway.registerPasskey(authenticator.credentialId, authenticator.publicKeyPem)
    console.log(`[ PASSKEY REGISTRADA] ID de Credencial: ${authenticator.credentialId}`)
    console.log('[ CLAVE PÚBLICA] Clave SPKI NIST P-256 (secp256r1) registrada.')

    // 3. Emitir Desafío y Simular Autenticación Biométrica (FaceID / TouchID)
    console.log('\n[3/5] Solicitando Aserción Biométrica (Simulando Apple FaceID / TouchID)...')
    const challengeHex = gateway.generateChallenge()
    console.log(`[ DESAFÍO DE PASARELA] ${challengeHex}`)

    console.log('[ SENSOR TÁCTIL] Usuario presenta escaneo biométrico: Verificado (Usuario Presente=1, Verificado=1)')
    const assertion = authenticator.generateAssertion(challengeHex)
    console.log(`[ ASERCIÓN DER] Firma: ${assertion.signatureHex.substring(0, 32)}... (DER P-256 Válida)`)

    // 4. Verificación Criptográfica de la Pasarela
    console.log('\n[4/5] Pasarela Verificando Aserción Biométrica WebAuthn...')
    const result = gateway.verifyAssertion(assertion)

    if (!result.verified) {
      throw new Error(`Verificación WebAuthn rechazada: ${result.error}`)
    }

    console.log('[ WEBAUTHN VERIFICADO] ¡Prueba de hardware biométrico confirmada auténtica!')
    console.log(`• Usuario Presente (UP):  ${result.userPresent}`)
    console.log(`• Usuario Verificado (UV): ${result.userVerified}`)
    console.log(`• Contador de Firmas:     ${result.signCount}`)

    // 5. Ejecutar Transacción de Hedera Autorizada por Biometría
    console.log('\n[5/5] Ejecutando Transferencia en Hedera Autorizada por Biometría...')
    const authorizedTransferTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-0.01))
      .addHbarTransfer(AccountId.fromString(process.env.ACCOUNT_1_ID || '0.0.11226623'), new Hbar(0.01))
      .setTransactionMemo('Biometrically Authorized via Passkey P-256')
      .execute(client)

    const transferReceipt = await authorizedTransferTx.getReceipt(client)
    console.log(`[ TRANSACCIÓN EJECUTADA] Estado: ${transferReceipt.status.toString()}`)
    console.log(`[EXPLORADOR] ${getHashscanUrl(authorizedTransferTx.transactionId.toString())}`)

    // Anclar Prueba Biométrica en HCS
    const auditRecord = {
      p: 'webauthn-p256-hedera',
      op: 'biometric_assertion_verified',
      credentialId: authenticator.credentialId,
      signCount: result.signCount,
      flags: { userPresent: result.userPresent, userVerified: result.userVerified },
      txId: authorizedTransferTx.transactionId.toString(),
      timestamp: Date.now()
    }

    const auditSubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(auditRecord))
      .execute(client)

    const auditReceipt = await auditSubmitTx.getReceipt(client)
    console.log(`[ AUDITORÍA BIOMÉTRICA REGISTRADA] Secuencia HCS #${auditReceipt.topicSequenceNumber}`)

    // Persistir Estado
    updateState('WEBAUTHN_TOPIC_ID', topicId)
    updateState('WEBAUTHN_CREDENTIAL_ID', authenticator.credentialId)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Las Passkeys sustituyen a las vulnerables frases semilla por biometría vinculada a hardware.')
    console.log('El estándar NIST P-256 (secp256r1) asegura que las claves privadas nunca salgan del enclave,')
    console.log('mientras Hedera verifica aserciones o ancla pruebas de cumplimiento en HCS.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('WebAuthn protege contra phishing vinculando la firma al dominio (Origen) y al RP ID.')
    console.log('Un atacante en un sitio clonado de phishing no puede retransmitir aserciones a la pasarela legítima.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo en la Ejecución de Passkeys WebAuthn:', error.message)
    process.exit(1)
  } finally {
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
