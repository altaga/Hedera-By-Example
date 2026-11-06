# Module 10: Agentic Micropayments (x402 Protocol)
## Machine-to-Machine Autonomous Commerce on Hedera

> [!IMPORTANT]
> **OBJECTIVE:** Transform autonomous AI agents from mere analytical reasoning tools into economically sovereign entities capable of discovering, pricing, and settling on-chain micropayments per request via the HTTP 402 standard on Hedera.

---

## Module Map

In this module, we close the missing link between artificial intelligence and decentralized finance: autonomous micro-settlement without human intervention, credit cards, or API subscription paywalls. Labs 01–03 build each step of the protocol by hand; Labs 04–08 reuse those steps (`M99_Utilities/x402.js`) to build complete scenarios.

| Lab | Topic | Description | Operational Architecture |
| :--- | :--- | :--- | :--- |
| **01** | **Server 402 Challenge** | A protected resource answers HTTP 402 with a `PAYMENT-REQUIRED` header: amount, asset, payTo and fee payer. | Foundation |
| **02** | **Agent Payment Signature** | The agent builds the real `TransferTransaction`, with the facilitator's account in the transaction id, and signs it without submitting it. | Sponsored Facilitator |
| **03** | **Facilitator Settlement** | The facilitator verifies the signed transfer, co-signs as fee payer and settles on Hedera; a replay fails with `DUPLICATE_TRANSACTION`. | Sponsored Facilitator |
| **04** | **HTS USDC Micropayments** | Settling a $0.025 prompt in a 6-decimal HTS stablecoin, with the economic benchmark against card rails. | HTS Token Engine |
| **05** | **Financial Guardrails** | A deterministic policy engine (ceilings, budget, merchant allowlist) that refuses before signing, with an HCS audit log. | Risk Governance |
| **06** | **Autonomous Market Agent** | Free 402 quotes from three providers, a price-performance score, one payment to the winner. | Autonomous Agent Loop |
| **07** | **Live AI Streaming Gateway** | Server-Sent Events inference that opens only after the x402 payment settles on Hedera. | Real-Time Proxy |
| **08** | **Two-Party Settlement** | The merchant is its own facilitator: it verifies, co-signs, pays the fee and audits on the Mirror Node. | Merchant as Facilitator (2 Actors) |

---

## Dual Architectural Topologies

On Hedera, the x402 `exact` scheme always works the same way for the buyer: it signs a `TransferTransaction` whose transaction id belongs to the fee payer (`extra.feePayer`) and never submits it. What changes is **who** plays the facilitator.

### Architecture 1: Sponsored Facilitator Pattern (3 Actors: Buyer + Seller + Facilitator)

Ideal for gasless AI agents, web frontends or microservices that do not hold HBAR for gas (Labs 01–07):

```mermaid
%{init: {
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
}}%
sequenceDiagram
    autonumber
    actor Agent as AI Agent (Buyer)
    participant Server as API Server (Seller)
    participant Facilitator as x402 Facilitator
    participant Hedera as ℏ Hedera Hashgraph

    Agent->>Server: GET /api/v1/alpha-intelligence (No Auth)
    Server-->>Agent: HTTP 402 + PAYMENT-REQUIRED (amount, asset, payTo, feePayer)
    Note over Agent: Checks its budget policy<br/>Signs a TransferTransaction (tx id = feePayer)<br/>Does not submit it
    Agent->>Server: GET /api/v1/alpha-intelligence + PAYMENT-SIGNATURE
    Server->>Facilitator: Verify and settle
    Note over Facilitator: Fee payer, expiry, amount, payee, agent signature
    Facilitator->>Hedera: Co-signs as fee payer and submits
    Hedera-->>Facilitator: Consensus finality (seconds, transaction id)
    Server-->>Agent: HTTP 200 OK + PAYMENT-RESPONSE (transaction id) + data
```

### Architecture 2: Merchant as Facilitator (2 Actors: Buyer + Seller)

No third-party infrastructure: the seller verifies, co-signs and pays the fee itself (Lab 08). The buyer's side does not change:

