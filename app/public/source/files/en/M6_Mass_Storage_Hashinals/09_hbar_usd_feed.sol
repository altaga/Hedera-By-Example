// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * HBAR/USD price feed for M6 Lab 09, Chainlink-style (8 decimals).
 * It reads the network exchange rate from the Hedera Exchange Rate system contract (0x168),
 * so the price is the one the network itself uses for fees, with no oracle to pay.
 */
contract HbarUsdFeed {
    address constant EXCHANGE_RATE = address(0x168);
    uint256 constant TINYCENTS_PER_USD = 1e10; // 1 cent = 1e8 tinycents

    function decimals() external pure returns (uint8) {
        return 8;
    }

    // HBAR price in USD with 8 decimals: (1e8 tinybars per HBAR / tinybars per USD) * 1e8
    function latestAnswer() external view returns (int256) {
        (bool ok, bytes memory out) = EXCHANGE_RATE.staticcall(
            abi.encodeWithSignature("tinycentsToTinybars(uint256)", TINYCENTS_PER_USD)
        );
        require(ok && out.length == 32, "exchange rate unavailable");
        uint256 tinybarsPerUsd = abi.decode(out, (uint256));
        return int256(1e16 / tinybarsPerUsd);
    }
}
