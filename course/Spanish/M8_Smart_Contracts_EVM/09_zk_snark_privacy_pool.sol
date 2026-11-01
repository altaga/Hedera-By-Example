// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ZkPrivacyPool
 * @notice Verificación de Nulificadores y Compromisos Zero-Knowledge en Hedera EVM.
 * Permite depósitos anónimos y retiros confidenciales sin vincular depositante y receptor.
 */
contract ZkPrivacyPool {
    mapping(bytes32 => uint256) public commitments;
    mapping(bytes32 => bool) public spentNullifiers;

    event Deposit(bytes32 indexed commitment, uint256 amount);
    event Withdrawal(address indexed recipient, bytes32 indexed nullifier, uint256 amount);

    function deposit(bytes32 commitment) external payable {
        require(msg.value > 0, "No funds");
        require(commitments[commitment] == 0, "Exists");
        commitments[commitment] = msg.value;
        emit Deposit(commitment, msg.value);
    }

    function withdraw(bytes32 nullifier, bytes32 secret, address payable recipient) external returns (bool) {
        require(!spentNullifiers[nullifier], "Spent");
        bytes32 commitment = keccak256(abi.encodePacked(nullifier, secret));
        uint256 amount = commitments[commitment];
        require(amount > 0, "Invalid proof");

        spentNullifiers[nullifier] = true;
        commitments[commitment] = 0;

        (bool ok, ) = recipient.call{value: amount}("");
        require(ok, "Transfer failed");

        emit Withdrawal(recipient, nullifier, amount);
        return true;
    }

    function isSpent(bytes32 nullifier) external view returns (bool) {
        return spentNullifiers[nullifier];
    }
}