```mermaid
%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#ffffff',
    'primaryTextColor': '#000000',
    'primaryBorderColor': '#000000',
    'lineColor': '#000000',
    'secondaryColor': '#0066cc',
    'tertiaryColor': '#ffffff',
    'mainBkg': '#ffffff',
    'nodeBorder': '#000000',
    'clusterBkg': '#F9F9F6',
    'clusterBorder': '#000000',
    'fontSize': '14px',
    'fontFamily': 'Inter, system-ui, -apple-system, sans-serif',
    'nodeRadius': '0px'
  }
}}%
sequenceDiagram
    autonumber
    actor Agent as AI Agent (Buyer)
    participant Server as API Server (Seller + Facilitator)
    participant Hedera as ℏ Hedera Hashgraph

    Agent->>Server: GET /api/v1/derivatives-matrix (No Auth)
    Server-->>Agent: HTTP 402 + PAYMENT-REQUIRED (payTo = feePayer = seller)
    Note over Agent: Signs the transfer, exactly as with Architecture 1
    Agent->>Server: GET /api/v1/derivatives-matrix + PAYMENT-SIGNATURE
    Note over Server: Verifies, co-signs with its own key
    Server->>Hedera: Submits, paying the fee from the price it receives
    Hedera-->>Server: Consensus finality (transaction id)
    Note over Server: Audits the settlement on the Mirror Node
    Server-->>Agent: HTTP 200 OK + PAYMENT-RESPONSE + resource
```

---

## Architectural Comparison: When to Use Which?

| Architectural Dimension | Merchant as Facilitator (Buyer + Seller) | Sponsored Facilitator (Buyer + Seller + Facilitator) |
| :--- | :--- | :--- |
| **Actor Model** | 2 Actors | 3 Actors (Buyer, Seller, Facilitator) |
| **Network Fee** | Paid by the seller, out of the price it receives | Paid by the facilitator |
| **Buyer Balance Requirements** | Only the payment asset (no HBAR for gas) | Only the payment asset (no HBAR for gas) |
| **Intermediary Dependency** | **None**: the seller runs everything | Requires an online facilitator (hosted or your own) |
| **Anti-Replay Mechanism** | Hedera transaction id: executes once, valid 120 s | Hedera transaction id: executes once, valid 120 s |
| **Best Used For** | Sellers that already run infrastructure and hold HBAR | Sellers that prefer not to hold a funded signing key |

## Key Concepts

### 1. The three headers
`PAYMENT-REQUIRED` (402 terms), `PAYMENT-SIGNATURE` (the signed transfer) and `PAYMENT-RESPONSE` (the settlement receipt) all carry JSON encoded as Base64, version `x402Version: 2`.

### 2. Gasless for the buyer
The transaction id decides who pays the network fee. Because it belongs to the facilitator, the buyer only needs the price, in HBAR (`0.0.0`) or an HTS token.

### 3. Replay protection is native
A Hedera transaction id can execute only once and expires 120 seconds after signing. A replayed payment fails with `DUPLICATE_TRANSACTION`; no nonce registry is needed.

## Before You Run

Labs 01–03 are a chain (each reads what the previous one saved in `state.json`): run them in order, and Lab 03 within two minutes of Lab 02 (if the signed payment expired, the agent signs it again). Every lab uses your testnet account plus the practice wallets `ACCOUNT_1` (agent) and `ACCOUNT_2` (merchant); in the course website they run in the browser.

---

## Official References
- [x402 on Hedera Documentation](https://docs.hedera.com/solutions/ai/x402)
- [How x402 Works (Architecture Spec)](https://docs.hedera.com/solutions/ai/x402/how-it-works)
- [x402 Facilitators on Hedera](https://docs.hedera.com/solutions/ai/x402/facilitators)
- [x402 Foundation Protocol Repository](https://github.com/x402-foundation/x402)
- [Hedera Exact Payment Scheme Specification](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md)
- [Hedera Agent Kit](https://github.com/hedera-dev/hedera-agent-kit)

---

 2026 **HEDERA FOR DUMMIES**. CODE IS CURRENCY. SETTLEMENT IS INSTANT.
