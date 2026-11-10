// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.31;

/**
 * Verifica una firma agregada BLS12-381 de un comité fijo con los precompilados de
 * EIP-2537 (activos en Hedera desde Release 77, HIP-1341). Las llaves públicas son puntos
 * G1 y las firmas puntos G2 (el esquema "minimal-pubkey-size", como en el consenso de
 * Ethereum). El mensaje se hashea a G2 on-chain (hash_to_curve de RFC 9380, suite
 * BLS12381G2_XMD:SHA-256_SSWU_RO_), así que no hay que confiar en nada off-chain.
 */
contract BlsCheckpointVerifier {
    address constant SHA256 = address(0x02);
    address constant MODEXP = address(0x05);
    address constant BLS12_G1ADD = address(0x0b);
    address constant BLS12_G2ADD = address(0x0d);
    address constant BLS12_PAIRING_CHECK = address(0x0f);
    address constant BLS12_MAP_FP2_TO_G2 = address(0x11);

    // Etiqueta de separación de dominio del ciphersuite estándar de firmas BLS (min-pk, esquema básico).
    bytes constant DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_";
    // Módulo del campo p, como elemento de campo EIP-2537 de 64 bytes.
    bytes constant P = hex"000000000000000000000000000000001a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab";
    // El generador de G1 negado: e(pk, H(m)) * e(-g1, sig) == 1 comprueba e(pk, H(m)) == e(g1, sig).
    bytes constant NEG_G1 = hex"0000000000000000000000000000000017f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb00000000000000000000000000000000114d1d6855d545a8aa7d76c8cf2e21f267816aef1db507c96655b9d5caac42364e6f38ba0ecb751bad54dcd6b939c2ca";

    address public immutable owner;
    bytes32 public committeeHash;
    uint256 public verifiedCount;
    bytes32 public lastCheckpoint;

    event CommitteeSet(bytes32 committeeHash, uint256 size);
    event CheckpointVerified(bytes32 indexed checkpointHash, uint256 signers);

    constructor() {
        owner = msg.sender;
    }

    /// Solo el dueño decide qué llaves cuentan: agregar llaves que nadie revisó permite ataques de llave maliciosa (rogue key).
    function setCommittee(bytes[] calldata publicKeys) external {
        require(msg.sender == owner, "ONLY_OWNER");
        committeeHash = keccak256(abi.encode(publicKeys));
        emit CommitteeSet(committeeHash, publicKeys.length);
    }

    function _precompile(address target, bytes memory input, uint256 outputLength) private view returns (bytes memory output) {
        bool ok;
        (ok, output) = target.staticcall(input);
        require(ok && output.length == outputLength, "PRECOMPILE_FAILED");
    }

    /// Suma de las llaves públicas G1 del comité (BLS12_G1ADD, 0x0b).
    function aggregatePublicKeys(bytes[] calldata publicKeys) public view returns (bytes memory aggregate) {
        require(publicKeys.length > 0, "NO_KEYS");
        aggregate = publicKeys[0];
        require(aggregate.length == 128, "BAD_G1_POINT");
        for (uint256 i = 1; i < publicKeys.length; i++) {
            require(publicKeys[i].length == 128, "BAD_G1_POINT");
            aggregate = _precompile(BLS12_G1ADD, abi.encodePacked(aggregate, publicKeys[i]), 128);
        }
    }

    /// expand_message_xmd de RFC 9380 con SHA-256, 256 bytes de salida (dos elementos Fp2).
    function expandMessageXmd(bytes memory message) public view returns (bytes memory uniform) {
        bytes memory dstPrime = abi.encodePacked(DST, uint8(bytes(DST).length));
        bytes32 b0 = _sha256(abi.encodePacked(new bytes(64), message, uint16(256), uint8(0), dstPrime));
        bytes32 bi = _sha256(abi.encodePacked(b0, uint8(1), dstPrime));
        uniform = abi.encodePacked(bi);
        for (uint8 i = 2; i <= 8; i++) {
            bi = _sha256(abi.encodePacked(b0 ^ bi, i, dstPrime));
            uniform = abi.encodePacked(uniform, bi);
        }
    }

    function _sha256(bytes memory data) private view returns (bytes32) {
        return bytes32(_precompile(SHA256, data, 32));
    }

    /// Un bloque de 64 bytes de los bytes uniformes, reducido mod p con MODEXP (base^1 mod p).
    function _fieldElement(bytes memory uniform, uint256 offset) private view returns (bytes memory chunk) {
        chunk = new bytes(64);
        for (uint256 i = 0; i < 64; i++) chunk[i] = uniform[offset + i];
        return _precompile(MODEXP, abi.encodePacked(uint256(64), uint256(1), uint256(64), chunk, uint8(1), P), 64);
    }

    /// hash_to_curve: mapea cada uno de los dos elementos Fp2 a G2 (0x11 también limpia el cofactor) y luego suma (0x0d).
    function hashToG2(bytes memory message) public view returns (bytes memory) {
        bytes memory u = expandMessageXmd(message);
        bytes memory q0 = _precompile(BLS12_MAP_FP2_TO_G2, abi.encodePacked(_fieldElement(u, 0), _fieldElement(u, 64)), 256);
        bytes memory q1 = _precompile(BLS12_MAP_FP2_TO_G2, abi.encodePacked(_fieldElement(u, 128), _fieldElement(u, 192)), 256);
        return _precompile(BLS12_G2ADD, abi.encodePacked(q0, q1), 256);
    }

    /// e(aggregatePk, H(message)) == e(g1, signature), con un solo BLS12_PAIRING_CHECK (0x0f).
    function verifyAggregate(bytes[] calldata publicKeys, bytes calldata message, bytes calldata signature) public view returns (bool) {
        require(signature.length == 256, "BAD_G2_POINT");
        bytes memory input = abi.encodePacked(aggregatePublicKeys(publicKeys), hashToG2(message), NEG_G1, signature);
        return uint256(bytes32(_precompile(BLS12_PAIRING_CHECK, input, 32))) == 1;
    }

    /// Registra un checkpoint solo si el comité registrado firmó exactamente este mensaje.
    function submitCheckpoint(bytes[] calldata publicKeys, bytes calldata message, bytes calldata signature) external {
        require(keccak256(abi.encode(publicKeys)) == committeeHash, "UNKNOWN_COMMITTEE");
        require(verifyAggregate(publicKeys, message, signature), "BAD_SIGNATURE");
        verifiedCount += 1;
        lastCheckpoint = keccak256(message);
        emit CheckpointVerified(lastCheckpoint, publicKeys.length);
    }
}
