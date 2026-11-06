/**
 * ============================================================================
 * Lab 09: Buzón de Mensajes Privado HIP-1334 en HCS
 * [CONCEPTO] Mensajes Cifrados a Cualquier Cuenta, Descubiertos por su Memo de Cuenta
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * HIP-1334 (Activo, estándar de Aplicación) permite que cualquier cuenta reciba mensajes
 * cifrados de extremo a extremo en un topic HCS. Este lab sigue la especificación paso a paso:
 * 1. Configuración (destinatario): crea un topic con la clave del destinatario como admin key y
 *    memo `[HIP-1334:<account-id>]`; publica un PRIMER mensaje
 *    `{ payload: { type: "HIP-1334_PUBLIC_KEY", encryptionType: "ECIES", publicKey }, proof }`
 *    donde `proof.signature` firma "\x19Hedera Signed Message:\n" + len + canonicalJSON(payload);
 *    luego fija el memo de la cuenta en `[HIP-1334:<topic-id>]` con AccountUpdateTransaction.
 * 2. Envío (remitente): lee el memo del Mirror Node, obtiene el mensaje #1, VERIFICA la
 *    prueba contra la clave de la cuenta en el Mirror Node, cifra con ECIES
 *    (ECDH secp256k1 -> SHA-256 -> AES-256-GCM) y envía un sobre
 *    `HIP-1334_ENCRYPTED_MESSAGE`.
 * 3. Recepción (destinatario): lee el topic desde el Mirror Node y descifra.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * El primer mensaje firmado evita el front-running: cualquiera puede publicar en el topic,
 * pero solo el dueño de la cuenta puede producir una prueba que coincida con su clave on-chain.
 * ECIES requiere una cuenta secp256k1 (ECDSA); las cuentas ED25519 deben usar RSA.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://github.com/hiero-ledger/hiero-improvement-proposals/blob/main/HIP/hip-1334.md
 * - https://github.com/InternetOfPeers/hiero-message-box
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 08: HashLinks HCS-12 (Micro-Apps Interactivas) y Registro de Adaptadores HCS-21
 * - Siguiente: M14 Lab 10: Servidor MCP de Hedera con un Guardián de Políticas Propio
 *
 * [ SECUENCIA ]
 * Destinatario -> Hedera: Topic (admin key, memo [HIP-1334:cuenta]) + HIP-1334_PUBLIC_KEY firmado
 * Destinatario -> Hedera: Memo de cuenta [HIP-1334:topic]
 * Remitente -> Mirror Node: Descubre el topic y verifica la prueba
 * Remitente -> Hedera: HIP-1334_ENCRYPTED_MESSAGE (ECIES)
 * Destinatario -> Mirror Node: Lee y descifra
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el remitente; crea 1 destinatario ECDSA desechable.
 * - Costo: ~1.5 ℏ para el destinatario + comisiones.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/09_hip1334_encrypted_message_box.js
 * ============================================================================
 */

import crypto from 'node:crypto'
import { AccountUpdateTransaction, PublicKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { createClient, createLabAccount, getClient, getHashscanUrl, getMirrorNodeBaseUrl, updateState, waitForMirror } from '../M99_Utilities/index.js'

// --- Utilidades HIP-1334 (spec "Deterministic Signature Serialization") ---
const canonicalJSON = (obj) => {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJSON).join(',') + ']'
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}'
}
const signedBytes = (payload) => {
  const json = canonicalJSON(payload)
  return Buffer.from('\x19Hedera Signed Message:\n' + Buffer.byteLength(json, 'utf8') + json, 'utf8')
}

// --- ECIES secp256k1 según la spec: ECDH -> SHA-256 -> AES-256-GCM ---
const eciesEncrypt = (recipientPubHex, plaintext) => {
  const eph = crypto.createECDH('secp256k1')
  eph.generateKeys()
  const shared = eph.computeSecret(Buffer.from(recipientPubHex, 'hex'))
  const key = crypto.createHash('sha256').update(shared).digest()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encryptedData = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    type: 'ECIES',
    ephemeralPublicKey: eph.getPublicKey('hex', 'compressed'),
    iv: iv.toString('base64'),
    encryptedData: encryptedData.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    curve: 'secp256k1'
  }
}
const eciesDecrypt = (privRaw, data) => {
  const ecdh = crypto.createECDH('secp256k1')
  ecdh.setPrivateKey(privRaw)
  const key = crypto.createHash('sha256').update(ecdh.computeSecret(Buffer.from(data.ephemeralPublicKey, 'hex'))).digest()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(data.authTag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data.encryptedData, 'base64')), decipher.final()]).toString('utf8')
}

