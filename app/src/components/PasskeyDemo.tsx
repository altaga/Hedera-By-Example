import React, { useState } from 'react'
import type { Lang } from '../lib/content'
import { isAccountId, type BrowserWallet } from '../lib/hederaBrowser'

/**
 * The real version of lab M15/04: a WebAuthn passkey on this device signs a
 * fresh challenge, the browser verifies the P-256 signature the way the
 * gateway in the lab does, and the audit record is anchored on HCS.
 */

const TEXT = {
  en: {
    title: 'Try it with your device',
    intro: 'The lab simulates the authenticator. Here your device does it for real: Face ID, Touch ID, Windows Hello or a security key creates a P-256 passkey, signs a fresh challenge, and the page verifies the signature before anchoring the audit on Hedera.',
    unsupported: 'This browser does not support passkeys (WebAuthn).',
    create: 'Create a passkey',
    sign: 'Sign a challenge',
    anchor: 'Anchor the audit on HCS',
    needAccount: 'Set up your testnet account to anchor the audit.',
    created: (alg: string) => `Passkey created · ${alg} · the private key stays in your device`,
    signed: (up: boolean, uv: boolean) => `Assertion received · user present: ${up ? 'yes' : 'no'} · user verified: ${uv ? 'yes' : 'no'}`,
    verified: 'Signature verified with WebCrypto against the passkey public key',
    invalid: 'Signature check failed',
    anchored: (seq: string) => `Audit anchored on HCS, sequence #${seq}`,
    publicKey: 'Public key (SPKI)',
    challenge: 'Challenge',
    signature: 'Signature (DER)',
    view: 'View on HashScan'
  },
  es: {
    title: 'Pruébalo con tu dispositivo',
    intro: 'El lab simula el autenticador. Aquí lo hace tu dispositivo de verdad: Face ID, Touch ID, Windows Hello o una llave de seguridad crea una passkey P-256, firma un desafío nuevo y la página verifica la firma antes de anclar la auditoría en Hedera.',
    unsupported: 'Este navegador no soporta passkeys (WebAuthn).',
    create: 'Crear una passkey',
    sign: 'Firmar un desafío',
    anchor: 'Anclar la auditoría en HCS',
    needAccount: 'Configura tu cuenta de testnet para anclar la auditoría.',
    created: (alg: string) => `Passkey creada · ${alg} · la llave privada se queda en tu dispositivo`,
    signed: (up: boolean, uv: boolean) => `Firma recibida · usuario presente: ${up ? 'sí' : 'no'} · usuario verificado: ${uv ? 'sí' : 'no'}`,
    verified: 'Firma verificada con WebCrypto contra la llave pública de la passkey',
    invalid: 'La verificación de la firma falló',
    anchored: (seq: string) => `Auditoría anclada en HCS, secuencia #${seq}`,
    publicKey: 'Llave pública (SPKI)',
    challenge: 'Desafío',
    signature: 'Firma (DER)',
    view: 'Ver en HashScan'
  }
}

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('')
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** WebAuthn returns ECDSA signatures in DER; WebCrypto verifies raw r||s. */
function derToRaw (der: Uint8Array): Uint8Array {
  let i = 2
  const read = () => {
    i++ // INTEGER tag
    const len = der[i++]
    let v = der.slice(i, i + len)
    i += len
    while (v.length > 32 && v[0] === 0) v = v.slice(1)
    const out = new Uint8Array(32)
    out.set(v, 32 - v.length)
    return out
  }
  const r = read()
  const s = read()
  const raw = new Uint8Array(64)
  raw.set(r, 0)
  raw.set(s, 32)
  return raw
}

interface Step { state: 'good' | 'critical'; text: string; detail?: string; url?: string }

