// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Interfaz ERC-20 estándar directamente compatible con tokens nativos HTS de Hedera.
 * HIP-719 habilita la interacción directa sin invocar el contrato del sistema 0x167.
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
 * @notice Demuestra la interacción directa como fachada ERC-20 con activos de Hedera Token Service.
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
     * @notice Consulta el saldo de la bóveda consultando el token HTS directamente como ERC-20.
     */
    function getVaultBalance() external view returns (uint256) {
        return IERC20(tokenAddress).balanceOf(address(this));
    }

    /**
     * @notice Transfiere tokens directamente usando la ABI estándar de ERC-20.
     */
    function payoutYield(address recipient, uint256 amount) external returns (bool) {
        require(msg.sender == owner, "UNAUTHORIZED");
        return IERC20(tokenAddress).transfer(recipient, amount);
    }
}
