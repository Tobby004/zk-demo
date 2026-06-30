// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MerkleTreeWithHistory.sol";

interface IVerifier {
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[5] calldata input
    ) external view returns (bool);
}

/// A fixed-denomination shielded pool (educational, testnet-only).
///
/// Deposit: send exactly `denomination` along with a commitment
///   = Poseidon(nullifier, secret). The commitment is added to the Merkle tree.
/// Withdraw: submit a ZK proof that you know the (nullifier, secret) behind some
///   commitment in the tree, revealing only nullifierHash to prevent
///   double-spends, without revealing which deposit was yours.
///
/// Educational / testnet-only / unaudited. Do not use with real funds.
contract Mixer is MerkleTreeWithHistory {
    IVerifier public immutable verifier;
    uint256 public immutable denomination;

    mapping(uint256 => bool) public nullifierHashes; // spent nullifiers
    mapping(uint256 => bool) public commitments; // seen commitments (dup guard)

    event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp);
    event Withdrawal(address to, uint256 nullifierHash, address indexed relayer, uint256 fee);

    constructor(
        IVerifier _verifier,
        IHasher _hasher,
        uint256 _denomination,
        uint32 _levels
    ) MerkleTreeWithHistory(_levels, _hasher) {
        require(_denomination > 0, "denomination must be > 0");
        verifier = _verifier;
        denomination = _denomination;
    }

    /// Deposit the fixed denomination behind `commitment`.
    function deposit(uint256 commitment) external payable {
        require(!commitments[commitment], "commitment already used");
        require(msg.value == denomination, "wrong denomination");
        require(commitment < FIELD_SIZE, "commitment out of field");

        uint32 insertedIndex = _insert(commitment);
        commitments[commitment] = true;

        emit Deposit(commitment, insertedIndex, block.timestamp);
    }

    /// Withdraw to `recipient`, paying `relayer` a `fee`, by proving membership.
    /// Public signal order MUST match the circuit: [root, nullifierHash,
    /// recipient, relayer, fee].
    function withdraw(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint256 root,
        uint256 nullifierHash,
        address payable recipient,
        address payable relayer,
        uint256 fee
    ) external {
        require(fee <= denomination, "fee exceeds denomination");
        require(!nullifierHashes[nullifierHash], "nullifier already spent");
        require(isKnownRoot(root), "unknown merkle root");

        uint[5] memory input = [
            root,
            nullifierHash,
            uint256(uint160(address(recipient))),
            uint256(uint160(address(relayer))),
            fee
        ];
        require(verifier.verifyProof(a, b, c, input), "invalid withdraw proof");

        // Effects before interactions (reentrancy-safe).
        nullifierHashes[nullifierHash] = true;

        uint256 payout = denomination - fee;
        (bool okR, ) = recipient.call{value: payout}("");
        require(okR, "payout to recipient failed");
        if (fee > 0) {
            (bool okF, ) = relayer.call{value: fee}("");
            require(okF, "fee to relayer failed");
        }

        emit Withdrawal(recipient, nullifierHash, relayer, fee);
    }

    function isSpent(uint256 nullifierHash) external view returns (bool) {
        return nullifierHashes[nullifierHash];
    }
}
