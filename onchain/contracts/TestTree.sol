// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MerkleTreeWithHistory.sol";

/// TEST-ONLY helper: exposes the internal _insert so tests can append leaves
/// directly without going through the full deposit() flow. Not used in
/// production; the real pool inserts via deposit().
contract TestTree is MerkleTreeWithHistory {
    constructor(uint32 _levels, IHasher _hasher)
        MerkleTreeWithHistory(_levels, _hasher)
    {}

    function insert(uint256 leaf) external returns (uint32) {
        return _insert(leaf);
    }
}
