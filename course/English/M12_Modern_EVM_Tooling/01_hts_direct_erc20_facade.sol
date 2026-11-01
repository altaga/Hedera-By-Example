// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Minimal standard ERC-20 interface directly compatible with native Hedera HTS tokens.
 * HIP-719 enables direct interaction without invoking the legacy 0x167 system contract.
 */
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

/**
 * @title HtsTokenVault
 * @notice Demonstrates direct ERC-20 facade interaction with native Hedera Token Service assets.
 */
contract HtsTokenVault {
    address public immutable tokenAddress;
    address public owner;
    uint256 public totalDeposits;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    constructor(address _htsTokenAddress) {
        tokenAddress = _htsTokenAddress;
        owner = msg.sender;
    }

    /**
     * @notice Checks vault balance by querying the HTS token directly as an ERC-20.
     */
    function getVaultBalance() external view returns (uint256) {
        return IERC20(tokenAddress).balanceOf(address(this));
    }

    /**
     * @notice Transfer tokens directly using standard ERC-20 ABI.
     */
    function payoutYield(address recipient, uint256 amount) external returns (bool) {
        require(msg.sender == owner, "UNAUTHORIZED");
        return IERC20(tokenAddress).transfer(recipient, amount);
    }
}
