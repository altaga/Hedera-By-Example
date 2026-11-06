/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 09: HIP-1334 Private Message Box on HCS
 * [CONCEPT] Encrypted Messages to Any Account, Discovered via Its Account Memo
 * ============================================================================
 * [ KEY CONCEPT ]
 * HIP-1334 (Active, Application standard) lets any account receive end-to-end
 * encrypted messages on an HCS topic. This lab follows the spec step by step:
 * 1. Setup (recipient): create a topic with the recipient's key as admin key and
 *    memo `[HIP-1334:<account-id>]`; publish a FIRST message
 *    `{ payload: { type: "HIP-1334_PUBLIC_KEY", encryptionType: "ECIES", publicKey }, proof }`
 *    where `proof.signature` signs "\x19Hedera Signed Message:\n" + len + canonicalJSON(payload);
 *    then set the account memo to `[HIP-1334:<topic-id>]` with AccountUpdateTransaction.
 * 2. Send (sender): read the memo from the Mirror Node, fetch message #1, VERIFY the
 *    proof against the account key on the Mirror Node, encrypt with ECIES
 *    (secp256k1 ECDH -> SHA-256 -> AES-256-GCM) and submit a
 *    `HIP-1334_ENCRYPTED_MESSAGE` envelope.
 * 3. Receive (recipient): read the topic from the Mirror Node and decrypt.
 *
 * [ LEARNABLE MOMENT ]
 * The signed first message stops front-running: anyone can post to the topic, but
 * only the account owner can produce a proof that matches its on-chain key.
 * ECIES needs a secp256k1 (ECDSA) account; ED25519 accounts must use RSA instead.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://github.com/hiero-ledger/hiero-improvement-proposals/blob/main/HIP/hip-1334.md
 * - https://github.com/InternetOfPeers/hiero-message-box
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 08: HCS-12 HashLinks & HCS-21 Verified Adapters
 * - Next:     M14 Lab 10: Hedera MCP Server with a Custom Policy Guard
 *
 * [SEQUENCE]
 * Recipient -> Hedera: Topic (admin key, [HIP-1334:account] memo) + signed HIP-1334_PUBLIC_KEY
 * Recipient -> Hedera: Account memo [HIP-1334:topic]
 * Sender -> Mirror Node: Discover topic, verify proof
 * Sender -> Hedera: HIP-1334_ENCRYPTED_MESSAGE (ECIES)
 * Recipient -> Mirror Node: Read and decrypt
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the sender; it creates 1 throwaway ECDSA recipient.
 * - Cost: ~0.3 ℏ funded to the recipient + fees.
 *
 * [ HOW TO RUN ]
 * node English/M14_Advanced_HCS_Standards_AI/09_hip1334_encrypted_message_box.js
 * ============================================================================
 */

import crypto from 'node:crypto'
import { AccountUpdateTransaction, PublicKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { createClient, createLabAccount, getClient, getHashscanUrl, getMirrorNodeBaseUrl, updateState, waitForMirror } from '../M99_Utilities/index.js'

// --- HIP-1334 helpers (spec "Deterministic Signature Serialization") ---
const canonicalJSON = (obj) => {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJSON).join(',') + ']'
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}'
}
const signedBytes = (payload) => {
  const json = canonicalJSON(payload)
  return Buffer.from('\x19Hedera Signed Message:\n' + Buffer.byteLength(json, 'utf8') + json, 'utf8')
}

