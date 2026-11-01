// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * Interfaces de Contratos del Sistema de Hedera:
 * 0x168: Contrato del Sistema de Tasa de Cambio (Exchange Rate)
 * 0x16a: Servicio de Cuentas de Hedera (HAS Precompile)
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
     * Convierte tinycents de USD (1 USD = 100,000,000 tinycents) a tinybars on-chain
     * sin necesidad de redes de oráculos externos (Pyth, Chainlink).
     */
    function getTinybarsForTinycents(uint256 tinycents) external returns (uint256 tinybars) {
        tinybars = IHederaExchangeRate(EXCHANGE_RATE_SYSTEM_CONTRACT).tinycentsToTinybars(tinycents);
        emit ExchangeRateQueried(tinycents, tinybars);
    }

    /**
     * Convierte tinybars de HBAR (1 HBAR = 100,000,000 tinybars) a tinycents de USD on-chain.
     */
    function getTinycentsForTinybars(uint256 tinybars) external returns (uint256 tinycents) {
        tinycents = IHederaExchangeRate(EXCHANGE_RATE_SYSTEM_CONTRACT).tinybarsToTinycents(tinybars);
        emit ExchangeRateQueried(tinycents, tinybars);
    }

    /**
     * Verifica criptográficamente si una firma está autorizada para una cuenta de Hedera
     * mediante la precompilación nativa de consenso (0x16a), soportando cuentas ECDSA y ED25519.
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
