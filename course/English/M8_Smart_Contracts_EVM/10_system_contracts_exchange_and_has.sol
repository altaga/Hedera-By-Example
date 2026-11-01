// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * Hedera System Contract Interfaces:
 * 0x168: Exchange Rate System Contract
 * 0x16a: Hedera Account Service (HAS) Precompile
 */
interface IHederaExchangeRate {
    function tinycentsToTinybars(uint256 tinycents) external returns (uint256 tinybars);
    function tinybarsToTinycents(uint256 tinybars) external returns (uint256 tinycents);
}

interface IHederaAccountService {
    function isAuthorized(address account, bytes memory message, bytes memory signature) external returns (int64 responseCode, bool authorized);
}

contract SystemContractsFacade {
    address constant EXCHANGE_RATE_SYSTEM_CONTRACT = address(0x168);
    address constant HAS_SYSTEM_CONTRACT = address(0x16a);

    event ExchangeRateQueried(uint256 tinycents, uint256 tinybars);
    event AccountAuthorizationVerified(address indexed account, bool authorized);

    /**
     * Converts USD tinycents (1 USD = 100,000,000 tinycents) to tinybars on-chain
     * without needing external oracle networks (Pyth, Chainlink).
     */
    function getTinybarsForTinycents(uint256 tinycents) external returns (uint256 tinybars) {
        tinybars = IHederaExchangeRate(EXCHANGE_RATE_SYSTEM_CONTRACT).tinycentsToTinybars(tinycents);
        emit ExchangeRateQueried(tinycents, tinybars);
    }

    /**
     * Converts HBAR tinybars (1 HBAR = 100,000,000 tinybars) to USD tinycents on-chain.
     */
    function getTinycentsForTinybars(uint256 tinybars) external returns (uint256 tinycents) {
        tinycents = IHederaExchangeRate(EXCHANGE_RATE_SYSTEM_CONTRACT).tinybarsToTinycents(tinybars);
        emit ExchangeRateQueried(tinycents, tinybars);
    }

    /**
     * Cryptographically verifies whether a signature is authorized for a Hedera account
     * via native consensus precompile (0x16a), supporting both ECDSA and ED25519 accounts.
     */
    function verifyAccountSignature(
        address account,
        bytes calldata message,
        bytes calldata signature
    ) external returns (bool authorized) {
        (int64 responseCode, bool isAuth) = IHederaAccountService(HAS_SYSTEM_CONTRACT).isAuthorized(account, message, signature);
        require(responseCode == 22, "HAS_CALL_FAILED"); // ResponseCode 22 = SUCCESS
        emit AccountAuthorizationVerified(account, isAuth);
        return isAuth;
    }
}
