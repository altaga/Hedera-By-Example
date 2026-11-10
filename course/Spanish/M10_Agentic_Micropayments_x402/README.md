# Módulo 10: Micropagos Agénticos (Protocolo x402)
## Comercio Autónomo Máquina a Máquina en Hedera

> [!IMPORTANT]
> **OBJETIVO:** Que un agente de IA pueda pagar por una API en el mismo momento en que la usa, sin cuenta, sin API key y sin tarjeta, usando HTTP 402 y una transferencia en Hedera.

---

## x402 en un Minuto

Piensa en una máquina expendedora:

1. **Pides algo.** El agente llama a una API, por ejemplo `GET https://hbe.expo.app/api/x402/market-depth`.
2. **La máquina te dice el precio.** En vez de los datos, el servidor responde **HTTP 402 Payment Required** con una cabecera que dice cuánto cuesta, en qué moneda y a qué cuenta pagar.
3. **Entregas un cheque firmado.** El agente arma una transferencia de Hedera por ese monto y **la firma, pero no la envía**. La manda en la cabecera `PAYMENT-SIGNATURE` al repetir la petición.
4. **El cajero cobra el cheque.** Un tercero, el **facilitador**, revisa el cheque, le agrega su firma y lo envía a Hedera. Él paga la comisión de red, así que el agente no necesita HBAR para gas.
5. **Recibes lo que pediste.** Cuando Hedera confirma (en segundos), el servidor devuelve **HTTP 200** con los datos y el recibo en la cabecera `PAYMENT-RESPONSE`.

El truco de Hedera está en el paso 3: toda transacción lleva un **id de transacción**, y la cuenta de ese id es la que paga la comisión. El agente usa la cuenta del facilitador en el id, así que su firma solo autoriza mover el precio; la comisión la pone el facilitador.

### Quién es Quién en estos Labs

| Papel | Qué hace | Wallet que lo representa |
| :--- | :--- | :--- |
| **Agente** (comprador) | Pide el recurso, decide si el precio le conviene y firma el pago | `ACCOUNT_1` (wallet de práctica) |
| **Comercio** (vendedor) | Pone el precio y recibe el dinero | `ACCOUNT_2` (wallet de práctica) |
| **Facilitador** | Verifica el pago, lo firma como pagador de la comisión y lo envía | Tu cuenta de testnet (el operador) |
| **Hedera** | Ordena, ejecuta y confirma la transferencia | Testnet |

En el Lab 08 el comercio hace también de facilitador: solo hay dos papeles.

### Así se ve la Cabecera `PAYMENT-REQUIRED` (decodificada)

Las tres cabeceras son JSON codificado en Base64. Esto es, un poco recortado, lo que el servidor del Lab 01 le dice al agente:

```json
{
  "x402Version": 2,
  "resource": { "url": "/api/x402/market-depth" },
  "accepts": [{
    "scheme": "exact",
    "network": "hedera:testnet",
    "amount": "1000000",
    "asset": "0.0.0",
    "payTo": "0.0.<ACCOUNT_2>",
    "maxTimeoutSeconds": 120,
    "extra": { "feePayer": "0.0.<tu cuenta>" }
  }]
}
```

- `amount` va en la unidad más pequeña del activo: 1,000,000 tinybars = 0.01 HBAR.
- `asset: "0.0.0"` significa HBAR. Con un token HTS (Lab 04) aquí va el id del token.
- `extra.feePayer` es la cuenta del facilitador: la que irá en el id de transacción y pagará la comisión.

### Recorrido de los Labs 01–03

| Lab | Papel que juegas | Qué ocurre | ¿Toca Hedera? |
| :--- | :--- | :--- | :--- |
| **01** | Servidor | Arma la respuesta 402 y la guarda en `state.json` | No, es gratis |
| **02** | Agente | Lee el 402, revisa su presupuesto, arma la transferencia y la firma | No, solo firma |
| **03** | Facilitador | Revisa el pago, lo firma, lo envía, lo confirma en el Mirror Node y comprueba que repetirlo falla | Sí, el pago es real |

Los Labs 04–08 repiten ese mismo ciclo en escenarios más completos, usando las funciones de `M99_Utilities/x402.js` que hacen lo mismo que escribiste a mano en los Labs 01–03.

### Glosario Rápido

