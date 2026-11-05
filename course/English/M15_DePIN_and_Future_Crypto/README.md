# Module 15: DePIN & Frontier Crypto Architectures

Welcome to **Module 15**. This module explores frontier Web3 architectures integrated natively with Hedera: **DePIN (Decentralized Physical Infrastructure Networks)**, **Intent-Based Settlement Solvers (ERC-7683)**, **Passkeys / WebAuthn Biometrics (NIST P-256)**, and **zk-TLS Web Proofs (TLSNotary)**.

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
       │   • Sub-2s Finality             │
       │   • $0.0001 Fixed Consensus Fee │
       │   • Multi-Leg Atomic Transfers  │
       └─────────────────────────────────┘
```

---

## Lab Directory

| Lab | Name | Focus | Industry Standard |
| :--- | :--- | :--- | :--- |
| **01** | `01_depin_mqtts_pacemaker_telemetry.js` | Mission-Critical IoT Medical Telemetry | MQTTS, Ed25519 Hardware Signing, Merkle Batching |
| **02** | `02_depin_lightweight_cold_chain_api_key.js` | Low-Power Supply Chain & Vaccine Logistics | HTTP REST, API Key, HMAC-SHA256, SLA Slashing |
| **03** | `03_intent_based_defi_solver.js` | MEV-Resistant Cross-Asset Settlement | ERC-7683, Coincidence of Wants (CoW), Atomic Multi-Leg |
| **04** | `04_passkeys_webauthn_p256_authenticator.js` | Seedless Hardware Biometric Authentication | W3C WebAuthn, FIDO2, NIST P-256 (secp256r1) |
| **05** | `05_zktls_cryptographic_web_proofs.js` | Zero-Knowledge Web2 Attestation | TLSNotary, Reclaim Protocol, Blinding Commitments |

---

## Key Takeaways

1. **DePIN Edge Batching:** Never send every high-frequency sensor reading directly on-chain. Aggregate routine frames into Merkle Roots on HCS ($0.0001 USD), and reserve immediate consensus submissions for life-critical anomalies and emergency alerts.
2. **Low-Power Security:** Constrained devices preserve battery using HTTP + HMAC-SHA256 headers without heavy TLS handshakes, providing tamper-proof custody chains.
3. **Intent Solvers & CoW:** Users sign off-chain declarations without gas or slippage. Solvers match opposing orders directly and settle atomically via Hedera's multi-leg `TransferTransaction`.
4. **Passkeys Over Mnemonic Seeds:** W3C WebAuthn binds biometric signatures to specific origins and RP IDs, removing seed phrase vulnerabilities.
5. **zk-TLS Privacy:** Never leak confidential banking statements or PII on public ledgers; anchor zero-knowledge commitment hashes and notary signatures to HCS instead.

---

## References

- [Hedera Consensus Service Documentation](https://docs.hedera.com/native/consensus)
- [W3C Web Authentication (WebAuthn) Specification](https://www.w3.org/TR/webauthn-3/)
- [ERC-7683: Cross-Chain Intent Standard](https://eips.ethereum.org/EIPS/eip-7683)
- [TLSNotary Protocol Specification](https://tlsnotary.org/)
- [Reclaim Protocol Documentation](https://docs.reclaimprotocol.org/)
- [RFC 2104: Keyed-Hashing for Message Authentication (HMAC)](https://datatracker.ietf.org/doc/html/rfc2104)
