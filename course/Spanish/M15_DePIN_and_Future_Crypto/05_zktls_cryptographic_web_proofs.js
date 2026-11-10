/**
 * ============================================================================
 * Lab 05: zk-TLS y Pruebas Criptográficas Web (Modelo TLSNotary / Reclaim)
 * [CONCEPTO] Atestación Web2 de Conocimiento Cero Anclada al Consenso de Hedera
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La tokenización moderna de RWA y el DeFi institucional requieren verificar datos Web2
 * fuera de cadena (ej. demostrar patrimonio de inversionista acreditado > $1M, credenciales
 * médicas colegiadas o historiales crediticios) sin filtrar contraseñas, tokens de sesión
 * ni datos personales identificables (PII) en la cadena.
 * La arquitectura zk-TLS / TLSNotary divide una sesión TLS 1.3 entre el cliente y un notario.
 * El usuario divulga selectivamente solo la afirmación certificada mientras oculta los campos
 * confidenciales mediante compromisos criptográficos (compromiso SHA-256 cegado). La prueba
 * notarizada se ancla directamente a Hedera Consensus Service (HCS), proveyendo evidencia inmutable.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * No almacenes información confidencial o extractos bancarios en libros mayores públicos.
 * En su lugar, almacena únicamente el hash de compromiso de conocimiento cero y la firma
 * criptográfica del notario en HCS. Cualquier contrato inteligente o verificador puede
 * validar que la prueba fue certificada por un enclave confiable preservando el 100% de la privacidad.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M15 Lab 04: Autenticador Biométrico Passkeys y WebAuthn P-256
 * - Siguiente: (fin del curso)
 *
 * [ REFERENCIAS OFICIALES ]
 * - Especificaciones del Protocolo TLSNotary: https://tlsnotary.org/
 * - Documentación Oficial del Protocolo Reclaim: https://docs.reclaimprotocol.org/
 * - Servicio de Consenso de Hedera (HCS): https://docs.hedera.com/native/consensus
 *
 * [ SECUENCIA ]
 * Probador -> Banco: Sesión TLS 1.3 (simulada)
 * Notario -> Probador: Firma un compromiso de la respuesta (Ed25519)
 * Nota Probador: Revela solo la afirmación, no los datos privados
 * Probador -> Hedera: Prueba en HCS
 * Verificador -> Hedera: Revisar la firma del notario y el compromiso
 *
 * [ SIMULADO ]
 * La sesión TLS con el banco y el notario son emulados, y la atestación es un JSON propio de este lab firmado con Ed25519,
 * no el formato binario (BCS) de atestación de TLSNotary. Las firmas, sus verificaciones y la prueba en HCS son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M15_DePIN_and_Future_Crypto/05_zktls_cryptographic_web_proofs.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import crypto from 'node:crypto'
import { getClient, updateState, getHashscanUrl } from '../M99_Utilities/index.js'

/**
 * Nodo Notario MPC zk-TLS Emulado
 * Posee un par de claves notarias Ed25519 autorizadas para certificar autenticidad TLS.
 */
class ZkNotaryNode {
  constructor (notaryId = 'URN:NOTARY:MPC:ORACLE-NODE-01') {
    this.notaryId = notaryId
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    this.privateKey = privateKey
    this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
  }

  /**
   * Genera una atestación de prueba web firmada a partir de una sesión TLS verificable.
   */
  notarizeClaim (serverDomain, publicClaim, blindedCommitmentHash) {
    const attestationManifest = {
      standard: 'zkTLS-WebProof-v1',
      notaryId: this.notaryId,
      serverDomain,
      publicClaim,
      blindedCommitmentHash,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 86400000 // Validez de 24 horas
    }

    const manifestBuf = Buffer.from(JSON.stringify(attestationManifest))
    const notarySignature = crypto.sign(null, manifestBuf, this.privateKey)

    return {
      manifest: attestationManifest,
      notarySignatureHex: notarySignature.toString('hex'),
      notaryPublicKeyPem: this.publicKeyPem
    }
  }
}

/**
 * Probador del Lado del Cliente que ciega campos privados
 */
class ZkWebProver {
  constructor (userAccountId) {
    this.userAccountId = userAccountId
  }

  /**
   * Ciega datos bancarios privados generando una afirmación pública verificable.
   */
  preparePrivateProof (rawBankResponse) {
    // Generar sal secreta criptográfica para el cegado
    const blindingSecretSalt = crypto.randomBytes(32).toString('hex')

    // Comprometerse con los datos privados sin revelarlos: SHA-256(sal || datosPrivados)
    const blindedCommitmentHash = crypto
      .createHash('sha256')
      .update(blindingSecretSalt + JSON.stringify(rawBankResponse.privatePii))
      .digest('hex')

    const publicClaim = {
      userAccountId: this.userAccountId,
      claimType: 'ACCREDITED_INVESTOR_STATUS',
      isAccredited: rawBankResponse.certifiedMetrics.netWorthUsd >= 1000000,
      verificationThreshold: '$1,000,000+ USD',
      jurisdiction: rawBankResponse.certifiedMetrics.jurisdiction
    }

    return {
      publicClaim,
      blindedCommitmentHash,
      blindingSecretSalt
    }
  }
}