- **HTTP 402**: código de estado "Payment Required". Existía desde hace décadas sin un uso estándar; x402 se lo da.
- **Facilitador**: el servicio que convierte la firma del agente en un pago real. Puede ser de un tercero o del propio comercio (Lab 08).
- **feePayer**: la cuenta que paga la comisión de red. En Hedera es la cuenta del id de transacción.
- **Esquema `exact`**: pagar exactamente el monto pedido, ni más ni menos.
- **Tinybar**: la unidad mínima de HBAR (1 HBAR = 100,000,000 tinybars).

---

## Mapa del Módulo

En este módulo cerramos el eslabón que faltaba entre la inteligencia artificial y las finanzas descentralizadas: micro-liquidaciones autónomas sin intervención humana, tarjetas de crédito ni muros de suscripción. Los Labs 01–03 construyen a mano cada paso del protocolo; los Labs 04–08 reutilizan esos pasos (`M99_Utilities/x402.js`) para armar escenarios completos.

| Lab | Tema | Descripción | Arquitectura Operativa |
| :--- | :--- | :--- | :--- |
| **01** | **Desafío 402 del Servidor** | Un recurso protegido responde HTTP 402 con la cabecera `PAYMENT-REQUIRED`: monto, activo, payTo y quién paga la comisión. | Fundamentos |
| **02** | **Firma de Pago del Agente** | El agente arma la `TransferTransaction` real, con la cuenta del facilitador en el id de transacción, y la firma sin enviarla. | Facilitador Patrocinador |
| **03** | **Liquidación del Facilitador** | El facilitador verifica la transferencia firmada, firma como pagador de la comisión y liquida en Hedera; una repetición falla con `DUPLICATE_TRANSACTION`. | Facilitador Patrocinador |
| **04** | **Micropagos USDC con HTS** | Liquidar un prompt de $0.025 en una stablecoin HTS de 6 decimales, con la comparación económica frente a las tarjetas. | Motor de Tokens HTS |
| **05** | **Límites Financieros** | Un motor de políticas determinista (techos, presupuesto, lista blanca) que rechaza antes de firmar, con auditoría en HCS. | Gobierno del Riesgo |
| **06** | **Agente de Mercado Autónomo** | Cotizaciones 402 gratuitas de tres proveedores, un puntaje precio-rendimiento y un solo pago al ganador. | Ciclo de Agente Autónomo |
| **07** | **Pasarela de Streaming de IA** | Inferencia por Server-Sent Events que solo se abre cuando el pago x402 se liquida en Hedera. | Proxy en Tiempo Real |
| **08** | **Liquidación entre Dos Partes** | El comercio es su propio facilitador: verifica, firma, paga la comisión y audita en el Mirror Node. | Comercio como Facilitador (2 Actores) |

---

## Dos Topologías de Arquitectura

En Hedera, el esquema `exact` de x402 funciona siempre igual para el comprador: firma una `TransferTransaction` cuyo id de transacción pertenece a quien paga la comisión (`extra.feePayer`) y nunca la envía. Lo que cambia es **quién** hace de facilitador.

### Arquitectura 1: Facilitador Patrocinador (3 Actores: Comprador + Vendedor + Facilitador)

Ideal para agentes de IA sin gas, frontends web o microservicios que no tienen HBAR para comisiones (Labs 01–07):

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
    actor Agente as Agente de IA (Comprador)
    participant Servidor as Servidor API (Vendedor)
    participant Facilitador as Facilitador x402
    participant Hedera as ℏ Hedera Hashgraph

    Agente->>Servidor: GET /api/x402/market-depth (sin autenticación)
    Servidor-->>Agente: HTTP 402 + PAYMENT-REQUIRED (monto, activo, payTo, feePayer)
    Note over Agente: Revisa su política de gasto<br/>Firma una TransferTransaction (id = feePayer)<br/>No la envía
    Agente->>Servidor: GET /api/x402/market-depth + PAYMENT-SIGNATURE
    Servidor->>Facilitador: Verificar y liquidar
    Note over Facilitador: Pagador de la comisión, caducidad, monto, receptor, firma
    Facilitador->>Hedera: Firma como pagador de la comisión y envía
    Hedera-->>Facilitador: Finalidad de consenso (segundos, id de transacción)
    Servidor-->>Agente: HTTP 200 OK + PAYMENT-RESPONSE (id de transacción) + datos
