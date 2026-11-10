// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Interfaz para el Precompilado de Hedera Token Service
interface IHederaTokenService {
    function mintToken(address token, uint64 amount, bytes[] memory metadata) external returns (int responseCode, uint64 newTotalSupply, int64[] memory serialNumbers);
}

contract AdvancedHTS {
    address constant HTS_PRECOMPILE = address(0x167);
    address public immutable owner;

    constructor() {
        owner = msg.sender;
    }

    // Mintea tokens fungibles usando el Precompilado HTS (0x167)
    // El contrato DEBE ser la Llave de Suministro (Supply Key) del token para que esto funcione
    // Solo quien desplegó puede mintear. Un mint público en un contrato que tiene la llave de suministro
    // deja mintear a cualquier dirección (ver el aviso de oct. 2026 sobre control de acceso en HederaTokenService.sol).
    function mintFungibleToken(address tokenAddress, uint64 amount) external returns (int) {
        require(msg.sender == owner, "ONLY_OWNER");
        (bool success, bytes memory result) = HTS_PRECOMPILE.call(
            abi.encodeWithSelector(IHederaTokenService.mintToken.selector, tokenAddress, amount, new bytes[](0))
        );
        require(success, "HTS precompile call failed");
        int responseCode = abi.decode(result, (int));
        return responseCode;
    }
}
