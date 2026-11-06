# Module 7: Governance and Automation (Cron)
## Multi-signature Control and Decentralized Orchestration

> [!IMPORTANT]
> **OBJECTIVE:** Implement advanced security models using multi-signature accounts and automate future transactions using the native scheduled transactions service.

---

## Module Map

| Lab | Topic | Description |
| :--- | :--- | :--- |
| **01** | **Multisig KeyList** | Creating accounts that require multiple signatures (Threshold Keys). |
| **02** | **Multisig Transfer** | Executing asset movements that depend on the approval of several partners. |
| **03** | **Native Cron** | Scheduling transactions for automatic execution in the future. |
| **04** | **Decoupled Orchestration** | Separating business logic from network execution. |
| **05** | **Decentralized Identity** | Creating DID documents for identity sovereignty. |
| **06** | **DID Login** | Cryptographic identity verification without passwords. |
| **07** | **Autonomous Treasury DAO** | Webhook-driven reactive multisig orchestration and layer-1 scheduled quorum execution. |
| **08** | **Timelock Governance Controller** | 48-hour timelock execution windows and emergency cryptographic veto on Hedera Schedule Service. |

---

## Multi-signature Governance (Threshold)

In Hedera, you can define that an account requires, for example, 2 out of 3 signatures to move funds. This eliminates single points of failure.

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
graph TD
    A[PARTNER 1] -->|1. SIGN| T[SCHEDULED TRANSACTION]
    B[PARTNER 2] -->|2. SIGN| T
    C[PARTNER 3] -->|OPTIONAL| T
    T -->|THRESHOLD REACHED: 2/3| H[HEDERA NETWORK]
    H -->|AUTOMATIC EXECUTION| E[TRANSFER COMPLETED]
    
    %% Styling
    classDef default fill:#ffffff,stroke:#000000,stroke-width:2px;
    classDef accent fill:#FF4500,stroke:#000000,stroke-width:2px,color:#ffffff;
    
    class T accent;
    class E accent;
```

---

## Key Concepts

### 1. Signature Thresholds (Threshold Keys)
Unlike a complex smart contract, Hedera allows you to define key lists with thresholds directly on the account. It is more secure, cheaper, and easier to audit.

### 2. Scheduled Transactions
This feature allows you to "freeze" a transaction on the network until conditions (such as necessary signatures) are met or until a specific time arrives. It is the native "Cron Job" of Web3.

### 3. DID (Decentralized Identity)
Using HCS, we can anchor identity metadata that allows users to prove who they are without relying on a centralized database like Google or Facebook.

---

## Before You Run

Every lab runs from the course web page or with `node`. Your testnet account signs and pays fees; some labs also use the practice wallets `ACCOUNT_1` and `ACCOUNT_2` (create them in the web Wallets panel, or set them in `.env`). A lab with an entry under **Run first** reads what that earlier lab saved in `state.json`, so run them in that order.

| Lab | Run first | Practice wallets | Cost |
| :--- | :--- | :--- | :--- |
| **01** | — | — | ~1 ℏ (network fees and the accounts it creates) |
| **02** | M7 Lab 01 | — | <0.1 ℏ (network fees only) |
| **03** | — | Yes | <1 ℏ (network fees only) |
| **04** | M7 Lab 03 | Yes | <0.1 ℏ (network fees only) |
| **05** | — | — | <1 ℏ (network fees only) |
| **06** | M7 Lab 05 | Yes | <0.1 ℏ (network fees only) |
| **07** | — | Yes | ~2 ℏ (network fees and the accounts it creates) |
| **08** | — | — | <0.1 ℏ (network fees only) |

---

## Official References
- [Multi-signature Accounts (Hedera Docs)](https://docs.hedera.com/hedera/core-concepts/keys-and-signatures#multi-signature-signing)
- [Scheduled Transactions Documentation](https://docs.hedera.com/hedera/sdks-and-apis/sdks/scheduled-transactions)
- [W3C Decentralized Identifiers (DID) Standard](https://www.w3.org/TR/did-core/)

---

 2026 **HEDERA FOR DUMMIES**. POWER IS SHARED.
