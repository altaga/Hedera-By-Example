# Module 9: The Agentic AI Economy
## Agent Storage, Registries, Identity and Secure Messaging over HCS

> [!IMPORTANT]
> **OBJECTIVE:** Give AI agents what they need to work together on Hedera: shared storage (HCS-1), discoverable registries (HCS-2), profiles and identities (HCS-11, HCS-14), and agent-to-agent messaging (HCS-10) that resists impersonation, replays and eavesdropping.

---

## Module Map
This module focuses on the communication and sovereignty of AI agents.

| Lab | Topic | Description |
| :--- | :--- | :--- |
| **01** | **HCS-1 File Storage** | Anchoring heavy payloads (agent configs, assets) in topics with the HCS-1 file standard. |
| **02** | **HCS-2 Topic Registries** | Turning a topic into a machine-readable directory ("yellow pages") of agent endpoints. |
| **03** | **HCS-2 Registry Discovery** | Rebuilding a local, searchable index from the registry's message stream. |
| **04** | **HCS-11 AI Profiles** | Provisioning three agents with accounts, inbound/outbound topics and HCS-11 profiles. |
| **05** | **HCS-14 Universal Agent ID** | Deterministic, offline identifiers (UAID) for the agents created in Lab 04. |
| **06** | **User-to-Agent (HCS-10)** | A person and an agent talking in real time over public HCS-10 topics. |
| **07** | **Agent-to-Agent (HCS-10)** | Two autonomous agents running a stateful ping-pong over their topics. |
| **08** | **Impersonation Attack** | Why public streams alone are unsafe: a spoofer agent injects forged messages. |
| **09** | **Secure A2A** | Zero-trust validation: signed payloads plus sequence numbers against replay. |
| **10** | **Secure A2A under Attack** | The same protocol holding up while an attacker floods forged and replayed packets. |
| **11** | **Encrypted A2A** | Private agent messages over a public ledger with hybrid RSA-OAEP + AES-GCM encryption. |

---

## Agent Handshake (HCS-10)

Before two agents exchange sensitive data, they must perform a "Handshake" to verify identities and agree on a session key.

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
    'nodeRadius': '0px',
    'actorBkg': '#ffffff',
    'actorBorder': '#000000',
    'actorTextColor': '#000000',
    'actorLineColor': '#000000',
    'noteBkgColor': '#F9F9F6',
    'noteTextColor': '#000000',
    'noteBorderColor': '#000000'
  }
}}%%
sequenceDiagram
    participant A as AGENT A
    participant H as HEDERA (HCS)
    participant B as AGENT B
    
    A->>H: 1. INITIATE HANDSHAKE (HCS-10 HELLO)
    H-->>B: 2. NOTIFY INTENT
    B->>H: 3. RESPOND WITH EPHEMERAL PUBLIC KEY
    H-->>A: 4. RECEIVE RESPONSE
    Note over A,B: DERIVED SESSION KEY (ECDH)
    A->>H: 5. FIRST ENCRYPTED MESSAGE
    H-->>B: 6. MESSAGE RECEIVED AND DECRYPTED
```

---

## Key Concepts

### 1. UAID (Universal Agent ID)
In the agentic economy, identity is the first layer of trust. The **HCS-14** standard provides a unique global identifier that persists across different networks and environments, allowing an agent to maintain its reputation.

### 2. Privacy by Design (Hybrid Encryption)
Although Hedera is a public ledger, agents can communicate privately. We use **RSA** for secure key exchange and **AES-256-GCM** for high-speed data encryption, ensuring that only the intended recipient can read the content.

### 3. Autonomous Orchestration
Unlike traditional bots, Hedera agents can make economic decisions, pay for their own resources (gas, storage), and charge for their services without human intervention.

---

## Before You Run

Every lab runs from the course web page or with `node`. Your testnet account signs and pays fees; some labs also use the practice wallets `ACCOUNT_1` and `ACCOUNT_2` (create them in the web Wallets panel, or set them in `.env`). A lab with an entry under **Run first** reads what that earlier lab saved in `state.json`, so run them in that order.

| Lab | Run first | Practice wallets | Cost |
| :--- | :--- | :--- | :--- |
| **01** | — | — | <1 ℏ (network fees only) |
| **02** | M9 Lab 01 | — | <0.1 ℏ (network fees only) |
| **03** | M9 Lab 02 | — | <0.1 ℏ (network fees only) |
| **04** | — | Yes | ~8 ℏ (network fees and the accounts it creates) |
| **05** | M9 Lab 04 | — | free (no transactions are sent) |
| **06** | M9 Lab 04 | Yes | <0.1 ℏ (network fees only) |
| **07** | M9 Lab 04 | — | <0.1 ℏ (network fees only) |
| **08** | M9 Lab 04 | — | <0.1 ℏ (network fees only) |
| **09** | M9 Lab 04 | — | <0.1 ℏ (network fees only) |
| **10** | M9 Lab 04 | — | <0.1 ℏ (network fees only) |
| **11** | M9 Lab 04 | — | <0.1 ℏ (network fees only) |

---

## Official References
- [HCS-10: OpenConvAI Standard](https://github.com/hashgraphonline/standards)
- [HCS-14: Universal Agent ID (UAID)](https://github.com/hashgraphonline/standards)
- [Hybrid Encryption Best Practices (NIST)](https://csrc.nist.gov/publications/detail/sp/800-56b/rev-2/final)

---

 2026 **HEDERA FOR DUMMIES**. AGENTIC INDEPENDENCE.
