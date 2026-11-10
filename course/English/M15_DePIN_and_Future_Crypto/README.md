# Module 15: DePIN & Frontier Crypto Architectures
## Edge Devices, Signed Intents, Passkeys and Private Proofs on Hedera

Welcome to **Module 15**. This module explores frontier Web3 architectures integrated natively with Hedera: **DePIN (Decentralized Physical Infrastructure Networks)**, **Intent-Based Settlement Solvers (ERC-7683)**, **Passkeys / WebAuthn Biometrics (NIST P-256)**, and **zk-TLS Web Proofs (TLSNotary)**.

> [!IMPORTANT]
> **OBJECTIVE:** Connect physical devices, signed intents, biometric passkeys and private Web2 data to Hedera, keeping only what must be public on the ledger and proving the rest with signatures, Merkle roots and commitments.

---

## Architecture Overview

```
                               ┌────────────────────────────────────────────────┐
                               │         FRONTIER CRYPTO ECOSYSTEM              │
                               └──────────────────────┬─────────────────────────┘
                                                      │
         ┌───────────────────┬────────────────────────┴───────────────┬───────────────────┐
         ▼                   ▼                                        ▼                   ▼
  ┌──────────────┐    ┌──────────────┐                         ┌──────────────┐    ┌──────────────┐
  │ DePIN MQTTS  │    │ DePIN REST   │                         │  ERC-7683    │    │ WebAuthn     │
  │ (Pacemaker)  │    │ (Cold-Chain) │                         │ Intent Solver│    │ Passkeys     │
  │ Ed25519 Sig  │    │ HMAC-SHA256  │                         │ CoW Matching │    │ NIST P-256   │
  └──────┬───────┘    └──────┬───────┘                         └──────┬───────┘    └──────┬───────┘
         │                   │                                        │                   │
         └─────────────┬─────┴────────────────────────────────────────┴───────────────────┘
                       │
                       ▼
       ┌─────────────────────────────────┐
       │   HEDERA CONSENSUS SERVICE      │
       │   • Finality in Seconds         │
       │   • $0.0001 Fixed Consensus Fee │
       │   • Multi-Leg Atomic Transfers  │
       └─────────────────────────────────┘
```

---

## Module Map

| Lab | Topic | Focus | Industry Standard |
| :--- | :--- | :--- | :--- |
| **01** | **Pacemaker MQTTS Telemetry** | Mission-Critical IoT Medical Telemetry | MQTTS, Ed25519 Hardware Signing, Merkle Batching |
| **02** | **Cold-Chain REST Telemetry** | Low-Power Supply Chain & Vaccine Logistics | HTTP REST, API Key, HMAC-SHA256, SLA Slashing |
| **03** | **Intent-Based DeFi Solver** | MEV-Resistant Cross-Asset Settlement | ERC-7683, Coincidence of Wants (CoW), Atomic Multi-Leg |
| **04** | **Passkeys (WebAuthn P-256)** | Seedless Hardware Biometric Authentication | W3C WebAuthn, FIDO2, NIST P-256 (secp256r1) |
| **05** | **zk-TLS Web Proofs** | Zero-Knowledge Web2 Attestation | TLSNotary, Reclaim Protocol, Blinding Commitments |

---

## Key Concepts

1. **DePIN Edge Batching:** Never send every high-frequency sensor reading directly on-chain. Aggregate routine frames into Merkle Roots on HCS ($0.0001 USD), and reserve immediate consensus submissions for life-critical anomalies and emergency alerts.
2. **Low-Power Security:** Constrained devices preserve battery using HTTP + HMAC-SHA256 headers without heavy TLS handshakes, providing tamper-proof custody chains.
3. **Intent Solvers & CoW:** Users sign off-chain declarations without gas or slippage. Solvers match opposing orders directly and settle atomically via Hedera's multi-leg `TransferTransaction`.
4. **Passkeys Over Mnemonic Seeds:** W3C WebAuthn binds biometric signatures to specific origins and RP IDs, removing seed phrase vulnerabilities.
5. **zk-TLS Privacy:** Never leak confidential banking statements or PII on public ledgers; anchor zero-knowledge commitment hashes and notary signatures to HCS instead.

---

## Before You Run

Every lab runs from the course web page or with `node`. Your testnet account signs and pays fees; some labs also use the practice wallets `ACCOUNT_1` and `ACCOUNT_2` (create them in the web Wallets panel, or set them in `.env`). A lab with an entry under **Run first** reads what that earlier lab saved in `state.json`, so run them in that order.

| Lab | Run first | Practice wallets | Cost |
| :--- | :--- | :--- | :--- |
| **01** | — | — | <0.1 ℏ (network fees only) |
| **02** | — | — | <1 ℏ (network fees only) |
| **03** | — | Yes | ~15 ℏ the first time (it creates the tUSD token); <1 ℏ after (reuses it), plus 0.5 HBAR sent to ACCOUNT_1 |
| **04** | — | Yes | <1 ℏ (network fees only) |
| **05** | — | — | <0.1 ℏ (network fees only) |

---

## Official References

- [Hedera Consensus Service Documentation](https://docs.hedera.com/native/consensus)
- [W3C Web Authentication (WebAuthn) Specification](https://www.w3.org/TR/webauthn-3/)
- [ERC-7683: Cross-Chain Intent Standard](https://eips.ethereum.org/EIPS/eip-7683)
- [TLSNotary Protocol Specification](https://tlsnotary.org/)
- [Reclaim Protocol Documentation](https://docs.reclaimprotocol.org/)
- [RFC 2104: Keyed-Hashing for Message Authentication (HMAC)](https://datatracker.ietf.org/doc/html/rfc2104)