async function main () {
  console.log('====================================================================')
  console.log('ZK-TLS LAB 05: PRUEBAS CRIPTOGRÁFICAS WEB Y DIVULGACIÓN SELECTIVA')
  console.log('====================================================================\n')

  const { client, operatorId, network } = getClient()

  try {
    console.log(`[OPERADOR] Autenticado como ${operatorId} en Hedera ${network.toUpperCase()}`)

    // 1. Crear Tópico HCS para Atestaciones de Cumplimiento zk-TLS
    console.log('\n[1/5] Creando Tópico HCS Dedicado para Cumplimiento zk-TLS...')
    const topicCreateTx = await new TopicCreateTransaction()
      .setTopicMemo('Hedera zk-TLS Web Proofs & Accredited Investor Attestation Log')
      .execute(client)

    const topicReceipt = await topicCreateTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[ TÓPICO CREADO] ID: ${topicId}`)
    console.log(`[EXPLORADOR] https://hashscan.io/${network}/topic/${topicId}`)

    // 2. Inicializar Nodo Notario MPC y Probador del Cliente
    console.log('\n[2/5] Inicializando Notario Descentralizado y Probador del Cliente...')
    const notary = new ZkNotaryNode()
    const prover = new ZkWebProver(operatorId.toString())

    console.log(`[ NODO NOTARIO] ${notary.notaryId}`)
    console.log('[ CLAVE NOTARIO] Clave de atestación Ed25519 inicializada.')

    // 3. Emular Sesión HTTPS TLS 1.3 con Punto Final Financiero Institucional
    console.log('\n[3/5] Emulando Sesión Verificable TLS 1.3 con Punto Final Bancario...')
    const serverDomain = 'api.custody.institutional-bank.com'
    const rawBankTlsResponse = {
      privatePii: {
        legalName: 'Alice Vance',
        ssnTaxId: '***-**-8891',
        checkingAccountNumber: '4920-8819-2049-1120',
        exactBalanceTinybars: '4,520,000,000'
      },
      certifiedMetrics: {
        netWorthUsd: 2500000,
        jurisdiction: 'US'
      }
    }

    console.log(`[ SESIÓN TLS 1.3] Conectado a: https://${serverDomain}/v1/accredited-status`)
    console.log('• Datos Confidenciales PII: Número de Cuenta, SSN, Nombre Legal (OCULTOS Y CEGADOS)')
    console.log('• Métrica Certificada: Patrimonio Neto = $2,500,000 USD (Cumple Umbral Acreditado > $1M)')

    // 4. El Cliente Genera el Compromiso de Conocimiento Cero
    console.log('\n[4/5] Cliente Generando Compromiso de Conocimiento Cero y Atestación Notaria...')
    const { publicClaim, blindedCommitmentHash } = prover.preparePrivateProof(rawBankTlsResponse)

    console.log(`[ AFIRMACIÓN PÚBLICA] Tipo: ${publicClaim.claimType} | Acreditado: ${publicClaim.isAccredited}`)
    console.log(`[ HASH CEGADO] Compromiso SHA-256: ${blindedCommitmentHash}`)

    // El Notario valida la transcripción TLS y emite la atestación criptográfica
    const webProof = notary.notarizeClaim(serverDomain, publicClaim, blindedCommitmentHash)

    // Verificar Firma del Notario
    const manifestBuf = Buffer.from(JSON.stringify(webProof.manifest))
    const isNotarySigValid = crypto.verify(
      null,
      manifestBuf,
      webProof.notaryPublicKeyPem,
      Buffer.from(webProof.notarySignatureHex, 'hex')
    )

    if (!isNotarySigValid) {
      throw new Error('Fallo en la validación de la firma criptográfica de atestación notarial')
    }
    console.log(`[ ATESTACIÓN NOTARIA] Firma verificada: ${webProof.notarySignatureHex.substring(0, 32)}...`)

    // 5. Anclar la Atestación zk-TLS al Consenso de Hedera
    console.log('\n[5/5] Anclando Atestación de Prueba zk-TLS al Consenso de Hedera...')
    const onChainAttestationMessage = {
      p: 'zktls-webproof-v1',
      op: 'anchor_attestation',
      manifest: webProof.manifest,
      notarySignature: webProof.notarySignatureHex,
      timestamp: Date.now()
    }

    const attestationSubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(onChainAttestationMessage))
      .execute(client)

    const attestationReceipt = await attestationSubmitTx.getReceipt(client)
    console.log(`[ PRUEBA ANCLADA] Secuencia #${attestationReceipt.topicSequenceNumber} en HCS`)
    console.log(`[EXPLORADOR] ${getHashscanUrl(attestationSubmitTx.transactionId.toString())}`)

    // Persistir Estado
    updateState('ZKTLS_TOPIC_ID', topicId)
    updateState('ZKTLS_BLINDED_COMMITMENT', blindedCommitmentHash)
    updateState('ZKTLS_NOTARY_ID', notary.notaryId)

    console.log('\n CONCEPTO CLAVE:')
    console.log('zk-TLS demuestra datos Web2 fuera de cadena sin exponer credenciales ni PII confidencial.')
    console.log('Los usuarios divulgan afirmaciones selectivas, ciegan campos privados mediante compromisos')
    console.log('criptográficos y anclan la atestación notaria a Hedera Consensus Service para auditoría verificable.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Nunca publiques extractos bancarios o datos de identidad confidenciales directamente en la cadena.')
    console.log('Un compromiso con hash más la firma de un notario permite a cualquiera comprobar la afirmación sin ver los campos privados.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en la Ejecución de Pruebas zk-TLS:', error.message)
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
