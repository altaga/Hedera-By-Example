// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * Hedera Schedule Service (HSS) system contract at 0x16b (HIP-1215).
 * scheduleCall creates a scheduled transaction that calls `to` with `callData`
 * at `expirySecond`. The calling contract pays for that future call.
 */
interface IHederaScheduleService {
    function scheduleCall(
        address to,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64 responseCode, address scheduleAddress);
}

contract AutonomousCronVault {
    address constant HSS_SYSTEM_CONTRACT = address(0x16b);
    int64 constant SUCCESS = 22;

    address public owner;
    uint256 public heartbeatCounter;
    uint256 public lastExecutionTimestamp;

    event HeartbeatExecuted(uint256 counter, uint256 timestamp);
    event TaskScheduled(address indexed scheduleAddress, int64 responseCode, uint256 expirySecond);

    // Payable: the contract keeps a small HBAR balance to pay for the calls it schedules.
    constructor() payable {
        owner = msg.sender;
        lastExecutionTimestamp = block.timestamp;
    }

    receive() external payable {}

    /**
     * The task the scheduler runs.
     */
    function performAutonomousHeartbeat() external {
        heartbeatCounter += 1;
        lastExecutionTimestamp = block.timestamp;
        emit HeartbeatExecuted(heartbeatCounter, lastExecutionTimestamp);
    }

    /**
     * Asks HSS to call performAutonomousHeartbeat() `delaySeconds` from now.
     * Returns the HSS response code (22 = SUCCESS) and the schedule address. No silent
     * fallback: if HSS refuses, the caller sees the real code (-1 if the call itself failed).
     */
    function scheduleNextHeartbeat(uint256 delaySeconds) external returns (int64 responseCode, address scheduleAddress) {
        require(msg.sender == owner, "ONLY_OWNER");

        uint256 expirySecond = block.timestamp + delaySeconds;
        bytes memory callData = abi.encodeWithSelector(this.performAutonomousHeartbeat.selector);

        (bool ok, bytes memory result) = HSS_SYSTEM_CONTRACT.call(
            abi.encodeWithSelector(
                IHederaScheduleService.scheduleCall.selector,
                address(this),
                expirySecond,
                uint256(100000),
                uint64(0),
                callData
            )
        );

        responseCode = -1;
        if (ok && result.length >= 64) {
            (responseCode, scheduleAddress) = abi.decode(result, (int64, address));
        }
        emit TaskScheduled(scheduleAddress, responseCode, expirySecond);
    }
}
