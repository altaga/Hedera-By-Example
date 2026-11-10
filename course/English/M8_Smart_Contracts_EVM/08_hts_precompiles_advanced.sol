// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Interface for the Hedera Token Service Precompile
interface IHederaTokenService {
    function mintToken(address token, uint64 amount, bytes[] memory metadata) external returns (int responseCode, uint64 newTotalSupply, int64[] memory serialNumbers);
}

contract AdvancedHTS {
    address constant HTS_PRECOMPILE = address(0x167);
    address public immutable owner;

    constructor() {
        owner = msg.sender;
    }

    // Mints fungible tokens using the HTS Precompile (0x167)
    // The contract MUST be the Supply Key of the token for this to work
    // Only the deployer may mint. A public mint on a contract that holds the supply key lets
    // any address mint (see the Oct 2026 HederaTokenService.sol access-control advisory).
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