```

### Arquitectura 2: el Comercio como Facilitador (2 Actores: Comprador + Vendedor)

Sin infraestructura de terceros: el vendedor verifica, firma y paga la comisión por sí mismo (Lab 08). El lado del comprador no cambia:

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
    actor Agente as Agente de IA (Comprador)
    participant Servidor as Servidor API (Vendedor + Facilitador)
    participant Hedera as ℏ Hedera Hashgraph

    Agente->>Servidor: GET /api/v1/derivatives-matrix (sin autenticación)
    Servidor-->>Agente: HTTP 402 + PAYMENT-REQUIRED (payTo = feePayer = vendedor)
    Note over Agente: Firma la transferencia, igual que en la Arquitectura 1
    Agente->>Servidor: GET /api/v1/derivatives-matrix + PAYMENT-SIGNATURE
    Note over Servidor: Verifica y firma con su propia llave
    Servidor->>Hedera: Envía, pagando la comisión con el precio que recibe
    Hedera-->>Servidor: Finalidad de consenso (id de transacción)
    Note over Servidor: Audita la liquidación en el Mirror Node
    Servidor-->>Agente: HTTP 200 OK + PAYMENT-RESPONSE + recurso
```

---

## Comparación de Arquitecturas: ¿Cuándo Usar Cada Una?

| Dimensión | Comercio como Facilitador (Comprador + Vendedor) | Facilitador Patrocinador (Comprador + Vendedor + Facilitador) |
| :--- | :--- | :--- |
| **Modelo de actores** | 2 actores | 3 actores (comprador, vendedor, facilitador) |
| **Comisión de red** | La paga el vendedor, con parte del precio | La paga el facilitador |
| **Saldo que necesita el comprador** | Solo el activo del pago (nada de HBAR para gas) | Solo el activo del pago (nada de HBAR para gas) |
| **Dependencia de intermediarios** | **Ninguna**: el vendedor opera todo | Requiere un facilitador en línea (alojado o propio) |
| **Protección contra repeticiones** | Id de transacción de Hedera: se ejecuta una vez, vale 120 s | Id de transacción de Hedera: se ejecuta una vez, vale 120 s |
| **Uso recomendado** | Vendedores que ya operan infraestructura y tienen HBAR | Vendedores que prefieren no tener una llave con fondos firmando |

## Conceptos Clave

### 1. Las tres cabeceras
`PAYMENT-REQUIRED` (condiciones del 402), `PAYMENT-SIGNATURE` (la transferencia firmada) y `PAYMENT-RESPONSE` (el recibo de la liquidación) llevan JSON codificado en Base64, versión `x402Version: 2`.

### 2. Sin gas para el comprador
El id de transacción decide quién paga la comisión de red. Como pertenece al facilitador, al comprador solo le hace falta el precio, en HBAR (`0.0.0`) o en un token HTS.

### 3. La protección contra repeticiones es nativa
Un id de transacción de Hedera solo se ejecuta una vez y caduca 120 segundos después de firmarse. Un pago repetido falla con `DUPLICATE_TRANSACTION`; no hace falta un registro de nonces.

## Antes de Ejecutar

Los Labs 01–03 forman una cadena (cada uno lee lo que el anterior guardó en `state.json`): ejecútalos en orden, y el Lab 03 dentro de los dos minutos siguientes al Lab 02 (si el pago firmado caducó, el agente lo vuelve a firmar). Todos usan tu cuenta de testnet y las wallets de práctica `ACCOUNT_1` (agente) y `ACCOUNT_2` (comercio); en la web del curso corren en el navegador.

---

## Referencias Oficiales
- [x402 en Hedera](https://docs.hedera.com/solutions/ai/x402)
- [Cómo funciona x402](https://docs.hedera.com/solutions/ai/x402/how-it-works)
- [Facilitadores x402 en Hedera](https://docs.hedera.com/solutions/ai/x402/facilitators)
- [Repositorio del protocolo x402](https://github.com/x402-foundation/x402)
- [Especificación del esquema exact en Hedera](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md)
- [Hedera Agent Kit](https://github.com/hedera-dev/hedera-agent-kit)

---

 2026 **HEDERA FOR DUMMIES**. EL CÓDIGO ES DINERO. LA LIQUIDACIÓN ES INSTANTÁNEA.
