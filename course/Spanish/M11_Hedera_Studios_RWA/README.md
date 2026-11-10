# Módulo 11: Activos del mundo real (Hedera Studios)
## Tokenización Institucional, Cumplimiento ERC-3643 y Gobernanza de Stablecoins

> [!IMPORTANT]
> **OBJETIVO:** Diseñar infraestructuras de grado institucional para Activos del Mundo Real (RWA) y stablecoins respaldadas por fiat en Hedera, aprovechando los estándares de Asset Tokenization Studio (ATS) y Stablecoin Studio.

---

## Mapa del Módulo

En este módulo dejamos atrás los coleccionables digitales básicos para entrar a los mercados de capitales institucionales: acciones reguladas, bonos tokenizados con cronogramas automáticos de cupones y stablecoins preparadas para cumplimiento normativo con Proof-of-Reserve (PoR).

| Lab | Tema | Descripción |
| :--- | :--- | :--- |
| **01** | **Transferencias RWA Permisionadas (Conceptos ERC-3643)** | Registro de identidad más claves KYC de HTS: la propia red rechaza transferencias a inversores no aprobados. |
| **02** | **Bonos por Tramos en HTS (Conceptos ERC-1400)** | Tokens de tramo senior y mezzanine, snapshot de tenedores en Mirror Node y un pago atómico de cupones en HBAR. |
| **03** | **Roles de Stablecoin en HTS** | Claves separadas de Cash-In, Freeze, Wipe y KYC aplicadas por la red (conceptos de Stablecoin Studio, HTS nativo). |
| **04** | **Oráculo Proof-of-Reserve** | Verificación de colateral fuera de cadena y activación de disyuntores de emisión automática. |
| **05** | **Factoraje de Facturas RWA** | Cuentas de PyME, inversor y deudor liquidan anticipo y vencimiento como entrega contra pago atómica. |
| **06** | **Pool Tokens Multi-Activo** | Agrupación atómica de Fondos Monetarios, Bonos y REITs en un solo token de canasta atómica (activos de demostración). |
| **07** | **Puente de Integración ERP Institucional** | Parseo de facturas electrónicas XML, anclaje legal en HCS y emisión de deuda fraccionada en HTS. |
| **08** | **Acciones Corporativas y Pagos Masivos (Conceptos ATS)** | Token HTS real, instantánea de cap table en Mirror Node, dividendo prorrateado con retención en una transferencia atómica y certificado de auditoría en HCS. |

---

## Ciclo de Vida del Activo Institucional (ERC-3643 / ATS)

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
flowchart TD
    subgraph ISSUER_GOVERNANCE [GOBERNANZA DEL EMISOR Y COMPLIANCE]
        ATS[<b>ASSET TOKENIZATION STUDIO</b><br/>Reglas de Emisión y Tramos]
        IDR[<b>REGISTRO DE IDENTIDAD (ERC-3643)</b><br/>Clave KYC de HTS y Lista Blanca de Países]
    end

    subgraph TRANSFER_VALIDATION [FILTRO DE RESTRICCIÓN DE TRANSFERENCIA]
        CHECK{¿Inversor con KYC y<br/>sin Sanciones?}
    end

    subgraph HEDERA_SETTLEMENT [LIQUIDACIÓN POR CONSENSO]
        HTS[<b>HEDERA TOKEN SERVICE</b><br/>Ejecución Nativa del Activo]
        AUDIT[<b>TRAZA DE AUDITORÍA HCS</b><br/>Registro Inmutable de Cumplimiento]
    end

    ATS --> IDR
    IDR --> CHECK
    CHECK -- "APROBADO" --> HTS
    HTS --> AUDIT
    CHECK -- "RECHAZADO (NO ACREDITADO)" --> REVERT[REVERTIR CON COMPLIANCE_ERROR]

    classDef default fill:#ffffff,stroke:#000000,stroke-width:2px;
    classDef accent fill:#FF4500,stroke:#000000,stroke-width:2px,color:#ffffff;
    class CHECK accent;
