# Módulo 15: DePIN y Arquitecturas Cripto de Frontera

Bienvenido al **Módulo 15**. Este módulo explora arquitecturas Web3 de vanguardia integradas de forma nativa con Hedera: **DePIN (Redes de Infraestructura Física Descentralizada)**, **Solvers de Liquidación Basados en Intenciones (ERC-7683)**, **Passkeys / Biometría WebAuthn (NIST P-256)** y **Pruebas Web zk-TLS (TLSNotary)**.

---

## Resumen Arquitectónico

```
                               ┌────────────────────────────────────────────────┐
                               │       ECOSISTEMA CRIPTO DE VANGUARDIA          │
                               └──────────────────────┬─────────────────────────┘
                                                      │
         ┌───────────────────┬────────────────────────┴───────────────┬───────────────────┐
         ▼                   ▼                                        ▼                   ▼
  ┌──────────────┐    ┌──────────────┐                         ┌──────────────┐    ┌──────────────┐
  │ DePIN MQTTS  │    │ DePIN REST   │                         │  ERC-7683    │    │ WebAuthn     │
  │ (Marcapasos) │    │(Cadena Frío) │                         │Solver Intent │    │ Passkeys     │
  │ Firma Ed25519│    │ HMAC-SHA256  │                         │Empareje CoW  │    │ NIST P-256   │
  └──────┬───────┘    └──────┬───────┘                         └──────┬───────┘    └──────┬───────┘
         │                   │                                        │                   │
         └─────────────┬─────┴────────────────────────────────────────┴───────────────────┘
                       │
                       ▼
       ┌─────────────────────────────────┐
       │   HEDERA CONSENSUS SERVICE      │
       │   • Finalidad < 2 segundos      │
       │   • Tarifa Fija de $0.0001 USD  │
       │   • Transferencias Atómicas     │
       └─────────────────────────────────┘
```

---

## Directorio de Laboratorios

| Lab | Nombre | Enfoque | Estándar de la Industria |
| :--- | :--- | :--- | :--- |
| **01** | `01_depin_mqtts_pacemaker_telemetry.js` | Telemetría Médica IoT de Misión Crítica | MQTTS, Firma Hardware Ed25519, Lotes Merkle |
| **02** | `02_depin_lightweight_cold_chain_api_key.js` | Logística de Vacunas y Cadena de Frío | HTTP REST, API Key, HMAC-SHA256, Penalización SLA |
| **03** | `03_intent_based_defi_solver.js` | Liquidación Resistente a MEV entre Activos | ERC-7683, Coincidencia de Deseos (CoW), Multi-Pata Atómica |
| **04** | `04_passkeys_webauthn_p256_authenticator.js` | Autenticación Biométrica de Hardware Sin Semilla | W3C WebAuthn, FIDO2, NIST P-256 (secp256r1) |
| **05** | `05_zktls_cryptographic_web_proofs.js` | Atestación Web2 de Conocimiento Cero | TLSNotary, Reclaim Protocol, Compromisos de Cegado |

---

## Puntos Clave de Aprendizaje

1. **Agrupamiento en el Borde (DePIN Edge Batching):** Nunca envíes cada lectura de sensor de alta frecuencia directamente a la cadena. Agrupa cuadros rutinarios en Raíces Merkle en HCS ($0.0001 USD) y reserva envíos inmediatos de consenso para anomalías críticas y alertas de emergencia.
2. **Seguridad de Bajo Consumo:** Los dispositivos limitados ahorran batería utilizando encabezados HTTP + HMAC-SHA256 sin pesados handshakes TLS, garantizando cadenas de custodia a prueba de manipulaciones.
3. **Solvers de Intenciones y CoW:** Los usuarios firman declaraciones fuera de cadena sin gas ni deslizamiento. Los solvers emparejan órdenes opuestas directamente y liquidan atómicamente mediante la `TransferTransaction` multi-pata de Hedera.
4. **Passkeys frente a Frases Semilla:** W3C WebAuthn vincula las firmas biométricas a orígenes y RP IDs específicos, eliminando las vulnerabilidades de las frases de recuperación.
5. **Privacidad zk-TLS:** Nunca expongas extractos bancarios confidenciales ni PII en libros mayores públicos; ancla hashes de compromiso de conocimiento cero y firmas notarias en HCS.

---

## Referencias

- [Documentación de Hedera Consensus Service](https://docs.hedera.com/hedera/services/consensus-service)
- [Especificación W3C Web Authentication (WebAuthn)](https://www.w3.org/TR/webauthn-3/)
- [Estándar de Intenciones Entre Cadenas ERC-7683](https://eips.ethereum.org/EIPS/eip-7683)
- [Especificación del Protocolo TLSNotary](https://tlsnotary.org/)
- [Documentación del Protocolo Reclaim](https://docs.reclaimprotocol.org/)
- [RFC 2104: Hashing con Clave para Autenticación de Mensajes (HMAC)](https://datatracker.ietf.org/doc/html/rfc2104)
