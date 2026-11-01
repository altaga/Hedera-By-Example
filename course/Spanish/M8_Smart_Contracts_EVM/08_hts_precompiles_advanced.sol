// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Interfaz para el Precompilado de Hedera Token Service
interface IHederaTokenService {
    function mintToken(address token, uint64 amount, bytes[] memory metadata) external returns (int responseCode, uint64 newTotalSupply, int64[] memory serialNumbers);
}

contract AdvancedHTS {
    address constant HTS_PRECOMPILE = address(0x167);

    // Mintea tokens fungibles usando el Precompilado HTS (0x167)
    // El contrato DEBE ser la Llave de Suministro (Supply Key) del token para que esto funcione
    function mintFungibleToken(address tokenAddress, uint64 amount) external returns (int) {
        (bool success, bytes memory result) = HTS_PRECOMPILE.call(
            abi.encodeWithSelector(IHederaTokenService.mintToken.selector, tokenAddress, amount, new bytes[](0))
        );
        require(success, "HTS precompile call failed");
        int responseCode = abi.decode(result, (int));
        return responseCode;
    }
}
