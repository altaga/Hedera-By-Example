// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * Minimal ERC-4337 (EntryPoint v0.6) smart account and verifying paymaster for M12 Lab 06.
 * EntryPoint v0.6 on Hedera testnet: 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
 */

struct UserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    uint256 callGasLimit;
    uint256 verificationGasLimit;
    uint256 preVerificationGas;
    uint256 maxFeePerGas;
    uint256 maxPriorityFeePerGas;
    bytes paymasterAndData;
    bytes signature;
}

interface IEntryPoint {
    function depositTo(address account) external payable;
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;
}

library Sig {
    // Signer of an Ethereum signed message ("\x19Ethereum Signed Message:\n32" + hash), or address(0).
    function recover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        return ecrecover(digest, v, r, s);
    }
}

/// A smart account owned by one ECDSA key. Only the EntryPoint can run its code.
contract HbeAccount {
    address public immutable entryPoint;
    address public immutable owner;
    uint256 public counter;

    event Incremented(uint256 counter);

    constructor(address _entryPoint, address _owner) {
        entryPoint = _entryPoint;
        owner = _owner;
    }

    receive() external payable {}

    // ERC-4337 v0.6: return 0 if the owner signed userOpHash, 1 (SIG_VALIDATION_FAILED) otherwise.
    function validateUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds) external returns (uint256) {
        require(msg.sender == entryPoint, "only EntryPoint");
        if (missingAccountFunds > 0) {
            (bool ok, ) = payable(msg.sender).call{value: missingAccountFunds}("");
            ok;
        }
        return Sig.recover(userOpHash, userOp.signature) == owner ? 0 : 1;
    }

    // The action the UserOperation runs.
    function increment() external {
        require(msg.sender == entryPoint, "only EntryPoint");
        counter += 1;
        emit Incremented(counter);
    }
}

/// A verifying paymaster: it pays for a UserOperation only if its signer approved that operation.
/// paymasterAndData = address(this) (20 bytes) || signature (65 bytes) over getHash(userOp).
contract HbePaymaster {
    address public immutable entryPoint;
    address public immutable verifyingSigner;

    constructor(address _entryPoint, address _verifyingSigner) {
        entryPoint = _entryPoint;
        verifyingSigner = _verifyingSigner;
    }

    // What the sponsor signs: the operation without paymasterAndData and signature (which would be circular).
    function getHash(UserOperation calldata userOp) public view returns (bytes32) {
        return keccak256(abi.encode(
            userOp.sender, userOp.nonce, keccak256(userOp.initCode), keccak256(userOp.callData),
            userOp.callGasLimit, userOp.verificationGasLimit, userOp.preVerificationGas,
            userOp.maxFeePerGas, userOp.maxPriorityFeePerGas, block.chainid, address(this)
        ));
    }

    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32, uint256) external view returns (bytes memory context, uint256 validationData) {
        require(msg.sender == entryPoint, "only EntryPoint");
        bytes memory signature = userOp.paymasterAndData[20:];
        return ("", Sig.recover(getHash(userOp), signature) == verifyingSigner ? 0 : 1);
    }

    // Funds the paymaster's deposit inside the EntryPoint.
    function deposit() external payable {
        IEntryPoint(entryPoint).depositTo{value: msg.value}(address(this));
    }
}