export function PasskeyDemo ({ lang, wallet }: { lang: Lang; wallet: BrowserWallet }) {
  const t = TEXT[lang]
  const supported = typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials
  const [cred, setCred] = useState<{ id: ArrayBuffer; spki: ArrayBuffer } | null>(null)
  const [proof, setProof] = useState<{ challenge: string; signature: string; up: boolean; uv: boolean; valid: boolean } | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [busy, setBusy] = useState(false)
  const push = (s: Step) => setSteps((prev) => [...prev, s])
  const fail = (e: any) => push({ state: 'critical', text: e?.message || String(e) })

  const create = async () => {
    setBusy(true)
    try {
      const pk = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'Hedera by Example' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'hbe-learner', displayName: 'Hedera by Example learner' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 = ECDSA P-256 + SHA-256
          authenticatorSelection: { userVerification: 'preferred', residentKey: 'discouraged' },
          attestation: 'none',
          timeout: 60000
        }
      }) as PublicKeyCredential
      const res = pk.response as AuthenticatorAttestationResponse
      const spki = res.getPublicKey?.()
      if (!spki || res.getPublicKeyAlgorithm?.() !== -7) throw new Error('The authenticator did not return a P-256 (ES256) public key.')
      setCred({ id: pk.rawId, spki })
      setProof(null)
      push({ state: 'good', text: t.created('ES256 / P-256'), detail: `${t.publicKey}: ${hex(spki).slice(0, 48)}…` })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const sign = async () => {
    if (!cred) return
    setBusy(true)
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32))
      const assertion = await navigator.credentials.get({
        publicKey: { challenge, allowCredentials: [{ type: 'public-key', id: cred.id }], userVerification: 'preferred', timeout: 60000 }
      }) as PublicKeyCredential
      const res = assertion.response as AuthenticatorAssertionResponse
      const authData = new Uint8Array(res.authenticatorData)
      const clientData = JSON.parse(new TextDecoder().decode(res.clientDataJSON))
      const up = (authData[32] & 0x01) !== 0
      const uv = (authData[32] & 0x04) !== 0
      push({ state: 'good', text: t.signed(up, uv), detail: `${t.challenge}: ${hex(challenge).slice(0, 32)}…` })

      // The gateway's checks: same challenge, then ECDSA over authenticatorData || SHA-256(clientDataJSON).
      const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', res.clientDataJSON))
      const signed = new Uint8Array(authData.length + clientHash.length)
      signed.set(authData, 0)
      signed.set(clientHash, authData.length)
      const key = await crypto.subtle.importKey('spki', cred.spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      const valid = clientData.challenge === b64url(challenge.buffer) &&
        await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(new Uint8Array(res.signature)) as BufferSource, signed as BufferSource)
      setProof({ challenge: hex(challenge), signature: hex(res.signature), up, uv, valid })
      push({ state: valid ? 'good' : 'critical', text: valid ? t.verified : t.invalid, detail: `${t.signature}: ${hex(res.signature).slice(0, 48)}…` })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const anchor = async () => {
    if (!proof || !cred) return
    setBusy(true)
    try {
      const hedera = await import('@hiero-ledger/sdk')
      const client = hedera.Client.forTestnet()
      const key = /^30[0-9a-f]{60,}$/i.test(wallet.privateKey) ? hedera.PrivateKey.fromStringDer(wallet.privateKey) : hedera.PrivateKey.fromString(wallet.privateKey)
      client.setOperator(hedera.AccountId.fromString(wallet.accountId), key)
      const topicTx = await new hedera.TopicCreateTransaction().setTopicMemo('HBE passkey audit').execute(client)
      const topicId = (await topicTx.getReceipt(client)).topicId!
      const fingerprint = hex(await crypto.subtle.digest('SHA-256', cred.spki))
      const message = JSON.stringify({ type: 'WEBAUTHN_ASSERTION_VERIFIED', alg: 'ES256', keyFingerprint: fingerprint, challenge: proof.challenge, userPresent: proof.up, userVerified: proof.uv, at: new Date().toISOString() })
      const submit = await new hedera.TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message).execute(client)
      const receipt = await submit.getReceipt(client)
      client.close()
      push({ state: 'good', text: t.anchored(String(receipt.topicSequenceNumber)), url: `https://hashscan.io/testnet/topic/${topicId}` })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const canAnchor = isAccountId(wallet.accountId) && !!wallet.privateKey
  return (
    <section className='lab-extra' aria-labelledby='passkey-title' data-testid='passkey-demo'>
      <h2 id='passkey-title' className='section-title'>{t.title}</h2>
      <p className='muted'>{t.intro}</p>
      {!supported
        ? <p className='form-msg'>{t.unsupported}</p>
        : (
          <div className='btn-row'>
            <button type='button' className='btn btn-secondary btn-sm' onClick={create} disabled={busy} data-testid='passkey-create'>{t.create}</button>
            <button type='button' className='btn btn-secondary btn-sm' onClick={sign} disabled={busy || !cred} data-testid='passkey-sign'>{t.sign}</button>
            <button type='button' className='btn btn-secondary btn-sm' onClick={anchor} disabled={busy || !proof?.valid || !canAnchor} data-testid='passkey-anchor'>{t.anchor}</button>
          </div>
          )}
      {!canAnchor && supported && <p className='form-msg'>{t.needAccount}</p>}
      {steps.length > 0 && (
        <ol className='states' data-testid='passkey-steps'>
          {steps.map((s, i) => (
            <li key={i} className='state'>
              <span className={`state-icon st-${s.state}`} aria-hidden='true'>{s.state === 'good' ? '✓' : '✕'}</span>
              <span className='state-label'>{s.text}</span>
              <span className='state-detail'>{s.detail}{s.url && <a href={s.url} target='_blank' rel='noopener noreferrer'>{t.view}</a>}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
