/**
 * The parts of Node's `crypto` module that the course labs use, implemented
 * with the audited @noble libraries so results match Node byte for byte:
 * AES-256-GCM/CBC ciphers, ECDH (prime256v1, secp256k1) and Ed25519 / P-256
 * key pairs, signatures and SPKI/PEM export.
 */
import { gcm, cbc } from '@noble/ciphers/aes.js'
import { p256 } from '@noble/curves/nist.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { Buffer } from 'buffer'

type Enc = BufferEncoding | undefined
const bytes = (data: any, enc?: Enc): Uint8Array =>
  typeof data === 'string' ? Buffer.from(data, enc || 'utf8') : data instanceof Uint8Array ? data : Buffer.from(data)
const out = (b: Uint8Array, enc?: Enc) => (enc ? Buffer.from(b).toString(enc) : Buffer.from(b))

const AUTH_FAIL = 'Unsupported state or unable to authenticate data'

/** createCipheriv / createDecipheriv for aes-256-gcm and aes-256-cbc. */
export function createCipher (decrypt: boolean, algorithm: string, key: any, iv: any) {
  const alg = String(algorithm).toLowerCase()
  if (!['aes-256-gcm', 'aes-128-gcm', 'aes-256-cbc', 'aes-128-cbc'].includes(alg)) {
    throw new Error(`Cipher ${algorithm} is not available in the browser runner.`)
  }
  const isGcm = alg.endsWith('gcm')
  const chunks: Uint8Array[] = []
  let tag: Uint8Array | null = null
  let aad: Uint8Array | undefined
  const api = {
    // Output is produced in final(); labs concatenate update() + final().
    update: (data: any, inEnc?: Enc, outEnc?: Enc) => {
      chunks.push(bytes(data, inEnc))
      return out(new Uint8Array(0), outEnc)
    },
    final: (outEnc?: Enc) => {
      const input = Buffer.concat(chunks.map((c) => Buffer.from(c)))
      const k = bytes(key)
      const nonce = bytes(iv)
      if (!isGcm) return out(decrypt ? cbc(k, nonce).decrypt(input) : cbc(k, nonce).encrypt(input), outEnc)
      if (!decrypt) {
        const sealed = gcm(k, nonce, aad).encrypt(input)
        tag = sealed.slice(sealed.length - 16)
        return out(sealed.slice(0, sealed.length - 16), outEnc)
      }
      if (!tag) throw new Error(AUTH_FAIL)
      try {
        return out(gcm(k, nonce, aad).decrypt(Buffer.concat([input, Buffer.from(tag)])), outEnc)
      } catch (_) {
        throw new Error(AUTH_FAIL) // same message Node gives for a tampered ciphertext
      }
    },
    getAuthTag: () => {
      if (!tag) throw new Error('getAuthTag() is only available after final()')
      return Buffer.from(tag)
    },
    setAuthTag: (t: any) => { tag = bytes(t); return api },
    setAAD: (a: any) => { aad = bytes(a); return api },
    setAutoPadding: () => api
  }
  return api
}

const CURVES: Record<string, any> = { prime256v1: p256, 'p-256': p256, secp256r1: p256, secp256k1 }

/** crypto.createECDH(curve) */
export function createECDH (curveName: string) {
  const curve = CURVES[String(curveName).toLowerCase()]
  if (!curve) throw new Error(`ECDH curve ${curveName} is not available in the browser runner.`)
  let sk: Uint8Array | null = null
  const pub = (enc?: Enc, format?: string) => out(curve.getPublicKey(sk, format === 'compressed'), enc)
  return {
    generateKeys: (enc?: Enc, format?: string) => { sk = curve.utils.randomSecretKey(); return pub(enc, format) },
    getPublicKey: (enc?: Enc, format?: string) => pub(enc, format),
    getPrivateKey: (enc?: Enc) => out(sk as Uint8Array, enc),
    setPrivateKey: (key: any, enc?: Enc) => { sk = bytes(key, enc) },
    // Node returns the x-coordinate of the shared point.
    computeSecret: (other: any, inEnc?: Enc, outEnc?: Enc) => out(curve.getSharedSecret(sk, bytes(other, inEnc), true).slice(1), outEnc)
  }
}

