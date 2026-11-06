# Module 10: Agentic Micropayments (x402 Protocol)
## Official x402 v2 `exact` scheme on Hedera testnet

> [!IMPORTANT]
> These labs use the official packages `@x402/core`, `@x402/express`, `@x402/fetch`, and `@x402/hedera`
> against the public facilitator `https://x402.org/facilitator` (`hedera:testnet`).

## Module Map

| Lab | Topic | What it proves |
| :--- | :--- | :--- |
| **01** | Server 402 Challenge | `@x402/express` emits Base64 `PAYMENT-REQUIRED` (x402Version 2) |
| **02** | Agent Payment Signature | `@x402/fetch` + `ExactHederaScheme` auto-retry with `PAYMENT-SIGNATURE` |
| **03** | Facilitator Settlement | Explicit facilitator `/verify` + `/settle` and `PAYMENT-RESPONSE` |
| **04** | HTS USDC Micropayments | Official testnet USDC `0.0.429274` (HBAR fallback if unfunded) |
| **05** | Financial Guardrails | Policy engine over decoded official `PaymentRequirements` |
| **06** | Autonomous Market Agent | End-to-end agent loop against a real paid route |
| **07** | Live AI Streaming Gateway | x402 unlock + **non-x402** SSE metering (labeled) |
| **08** | Facilitated Settlement | Official facilitator flow (slug kept; Direct P2P is **not** official) |

## Official topology (Hedera exact)

Buyer signs a partially-signed `TransferTransaction` with `transactionId.accountId = feePayer`.
The facilitator co-signs gas and submits. Merchant never broadcasts the payment.

## Requirements

```bash
# course/.env
OPERATOR_ID=0.0.x
OPERATOR_PRIVATE_KEY=...
MERCHANT_ID=0.0.y          # must differ from OPERATOR_ID
MERCHANT_PRIVATE_KEY=...   # needed to associate HTS in lab 04
NETWORK=testnet
```

## Official References
- https://docs.hedera.com/solutions/ai/x402
- https://docs.hedera.com/solutions/ai/x402/facilitators
- https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
- https://x402.org/facilitator/supported
