pragma circom 2.1.6;
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

// Proves: "I know (nullifier, secret) whose commitment Poseidon(nullifier, secret)
// is a leaf of the Merkle tree with this root", without revealing which leaf.
template MerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;
    component hashers[levels];
    component mux[levels];
    signal cur[levels + 1];
    cur[0] <== leaf;
    for (var i = 0; i < levels; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== cur[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== cur[i];
        mux[i].s <== pathIndices[i];
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];
        cur[i + 1] <== hashers[i].out;
    }
    root <== cur[levels];
}

template Withdraw(levels) {
    signal input root;
    signal input nullifierHash;
    signal input recipient; // bound to the proof so it cannot be front-run
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component c = Poseidon(2);
    c.inputs[0] <== nullifier;
    c.inputs[1] <== secret;
    component n = Poseidon(1);
    n.inputs[0] <== nullifier;
    n.out === nullifierHash;

    component tree = MerkleProof(levels);
    tree.leaf <== c.out;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    tree.root === root;
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

component main { public [root, nullifierHash, recipient] } = Withdraw(8);
