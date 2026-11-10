// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * Feed de precio HBAR/USD para el Lab 09 de M6, estilo Chainlink (8 decimales).
 * Lee el tipo de cambio de la red del contrato de sistema Exchange Rate de Hedera (0x168),
 * así que el precio es el que la propia red usa para las tarifas, sin pagar un oráculo.
 */
contract HbarUsdFeed {
    address constant EXCHANGE_RATE = address(0x168);
    uint256 constant TINYCENTS_PER_USD = 1e10; // 1 centavo = 1e8 tinycents

    function decimals() external pure returns (uint8) {
        return 8;
    }

    // Precio del HBAR en USD con 8 decimales: (1e8 tinybars por HBAR / tinybars por USD) * 1e8
    function latestAnswer() external view returns (int256) {
        (bool ok, bytes memory out) = EXCHANGE_RATE.staticcall(
            abi.encodeWithSignature("tinycentsToTinybars(uint256)", TINYCENTS_PER_USD)
        );
        require(ok && out.length == 32, "exchange rate unavailable");
        uint256 tinybarsPerUsd = abi.decode(out, (uint256));
        return int256(1e16 / tinybarsPerUsd);
    }
}
