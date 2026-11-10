# Módulo 8: Contratos inteligentes y EVM
## Compatibilidad con Ethereum y Poder de Hedera

> [!IMPORTANT]
> **OBJETIVO:** Desplegar y gestionar contratos inteligentes en Solidity, aprovechando la compatibilidad total con la EVM y la capacidad única de Hedera para interactuar con servicios nativos (HTS/HCS) mediante System Contracts.

---

## Mapa del Módulo

| Lab | Tema | Descripción |
| :--- | :--- | :--- |
| **01** | **Despliegue de Contratos** | Uso del SDK para subir bytecode a la red. |
| **02** | **Entorno Híbrido** | Interacción entre la EVM y las cuentas nativas de Hedera. |
| **03** | **Cambios Estructurales** | Entendiendo las diferencias de gas y almacenamiento en la EVM de Hedera. |
| **04** | **System Contracts (HIP-206)**| Llamadas desde Solidity a servicios nativos de tokens (HTS). |
| **05** | **Protocolos de Autorización**| Manejo de `allowance` y permisos en un entorno descentralizado. |
| **06** | **Interacción USDC (ERC-20)**| Uso de stablecoins estándar dentro de la EVM. |
| **07** | **Asociación USDC** | Automatización de la asociación de tokens desde el contrato. |
| **08** | **Precompilados HTS Avanzados** | Emisión, quema y transferencia de tokens HTS desde Solidity (0x167). |
| **09** | **Fondo de Privacidad Zero-Knowledge** | Circuito Groth16 real (circom + snarkjs), árbol Merkle Poseidon y verificador on-chain: depósito, retiro privado y rechazo de pruebas falsas y doble gasto. |
| **10** | **Contratos del Sistema (0x168 y 0x16a)** | Precompilación nativa de oráculo de tasa de cambio (0x168) y autorización de firmas HAS (0x16a). |
| **11** | **Cron Autónomo en Solidity (0x16b)** | Contratos inteligentes que se autoprograman llamando a la precompilación HSS 0x16b sin keepers externos. |

---

## System Contracts (El Puente Maestro)

Los System Contracts permiten que un contrato de Solidity "hable" con los servicios nativos de Hedera, combinando la flexibilidad de la EVM con la velocidad de HTS.

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#ffffff',
    'primaryTextColor': '#000000',
    'primaryBorderColor': '#000000',
    'lineColor': '#000000',
    'secondaryColor': '#FF4500',
    'tertiaryColor': '#ffffff',
    'mainBkg': '#ffffff',
    'nodeBorder': '#000000',
    'clusterBkg': '#F9F9F6',
    'clusterBorder': '#000000',
    'fontSize': '14px',
    'fontFamily': 'Inter, system-ui, -apple-system, sans-serif',
    'nodeRadius': '0px'
  }
}}%%
graph LR
    SC[SMART CONTRACT SOLIDITY] -->|1. LLAMAR A HIP-206| SY[SYSTEM CONTRACT]
    SY -->|2. EJECUTAR OPERACIÓN| HTS[HEDERA TOKEN SERVICE]
    HTS -->|3. RESULTADO| SY
    SY -->|4. RETORNAR DATOS| SC
    
    %% Styling
    classDef default fill:#ffffff,stroke:#000000,stroke-width:2px;
    classDef accent fill:#FF4500,stroke:#000000,stroke-width:2px,color:#ffffff;
    
    class SY accent;
    class HTS accent;
```

---

## Conceptos Clave

### 1. Compatibilidad Total con EVM
Hedera soporta las mismas herramientas que Ethereum (Hardhat, Foundry, Remix, Ethers.js). Puedes migrar tus dApps de Ethereum a Hedera con cambios mínimos y disfrutar de tarifas fijas en dólares.

### 2. System Contracts (HIP-206)
A diferencia de otras redes donde los tokens son contratos pesados, en Hedera los tokens son nativos. Los System Contracts actúan como una API de Solidity para realizar transferencias, acuñaciones y quemas de tokens HTS a alta velocidad.

### 3. Gas Fijo en USD
En Hedera, el precio del gas no fluctúa con la demanda de la red. El costo de ejecución está anclado al dólar estadounidense, lo que permite a las empresas predecir sus costos operativos con exactitud.

---

## Antes de Ejecutar

Cada lab corre desde la web del curso o con `node`. Tu cuenta de testnet firma y paga las comisiones; algunos labs usan además las wallets de práctica `ACCOUNT_1` y `ACCOUNT_2` (créalas en el panel Wallets de la web, o defínelas en `.env`). Un lab con algo en **Ejecuta antes** lee lo que ese lab anterior guardó en `state.json`, así que córrelos en ese orden.

| Lab | Ejecuta antes | Wallets de práctica | Costo |
| :--- | :--- | :--- | :--- |
| **01** | — | — | ~15 ℏ la primera vez (crea un contrato, cerca de 1 USD); ~3 ℏ al volver a ejecutarlo (reutiliza lo que creó) |
| **02** | Lab 01 de M8 | — | <0.1 ℏ (solo comisiones de red) |
| **03** | Lab 01 de M8 | — | <1 ℏ (solo comisiones de red) |
| **04** | Lab 01 de M3 | — | ~15 ℏ la primera vez (crea un contrato, cerca de 1 USD); <1 ℏ al volver a ejecutarlo (reutiliza lo que creó) |
| **05** | Lab 01 de M8 | — | <1 ℏ (solo comisiones de red) |
| **06** | — | Sí | ~2 ℏ (solo comisiones de red) |
| **07** | — | — | <1 ℏ (solo comisiones de red) |
| **08** | — | — | ~30 ℏ la primera vez (crea un token y un contrato, cerca de 2 USD); <0.1 ℏ al volver a ejecutarlo (reutiliza lo que creó) |
| **09** | — | — | ~50-60 ℏ la primera vez (3 despliegues: ~15 ℏ de creación + ~6 ℏ por cada bloque de 4 KB de bytecode, más 2 ℏ a un depositante); ~3 ℏ cuando se reutilizan. Un reintento de gas vuelve a subir el bytecode, por eso el hasher empieza con 3M de gas |
| **10** | — | — | ~15 ℏ la primera vez (crea un contrato, cerca de 1 USD); <0.1 ℏ al volver a ejecutarlo (reutiliza lo que creó) |
| **11** | — | — | ~16 ℏ la primera vez (crea un contrato, cerca de 1 USD, y le carga 1 ℏ para sus llamadas programadas); <1 ℏ al volver a ejecutarlo (reutiliza lo que creó) |

---

## Referencias Oficiales
- [Hedera Smart Contract Service (HSCS)](https://docs.hedera.com/hedera/core-concepts/smart-contracts)
- [HIP-206: HTS System Contract](https://hips.hedera.com/hip/hip-206)
- [Besu EVM on Hedera](https://hedera.com/blog/hedera-evm-the-best-of-both-worlds)

---

 2026 **HEDERA PARA DUMMIES**. EL CEREBRO DE LA RED.
