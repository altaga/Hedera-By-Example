# Módulo 11: Hedera Studios y Activos del Mundo Real (RWA)
## Tokenización Institucional, Cumplimiento ERC-3643 y Gobernanza de Stablecoins

> [!IMPORTANT]
> **OBJETIVO:** Diseñar infraestructuras de grado institucional para Activos del Mundo Real (RWA) y stablecoins respaldadas por fiat en Hedera, aprovechando los estándares de Asset Tokenization Studio (ATS) y Stablecoin Studio.

---

## Mapa del Módulo

En este módulo dejamos atrás los coleccionables digitales básicos para entrar a los mercados de capitales institucionales: acciones reguladas, bonos tokenizados con cronogramas automáticos de cupones y stablecoins preparadas para cumplimiento normativo con Proof-of-Reserve (PoR).

| Lab | Tema | Descripción |
| :--- | :--- | :--- |
| **01** | **Registro de Identidad ERC-3643** | Implementación de reglas de transferencia permisionadas basadas en ONCHAINID y calificación de inversores. |
| **02** | **Bonos de Deuda ERC-1400** | Emisión de deuda corporativa con particiones por tramos y distribución on-chain de cupones. |
| **03** | **Roles en Stablecoin Studio** | Gobernanza de stablecoins institucionales con separación de roles (Cash-In, Burn, Wipe, Freeze, KYC). |
| **04** | **Oráculo Proof-of-Reserve** | Verificación de colateral fuera de cadena y activación de disyuntores de emisión automática. |
| **05** | **Factoraje de Facturas RWA** | Tokenización de cuentas por cobrar para liquidez secundaria fraccionada y liquidación de pagos. |
| **06** | **Pool Tokens Multi-Activo** | Agrupación atómica de Fondos Monetarios, Bonos y REITs en una canasta institucional estilo Archax. |
| **07** | **Puente de Integración ERP Institucional** | Parseo de facturas electrónicas XML, anclaje legal en HCS y emisión de deuda fraccionada en HTS. |
| **08** | **ATS Acciones Corporativas y Pagos Masivos** | Snapshots de cap table en consenso, cálculos prorrateados de dividendos/cupones y liquidación atómica por lotes. |

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
        IDR[<b>REGISTRO DE IDENTIDAD (ERC-3643)</b><br/>ONCHAINID y Lista Blanca de Países]
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

## Referencias Oficiales
- [Hedera Asset Tokenization Studio (ATS)](https://docs.hedera.com/solutions/tokenization/ats)
- [Repositorio GitHub de ATS](https://github.com/hashgraph/asset-tokenization-studio)
- [Hedera Stablecoin Studio](https://docs.hedera.com/solutions/tokenization/stablecoin)
- [Repositorio GitHub de Stablecoin Studio](https://github.com/hashgraph/stablecoin-studio)
- [Especificación del Estándar ERC-3643](https://erc3643.org/)

---

 2026 **HEDERA PARA DUMMIES**. LIQUIDEZ REGULADA. CERO FRICCIÓN. SIN COMPROMISOS.
