// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * Contrato de sistema Hedera Schedule Service (HSS) en 0x16b (HIP-1215).
 * scheduleCall crea una transacción programada que llama a `to` con `callData`
 * en `expirySecond`. El contrato que llama paga esa llamada futura.
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

    // Payable: el contrato guarda un poco de HBAR para pagar las llamadas que programa.
    constructor() payable {
        owner = msg.sender;
        lastExecutionTimestamp = block.timestamp;
    }

    receive() external payable {}

    /**
     * La tarea que ejecuta el programador.
     */
    function performAutonomousHeartbeat() external {
        heartbeatCounter += 1;
        lastExecutionTimestamp = block.timestamp;
        emit HeartbeatExecuted(heartbeatCounter, lastExecutionTimestamp);
    }

    /**
     * Pide a HSS que llame a performAutonomousHeartbeat() dentro de `delaySeconds`.
     * Devuelve el código de respuesta de HSS (22 = SUCCESS) y la dirección de la programación.
     * Sin respaldo silencioso: si HSS se niega, quien llama ve el código real (-1 si la llamada falló).
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