const mirror = async (path) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1${path}`)
  return res.ok ? res.json() : null
}
const decodeMsg = (m) => JSON.parse(Buffer.from(m.message, 'base64').toString('utf8'))

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Buzón de Mensajes Privado HIP-1334 ---\n')
  const { client } = getClient()

  try {
    // 1. El destinatario configura su buzón
    console.log('[PROCESO] Paso 1: Creando el destinatario (cuenta ECDSA secp256k1)...')
    const recipient = await createLabAccount(client, { hbar: 1.5, ecdsa: true })
    const recipientId = recipient.accountId.toString()
    const rClient = createClient(recipientId, recipient.privateKey)
    const pubHex = recipient.privateKey.publicKey.toStringRaw()
    console.log(`[REGISTRO] Destinatario ${recipientId}`)

    console.log('\n[PROCESO] Paso 2: Topic con admin key + memo [HIP-1334:<cuenta>], luego el primer mensaje firmado...')
    const topicId = (await (await new TopicCreateTransaction()
      .setAdminKey(recipient.privateKey.publicKey)
      .setTopicMemo(`[HIP-1334:${recipientId}] listens here for HIP-1334 encrypted messages.`)
      .execute(rClient)).getReceipt(rClient)).topicId
    const payload = {
      encryptionType: 'ECIES',
      publicKey: { curve: 'secp256k1', key: pubHex, type: 'ECIES' },
      type: 'HIP-1334_PUBLIC_KEY'
    }
    const firstMessage = {
      payload,
      proof: {
        accountId: recipientId,
        signerPublicKey: pubHex,
        signerKeyType: 'ECDSA_SECP256K1',
        signature: Buffer.from(recipient.privateKey.sign(signedBytes(payload))).toString('hex')
      }
    }
    await (await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(JSON.stringify(firstMessage)).execute(rClient)).getReceipt(rClient)
    const memoRes = await new AccountUpdateTransaction().setAccountId(recipient.accountId)
      .setAccountMemo(`[HIP-1334:${topicId}] is my message box.`).execute(rClient)
    await memoRes.getReceipt(rClient)
    console.log(`[ÉXITO] Buzón ${topicId} anunciado en el memo de la cuenta — ${getHashscanUrl(memoRes)}`)

    // 2. El remitente descubre, verifica y cifra
    console.log('\n[PROCESO] Paso 3: El remitente descubre el buzón vía Mirror Node y verifica la prueba...')
    const account = await waitForMirror(async () => {
      const a = await mirror(`/accounts/${recipientId}`)
      return a && /\[HIP-1334:(\d+\.\d+\.\d+)\]/.test(a.memo) ? a : null
    }, { timeoutMs: 60_000 })
    if (!account) throw new Error('No se encontró memo HIP-1334 en el Mirror Node')
    const boxId = account.memo.match(/\[HIP-1334:(\d+\.\d+\.\d+)\]/)[1]
    const first = await waitForMirror(async () => (await mirror(`/topics/${boxId}/messages?sequencenumber=1`))?.messages?.[0], { timeoutMs: 60_000 })
    const fm = decodeMsg(first)
    if (fm.payload?.type !== 'HIP-1334_PUBLIC_KEY') throw new Error('El primer mensaje no es HIP-1334_PUBLIC_KEY')
    if (fm.proof.accountId !== recipientId) throw new Error('El accountId de la prueba no coincide con el destinatario')
    if (fm.proof.signerPublicKey !== account.key.key) throw new Error('La clave de la prueba no coincide con la clave de la cuenta en el Mirror Node')
    const ok = PublicKey.fromStringECDSA(account.key.key).verify(signedBytes(fm.payload), Buffer.from(fm.proof.signature, 'hex'))
    if (!ok) throw new Error('Prueba HIP-1334 inválida — se rechaza el envío')
    console.log(`[VERIFICACIÓN] Buzón ${boxId}: firma de la prueba válida para ${recipientId} (tipo de clave ${account.key._type})`)

    const forged = { ...fm.payload, publicKey: { ...fm.payload.publicKey, key: '02' + 'ab'.repeat(32) } }
    console.log(`[VERIFICACIÓN] Un payload falsificado por un front-runner falla la verificación: ${!PublicKey.fromStringECDSA(account.key.key).verify(signedBytes(forged), Buffer.from(fm.proof.signature, 'hex'))}`)

    console.log('\n[PROCESO] Paso 4: El remitente envía un HIP-1334_ENCRYPTED_MESSAGE con ECIES...')
    const secret = 'Ventana de liquidación movida a las 14:00 UTC. Ref #A-7731.'
    const envelope = { type: 'HIP-1334_ENCRYPTED_MESSAGE', format: 'json', data: eciesEncrypt(fm.payload.publicKey.key, secret) }
    const sendRes = await new TopicMessageSubmitTransaction().setTopicId(boxId).setMessage(JSON.stringify(envelope)).execute(client)
    await sendRes.getReceipt(client)
    console.log(`[ÉXITO] Mensaje cifrado enviado — ${sendRes.transactionId} | ${getHashscanUrl(sendRes)}`)

    // 3. El destinatario lee y descifra
    console.log('\n[PROCESO] Paso 5: El destinatario lee el buzón desde el Mirror Node y descifra...')
    const msg = await waitForMirror(async () => (await mirror(`/topics/${boxId}/messages?sequencenumber=gt:1`))?.messages?.[0], { timeoutMs: 60_000 })
    const env = decodeMsg(msg)
    console.log(`[REGISTRO] Texto cifrado on-chain: ${env.data.encryptedData.slice(0, 40)}...`)
    const plain = eciesDecrypt(Buffer.from(recipient.privateKey.toBytesRaw()), env.data)
    console.log(`[ÉXITO] Descifrado: "${plain}" | coincide: ${plain === secret}`)
    rClient.close()

    updateState('HIP1334_BOX_TOPIC_ID', boxId)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Descubrimiento (memo), autenticidad (primer mensaje firmado) y privacidad (ECIES) usan')
    console.log('HCS, memos de cuenta y el Mirror Node — sin cambios de protocolo.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló el flujo HIP-1334:', error.message)
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
