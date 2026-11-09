# Module 11: Hedera Studios & Real-World Assets (RWA)
## Institutional Tokenization, ERC-3643 Compliance, and Stablecoin Governance

> [!IMPORTANT]
> **OBJECTIVE:** Architect institutional-grade Real-World Asset (RWA) pipelines and compliant fiat-backed stablecoins on Hedera, leveraging the Asset Tokenization Studio (ATS) and Stablecoin Studio standards.

---

## Module Map

In this module, we transition from toy digital collectibles to institutional capital markets: compliant equity, tokenized bonds with automated coupon schedules, and regulatory-ready stablecoins with Proof-of-Reserve (PoR).

| Lab | Topic | Description |
| :--- | :--- | :--- |
| **01** | **Permissioned RWA Transfers (ERC-3643 Concepts)** | Identity-registry checks plus HTS KYC keys: the network itself rejects transfers to non-approved investors. |
| **02** | **Tranche Bonds on HTS (ERC-1400 Concepts)** | Senior and mezzanine tranche tokens, Mirror Node holder snapshot and one atomic HBAR coupon payout. |
| **03** | **Stablecoin Roles on HTS** | Separate Cash-In, Freeze, Wipe and KYC keys enforced by the network (Stablecoin Studio concepts, native HTS). |
| **04** | **Proof-of-Reserve Oracle** | Verifying off-chain collateral and activating automated minting circuit breakers. |
| **05** | **RWA Invoice Factoring** | SME, investor and debtor accounts settle advance and maturity as atomic delivery-versus-payment. |
| **06** | **Multi-Asset Pool Tokens** | Bundling Treasury MMFs, Corporate Bonds, and REITs into one atomic basket token (demo assets). |
| **07** | **Institutional ERP Integration Bridge** | Electronic invoice XML parsing, HCS legal timestamp anchoring, and compliant fractional HTS debt minting. |
| **08** | **Corporate Actions & Mass Payout (ATS Concepts)** | Real HTS share token, Mirror Node cap-table snapshot, pro-rata dividend with withholding in one atomic transfer, HCS audit certificate. |

---

## Institutional Asset Lifecycle (ERC-3643 / ATS)

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
    subgraph ISSUER_GOVERNANCE [ASSET ISSUER & COMPLIANCE]
        ATS[<b>ASSET TOKENIZATION STUDIO</b><br/>Asset Rules & Tranches]
        IDR[<b>IDENTITY REGISTRY (ERC-3643)</b><br/>HTS KYC key & Country Allowlist]
    end

    subgraph TRANSFER_VALIDATION [TRANSFER RESTRICTION GATE]
        CHECK{Investor KYC &<br/>Sanctions Clear?}
    end

    subgraph HEDERA_SETTLEMENT [CONSENSUS SETTLEMENT]
        HTS[<b>HEDERA TOKEN SERVICE</b><br/>Native Asset Execution]
        AUDIT[<b>HCS AUDIT TRAIL</b><br/>Tamper-Proof Compliance Log]
    end

    ATS --> IDR
    IDR --> CHECK
    CHECK -- "APPROVED" --> HTS
    HTS --> AUDIT
    CHECK -- "REJECTED (UNACCREDITED)" --> REVERT[REVERT WITH COMPLIANCE_ERROR]

    classDef default fill:#ffffff,stroke:#000000,stroke-width:2px;
    classDef accent fill:#FF4500,stroke:#000000,stroke-width:2px,color:#ffffff;
    class CHECK accent;
```

---

## Key Concepts

### 1. Why Vanilla ERC-20 Fails for Institutional RWAs
Standard ERC-20 tokens are permissionless: anyone can transfer to any address. Securities regulations (SEC, MiCA, FINMA) require that tokenized equities, real estate, and debt instruments can **only** be held by accredited, KYC-verified investors in approved jurisdictions. The **ERC-3643** standard enforces this by gating every transfer through an Identity Registry.

### 2. Tranches and Partitions (ERC-1400)
A single company may issue common stock, preferred shares, and convertible bonds. Instead of deploying separate contracts with fragmented liquidity, ERC-1400 partitions tokens into discrete tranches with differing rights, dividend schedules, and transfer restrictions.

### 3. Segregation of Duties in Stablecoin Studio
Decentralized money cannot mean unaccountable money when backed by fiat reserves. Stablecoin Studio enforces cryptographic separation of powers:
- **Cash-In Role:** Can only mint when bank wire confirms fiat deposit.
- **Burn Role:** Retires tokens upon fiat redemption.
- **Wipe Role:** Can forfeit tokens pursuant to legal court judgments.
- **Freeze Role:** Freezes suspicious wallets flagged by AML screeners.

### 4. Proof-of-Reserve (PoR) Circuit Breakers
To avoid Terra/Luna style de-pegging catastrophes, fiat-backed stablecoins on Hedera use Chainlink or independent audit oracles to stream verified bank reserve balances directly on-chain. If reserves drop below 100%, minting is automatically halted.

---

## Before You Run

Every lab runs from the course web page or with `node`. Your testnet account signs and pays fees; some labs also use the practice wallets `ACCOUNT_1` and `ACCOUNT_2` (create them in the web Wallets panel, or set them in `.env`). A lab with an entry under **Run first** reads what that earlier lab saved in `state.json`, so run them in that order.

| Lab | Run first | Practice wallets | Cost |
| :--- | :--- | :--- | :--- |
| **01** | — | — | ~16 ℏ (token creation ~15 ℏ on testnet) + ~0.3 ℏ funded to throwaway accounts + fees |
| **02** | — | — | ~18 ℏ (token creation ~15 ℏ on testnet) + ~0.3 ℏ to throwaway accounts + fees |
| **03** | — | — | ~17 ℏ (token creation ~15 ℏ on testnet) + 0.05 ℏ for the holder + fees |
| **04** | — | — | ~15 ℏ (network fees only) |
| **05** | — | — | ~18 ℏ (the operator pays the ~15 ℏ token creation) + ~0.7 ℏ to throwaway accounts + fees |
| **06** | — | — | ~60 ℏ the first time (4 tokens at ~15 ℏ each on testnet); ~3 ℏ when it reuses them |
| **07** | — | Yes | ~15 ℏ each run (it creates a token, about 1 USD) |
| **08** | — | — | ~16 ℏ (token creation ~15 ℏ on testnet) + ~0.1 ℏ to holders + fees |

---

## Official References
- [Hedera Asset Tokenization Studio (ATS)](https://docs.hedera.com/solutions/tokenization/ats)
- [ATS GitHub Repository](https://github.com/hashgraph/asset-tokenization-studio)
- [Hedera Stablecoin Studio](https://docs.hedera.com/solutions/tokenization/stablecoin)
- [Stablecoin Studio GitHub Repository](https://github.com/hashgraph/stablecoin-studio)
- [ERC-3643 Standard Specification](https://erc3643.org/)

---

 2026 **HEDERA FOR DUMMIES**. REGULATED LIQUIDITY. ZERO FRICTION. NO COMPROMISE.
