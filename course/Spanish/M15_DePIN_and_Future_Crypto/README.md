# Módulo 15: DePIN y Arquitecturas Cripto de Frontera
## Dispositivos de Borde, Intenciones Firmadas, Passkeys y Pruebas Privadas en Hedera

Bienvenido al **Módulo 15**. Este módulo explora arquitecturas Web3 de vanguardia integradas de forma nativa con Hedera: **DePIN (Redes de Infraestructura Física Descentralizada)**, **Solvers de Liquidación Basados en Intenciones (ERC-7683)**, **Passkeys / Biometría WebAuthn (NIST P-256)** y **Pruebas Web zk-TLS (TLSNotary)**.

> [!IMPORTANT]
> **OBJETIVO:** Conectar dispositivos físicos, intenciones firmadas, passkeys biométricas y datos privados de Web2 con Hedera, dejando en el ledger solo lo que debe ser público y probando el resto con firmas, raíces Merkle y compromisos.

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

## Mapa del Módulo

| Lab | Nombre | Enfoque | Estándar de la Industria |
| :--- | :--- | :--- | :--- |
| **01** | **Telemetría MQTTS de Marcapasos** | Telemetría Médica IoT de Misión Crítica | MQTTS, Firma Hardware Ed25519, Lotes Merkle |
| **02** | **Telemetría REST de Cadena de Frío** | Logística de Vacunas y Cadena de Frío | HTTP REST, API Key, HMAC-SHA256, Penalización SLA |
| **03** | **Solver DeFi por Intenciones** | Liquidación Resistente a MEV entre Activos | ERC-7683, Coincidencia de Deseos (CoW), Multi-Pata Atómica |
| **04** | **Passkeys (WebAuthn P-256)** | Autenticación Biométrica de Hardware Sin Semilla | W3C WebAuthn, FIDO2, NIST P-256 (secp256r1) |
| **05** | **Pruebas Web zk-TLS** | Atestación Web2 de Conocimiento Cero | TLSNotary, Reclaim Protocol, Compromisos de Cegado |

---

## Conceptos Clave

1. **Agrupamiento en el Borde (DePIN Edge Batching):** Nunca envíes cada lectura de sensor de alta frecuencia directamente a la cadena. Agrupa cuadros rutinarios en Raíces Merkle en HCS ($0.0001 USD) y reserva envíos inmediatos de consenso para anomalías críticas y alertas de emergencia.
2. **Seguridad de Bajo Consumo:** Los dispositivos limitados ahorran batería utilizando encabezados HTTP + HMAC-SHA256 sin pesados handshakes TLS, garantizando cadenas de custodia a prueba de manipulaciones.
3. **Solvers de Intenciones y CoW:** Los usuarios firman declaraciones fuera de cadena sin gas ni deslizamiento. Los solvers emparejan órdenes opuestas directamente y liquidan atómicamente mediante la `TransferTransaction` multi-pata de Hedera.
4. **Passkeys frente a Frases Semilla:** W3C WebAuthn vincula las firmas biométricas a orígenes y RP IDs específicos, eliminando las vulnerabilidades de las frases de recuperación.
5. **Privacidad zk-TLS:** Nunca expongas extractos bancarios confidenciales ni PII en libros mayores públicos; ancla hashes de compromiso de conocimiento cero y firmas notarias en HCS.

---

## Antes de Ejecutar

Cada lab corre desde la web del curso o con `node`. Tu cuenta de testnet firma y paga las comisiones; algunos labs usan además las wallets de práctica `ACCOUNT_1` y `ACCOUNT_2` (créalas en el panel Wallets de la web, o defínelas en `.env`). Un lab con algo en **Ejecuta antes** lee lo que ese lab anterior guardó en `state.json`, así que córrelos en ese orden.

| Lab | Ejecuta antes | Wallets de práctica | Costo |
| :--- | :--- | :--- | :--- |
| **01** | — | — | <0.1 ℏ (solo comisiones de red) |
| **02** | — | — | <1 ℏ (solo comisiones de red) |
| **03** | — | Sí | <1 ℏ (solo comisiones de red) |
| **04** | — | Sí | <1 ℏ (solo comisiones de red) |
| **05** | — | — | <0.1 ℏ (solo comisiones de red) |

---

## Referencias Oficiales

- [Documentación de Hedera Consensus Service](https://docs.hedera.com/native/consensus)
- [Especificación W3C Web Authentication (WebAuthn)](https://www.w3.org/TR/webauthn-3/)
- [Estándar de Intenciones Entre Cadenas ERC-7683](https://eips.ethereum.org/EIPS/eip-7683)
- [Especificación del Protocolo TLSNotary](https://tlsnotary.org/)
- [Documentación del Protocolo Reclaim](https://docs.reclaimprotocol.org/)
- [RFC 2104: Hashing con Clave para Autenticación de Mensajes (HMAC)](https://datatracker.ietf.org/doc/html/rfc2104)
