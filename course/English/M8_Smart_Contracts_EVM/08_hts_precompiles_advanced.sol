// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Interface for the Hedera Token Service Precompile
interface IHederaTokenService {
    function mintToken(address token, uint64 amount, bytes[] memory metadata) external returns (int responseCode, uint64 newTotalSupply, int64[] memory serialNumbers);
}

contract AdvancedHTS {
    address constant HTS_PRECOMPILE = address(0x167);

    // Mints fungible tokens using the HTS Precompile (0x167)
    // The contract MUST be the Supply Key of the token for this to work
    function mintFungibleToken(address tokenAddress, uint64 amount) external returns (int) {
        (bool success, bytes memory result) = HTS_PRECOMPILE.call(
            abi.encodeWithSelector(IHederaTokenService.mintToken.selector, tokenAddress, amount, new bytes[](0))
        );
        require(success, "HTS precompile call failed");
        int responseCode = abi.decode(result, (int));
        return responseCode;
    }
}