```

---

## Conceptos Clave

### 1. Por qué ERC-20 Falla para RWAs Institucionales
Los tokens ERC-20 convencionales son permisionados por defecto: cualquiera puede transferirlos a cualquier dirección. Las normativas de valores (SEC, MiCA, FINMA) exigen que las acciones, bienes raíces o instrumentos de deuda solo puedan estar en manos de inversores acreditados, verificados por KYC y en países autorizados. El estándar **ERC-3643** logra esto condicionando cada transferencia a un Registro de Identidad.

### 2. Tramos y Particiones (ERC-1400)
Una sola corporación puede emitir acciones comunes, acciones preferentes y bonos convertibles. En lugar de desplegar contratos separados con liquidez fragmentada, ERC-1400 particiona los tokens en tramos discretos con distintos derechos de voto, dividendos y restricciones de transferencia.

### 3. Segregación de Funciones en Stablecoin Studio
Dinero descentralizado no debe significar dinero desregulado cuando está respaldado por reservas fiduciarias. Stablecoin Studio impone separación criptográfica de poderes:
- **Rol Cash-In:** Solo puede acuñar tras confirmación de depósito bancario.
- **Rol Burn:** Quema tokens al procesar reembolsos fiat.
- **Rol Wipe:** Incauta tokens en cumplimiento de resoluciones judiciales.
- **Rol Freeze:** Congela billeteras sospechosas detectadas por filtros de AML.

### 4. Disyuntores de Proof-of-Reserve (PoR)
Para evitar catástrofes de desanclaje estilo Terra/Luna, las stablecoins en Hedera utilizan oráculos de auditoría independientes (como Chainlink PoR) para transmitir los balances bancarios verificados directamente on-chain. Si las reservas caen por debajo del 100%, la emisión se bloquea de forma automática.

---

## Antes de Ejecutar

Cada lab corre desde la web del curso o con `node`. Tu cuenta de testnet firma y paga las comisiones; algunos labs usan además las wallets de práctica `ACCOUNT_1` y `ACCOUNT_2` (créalas en el panel Wallets de la web, o defínelas en `.env`). Un lab con algo en **Ejecuta antes** lee lo que ese lab anterior guardó en `state.json`, así que córrelos en ese orden.

| Lab | Ejecuta antes | Wallets de práctica | Costo |
| :--- | :--- | :--- | :--- |
| **01** | — | — | ~16 ℏ (crear el token ~15 ℏ en testnet) + ~0.3 ℏ para cuentas desechables + comisiones |
| **02** | — | — | ~18 ℏ (crear el token ~15 ℏ en testnet) + ~0.3 ℏ para cuentas desechables + comisiones |
| **03** | — | — | ~17 ℏ (crear el token ~15 ℏ en testnet) + 0.05 ℏ para el titular + comisiones |
| **04** | — | — | ~15 ℏ la primera vez (crea un token, cerca de 1 USD); <0.1 ℏ al volver a ejecutarlo (reutiliza lo que creó) |
| **05** | — | — | ~18 ℏ (el operador paga la creación del token, ~15 ℏ) + ~0.7 ℏ para cuentas desechables + comisiones |
| **06** | — | — | ~60 ℏ la primera vez (4 tokens a ~15 ℏ cada uno en testnet); ~3 ℏ cuando los reutiliza |
| **07** | — | Sí | ~15 ℏ en cada ejecución (crea un token, cerca de 1 USD) |
| **08** | — | — | ~16 ℏ (crear el token ~15 ℏ en testnet) + ~0.1 ℏ para titulares + comisiones |

---

## Referencias Oficiales
- [Hedera Asset Tokenization Studio (ATS)](https://docs.hedera.com/solutions/tokenization/ats)
- [Repositorio GitHub de ATS](https://github.com/hashgraph/asset-tokenization-studio)
- [Hedera Stablecoin Studio](https://docs.hedera.com/solutions/tokenization/stablecoin)
- [Repositorio GitHub de Stablecoin Studio](https://github.com/hashgraph/stablecoin-studio)
- [Especificación del Estándar ERC-3643](https://erc3643.org/)

---

 2026 **HEDERA PARA DUMMIES**. LIQUIDEZ REGULADA. CERO FRICCIÓN. SIN COMPROMISOS.
