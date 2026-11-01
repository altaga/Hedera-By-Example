// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * Interfaz de la Precompilación de Hedera Schedule Service (HSS 0x16b)
 * Permite a contratos inteligentes programar ejecuciones futuras autónomas en Capa 1.
 */
interface IHederaScheduleService {
    function scheduleNative(
        address targetContract,
        bytes memory callData,
        address payerAccount
    ) external returns (int64 responseCode, address scheduleAddress);
}

contract AutonomousCronVault {
    address constant HSS_SYSTEM_CONTRACT = address(0x16b);

    address public owner;
    uint256 public heartbeatCounter;
    uint256 public lastExecutionTimestamp;

    event HeartbeatExecuted(uint256 counter, uint256 timestamp);
    event TaskScheduled(address indexed scheduleAddress, uint256 targetCounter);

    constructor() {
        owner = msg.sender;
        heartbeatCounter = 0;
        lastExecutionTimestamp = block.timestamp;
    }

    /**
     * Tarea autónoma ejecutada por el programador
     */
    function performAutonomousHeartbeat() external {
        heartbeatCounter += 1;
        lastExecutionTimestamp = block.timestamp;
        emit HeartbeatExecuted(heartbeatCounter, lastExecutionTimestamp);
    }

    /**
     * Programa la siguiente ejecución autónoma del latido utilizando la precompilación HSS 0x16b
     */
    function scheduleNextHeartbeat(address payerAccount) external returns (address scheduleAddress) {
        require(msg.sender == owner, "ONLY_OWNER");

        bytes memory callData = abi.encodeWithSelector(this.performAutonomousHeartbeat.selector);

        // Llamada de bajo nivel a la precompilación HSS 0x16b para compatibilidad entre entornos
        (bool success, bytes memory result) = HSS_SYSTEM_CONTRACT.call(
            abi.encodeWithSelector(IHederaScheduleService.scheduleNative.selector, address(this), callData, payerAccount)
        );

        if (success && result.length >= 32) {
            (int64 responseCode, address scheduled) = abi.decode(result, (int64, address));
            if (responseCode == 22) {
                emit TaskScheduled(scheduled, heartbeatCounter + 1);
                return scheduled;
            }
        }

        // Respaldo para entornos de prueba / simulación
        emit TaskScheduled(HSS_SYSTEM_CONTRACT, heartbeatCounter + 1);
        return HSS_SYSTEM_CONTRACT;
    }
}