// SPKI DER prefixes for the two key types the labs export.
const SPKI_PREFIX = {
  ed25519: Buffer.from('302a300506032b6570032100', 'hex'),
  p256: Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex')
}

const toPem = (der: Uint8Array, label: string) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----\n`

interface KeyObjectLike { __kind: 'ed25519' | 'p256'; __type: 'public' | 'private'; __bytes: Uint8Array; type: string; asymmetricKeyType: string; export: (o?: any) => any }

function keyObject (kind: 'ed25519' | 'p256', type: 'public' | 'private', raw: Uint8Array): KeyObjectLike {
  return {
    __kind: kind,
    __type: type,
    __bytes: raw,
    type,
    asymmetricKeyType: kind === 'ed25519' ? 'ed25519' : 'ec',
    export: (o: any = {}) => {
      if (type === 'private') {
        if (o.format === 'jwk') return { kty: kind === 'ed25519' ? 'OKP' : 'EC' }
        throw new Error('Exporting private keys is not available in the browser runner.')
      }
      const der = Buffer.concat([SPKI_PREFIX[kind], Buffer.from(raw)])
      return o.format === 'pem' ? toPem(der, 'PUBLIC KEY') : der
    }
  }
}

/** crypto.generateKeyPairSync('ed25519') and ('ec', { namedCurve: 'prime256v1' }) */
export function generateKeyPairSync (type: string, options: any = {}) {
  const t = String(type).toLowerCase()
  if (t === 'ed25519') {
    const sk = ed25519.utils.randomSecretKey()
    return { privateKey: keyObject('ed25519', 'private', sk), publicKey: keyObject('ed25519', 'public', ed25519.getPublicKey(sk)) }
  }
  if (t === 'ec' && CURVES[String(options.namedCurve || '').toLowerCase()] === p256) {
    const sk = p256.utils.randomSecretKey()
    return { privateKey: keyObject('p256', 'private', sk), publicKey: keyObject('p256', 'public', p256.getPublicKey(sk, false)) }
  }
  throw new Error(`generateKeyPairSync('${type}') is not available in the browser runner.`)
}

/** Accepts a KeyObject, a PEM/DER SPKI public key, or { key, format, type }. */
function publicKeyOf (key: any): { kind: 'ed25519' | 'p256'; raw: Uint8Array } {
  if (key?.__kind) return { kind: key.__kind, raw: key.__type === 'public' ? key.__bytes : (key.__kind === 'ed25519' ? ed25519.getPublicKey(key.__bytes) : p256.getPublicKey(key.__bytes, false)) }
  const material = key?.key ?? key
  const der = typeof material === 'string' && material.includes('BEGIN')
    ? Buffer.from(material.replace(/-----[^-]+-----|\s+/g, ''), 'base64')
    : Buffer.from(bytes(material))
  if (der.subarray(0, SPKI_PREFIX.ed25519.length).equals(SPKI_PREFIX.ed25519)) return { kind: 'ed25519', raw: der.subarray(SPKI_PREFIX.ed25519.length) }
  if (der.subarray(0, SPKI_PREFIX.p256.length).equals(SPKI_PREFIX.p256)) return { kind: 'p256', raw: der.subarray(SPKI_PREFIX.p256.length) }
  throw new Error('Unsupported public key format in the browser runner (Ed25519 or P-256 SPKI expected).')
}

/** crypto.sign(algorithm, data, privateKey) — Ed25519 (algorithm null) or P-256 with SHA-256 (DER signature). */
export function sign (_algorithm: string | null, data: any, key: any) {
  if (!key?.__kind || key.__type !== 'private') throw new Error('crypto.sign needs a private KeyObject in the browser runner.')
  const msg = bytes(data)
  return key.__kind === 'ed25519'
    ? Buffer.from(ed25519.sign(msg, key.__bytes))
    : Buffer.from(p256.sign(msg, key.__bytes, { format: 'der' }))
}

/** crypto.verify(algorithm, data, publicKey, signature) */
export function verify (_algorithm: string | null, data: any, key: any, signature: any) {
  const { kind, raw } = publicKeyOf(key)
  try {
    return kind === 'ed25519'
      ? ed25519.verify(bytes(signature), bytes(data), raw)
      : p256.verify(bytes(signature), bytes(data), raw, { format: 'der' })
  } catch (_) {
    return false
  }
}