// --- ECIES secp256k1 per spec: ECDH -> SHA-256 -> AES-256-GCM ---
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
  console.log('--- SESSION START: HIP-1334 Private Message Box ---\n')
  const { client } = getClient()

  try {
    // 1. Recipient sets up its message box
    console.log('[PROCESS] Step 1: Creating the recipient (ECDSA secp256k1 account)...')
    const recipient = await createLabAccount(client, { hbar: 0.3, ecdsa: true })
    const recipientId = recipient.accountId.toString()
    const rClient = createClient(recipientId, recipient.privateKey)
    const pubHex = recipient.privateKey.publicKey.toStringRaw()
    console.log(`[LOG] Recipient ${recipientId}`)

    console.log('\n[PROCESS] Step 2: Topic with admin key + memo [HIP-1334:<account>], then the signed first message...')
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
    console.log(`[SUCCESS] Message box ${topicId} advertised in the account memo — ${getHashscanUrl(memoRes)}`)

    // 2. Sender discovers, verifies and encrypts
    console.log('\n[PROCESS] Step 3: Sender discovers the box via the Mirror Node and verifies the proof...')
    const account = await waitForMirror(async () => {
      const a = await mirror(`/accounts/${recipientId}`)
      return a && /\[HIP-1334:(\d+\.\d+\.\d+)\]/.test(a.memo) ? a : null
    }, { timeoutMs: 60_000 })
    if (!account) throw new Error('No HIP-1334 memo found on the Mirror Node')
    const boxId = account.memo.match(/\[HIP-1334:(\d+\.\d+\.\d+)\]/)[1]
    const first = await waitForMirror(async () => (await mirror(`/topics/${boxId}/messages?sequencenumber=1`))?.messages?.[0], { timeoutMs: 60_000 })
    const fm = decodeMsg(first)
    if (fm.payload?.type !== 'HIP-1334_PUBLIC_KEY') throw new Error('First message is not HIP-1334_PUBLIC_KEY')
    if (fm.proof.accountId !== recipientId) throw new Error('Proof accountId does not match the recipient')
    if (fm.proof.signerPublicKey !== account.key.key) throw new Error('Proof key does not match the account key on the Mirror Node')
    const ok = PublicKey.fromStringECDSA(account.key.key).verify(signedBytes(fm.payload), Buffer.from(fm.proof.signature, 'hex'))
    if (!ok) throw new Error('Invalid HIP-1334 proof — refusing to send')
    console.log(`[VERIFY] Box ${boxId}: proof signature valid for ${recipientId} (key type ${account.key._type})`)

    const forged = { ...fm.payload, publicKey: { ...fm.payload.publicKey, key: '02' + 'ab'.repeat(32) } }
    console.log(`[VERIFY] A front-runner's forged payload fails verification: ${!PublicKey.fromStringECDSA(account.key.key).verify(signedBytes(forged), Buffer.from(fm.proof.signature, 'hex'))}`)

    console.log('\n[PROCESS] Step 4: Sender submits an ECIES HIP-1334_ENCRYPTED_MESSAGE...')
    const secret = 'Settlement window moved to 14:00 UTC. Ref #A-7731.'
    const envelope = { type: 'HIP-1334_ENCRYPTED_MESSAGE', format: 'json', data: eciesEncrypt(fm.payload.publicKey.key, secret) }
    const sendRes = await new TopicMessageSubmitTransaction().setTopicId(boxId).setMessage(JSON.stringify(envelope)).execute(client)
    await sendRes.getReceipt(client)
    console.log(`[SUCCESS] Encrypted message sent — ${sendRes.transactionId} | ${getHashscanUrl(sendRes)}`)

    // 3. Recipient reads and decrypts
    console.log('\n[PROCESS] Step 5: Recipient reads the box from the Mirror Node and decrypts...')
    const msg = await waitForMirror(async () => (await mirror(`/topics/${boxId}/messages?sequencenumber=gt:1`))?.messages?.[0], { timeoutMs: 60_000 })
    const env = decodeMsg(msg)
    console.log(`[LOG] On-chain ciphertext: ${env.data.encryptedData.slice(0, 40)}...`)
    const plain = eciesDecrypt(Buffer.from(recipient.privateKey.toBytesRaw()), env.data)
    console.log(`[SUCCESS] Decrypted: "${plain}" | matches: ${plain === secret}`)
    rClient.close()

    updateState('HIP1334_BOX_TOPIC_ID', boxId)

    console.log('\n KEY CONCEPT:')
    console.log('Discovery (memo), authenticity (signed first message) and privacy (ECIES) all use')
    console.log('plain HCS, account memos and the Mirror Node — no protocol changes required.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] HIP-1334 flow failed:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
