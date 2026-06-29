# zk-mixer — Stage 1: the circuit, proven locally

An **educational** zero-knowledge mixer. This repository exists to
learn the circom / snarkjs / Groth16 toolchain and to demonstrate the ZK
primitives behind a mixer (commitments, nullifiers, Merkle membership proofs).

## ⚠️ Disclaimer — read this first

- **Educational and testnet-only.** Designed for Ethereum testnets (e.g. Sepolia)
  with valueless test ETH. **Never deploy to mainnet. Never use with real funds.**
- **Unaudited.** No security review. Assume bugs. Do not rely on it for any
  privacy or security guarantee.
- **Not legal or financial advice.** Privacy mixers occupy genuinely sensitive
  legal territory — the Tornado Cash sanctions are real, recent history. This
  project is a standalone learning exercise and is intentionally kept testnet-only.
- **Trusted setup is local/single-party** (see below) — fine for a demo, **not
  secure for real value.**

## Honest note on the trusted setup

Groth16 requires a **per-circuit trusted setup**. The setup produces secret
randomness ("toxic waste"). The security property is: if **at least one** of the
N participants in the setup ceremony honestly discards their entropy, an attacker
cannot forge proofs. With a real multi-party ceremony, you only need one honest
participant among many.

This project runs a **solo, local, single-party** setup (`setup.sh`). That means
**you** generate and hold all of the entropy. If that entropy leaked, someone
could forge valid-looking withdrawal proofs. For a testnet demo with no real
funds at stake, that is perfectly acceptable. For anything of value it is not —
you would need a proper multi-contributor ceremony. Stating this plainly is part
of doing the project honestly.

## What Stage 1 contains

| File | Purpose |
|------|---------|
| `circuits/withdraw.circom` | The withdrawal circuit (depth-20 Merkle tree). |
| `scripts/merkleTree.js` | JS Poseidon Merkle tree — **matches the circuit bit-for-bit.** |
| `scripts/generateInput.js` | Builds a sample `input.json` + secret `note.json`. |
| `scripts/parity.test.js` | Proves JS Poseidon == circuit Poseidon (the #1 bug). |
| `setup.sh` | Trusted setup: powers of tau → groth16 setup → vkey. |
| `prove.sh` | Witness → proof → verify. |

### The circuit (`Withdraw(20)`)

- Private: `nullifier`, `secret`, `pathElements[20]`, `pathIndices[20]`
- Public: `root`, `nullifierHash`, `recipient`, `relayer`, `fee`
- Proves: `commitment = Poseidon(nullifier, secret)` is a leaf under `root`,
  and `nullifierHash = Poseidon(nullifier)` — without revealing which leaf.
- `recipient`/`relayer`/`fee` are **bound** into the proof (constrained via
  squaring) so a relayer cannot rewrite the recipient and re-broadcast.

**Public signal order** (this matters for the Stage 3 Solidity verifier):
`[root, nullifierHash, recipient, relayer, fee]`.

## The #1 bug, and how this repo guards against it

The classic mixer failure is a **Poseidon / Merkle format mismatch**: the JS tree
computes roots differently than the circuit expects, so proofs verify locally but
fail on-chain (or never verify). `scripts/parity.test.js` guards against it by
(a) recomputing the root from leaf+path by hand and (b) generating the circuit
witness from JS-derived inputs and reading the circuit's own commitment back out,
asserting it equals the JS commitment. **Run the parity test before anything else.**

## Setup — installing circom

circom is installed via Rust:

```bash
# Install Rust if you don't have it
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Build circom from source
git clone https://github.com/iden3/circom.git
cd circom
cargo build --release
cargo install --path circom        # puts `circom` on your PATH
circom --version                   # expect: circom compiler 2.x
cd ..
```

Then the JS deps:

```bash
npm install        # snarkjs, circomlib, circomlibjs
```

## Run Stage 1

```bash
# 1. Parity check — JS hashing must match the circuit. Run this first.
npm run parity
#    Expect: "PARITY OK: JS Merkle/Poseidon matches the circuit."

# 2. Trusted setup (one-time; uses ~2^14 powers of tau for ~11k constraints).
#    On a multi-core machine this takes a couple of minutes.
npm run setup
#    Produces build/keys/withdraw_final.zkey and build/keys/verification_key.json

# 3. Prove + verify a sample withdrawal.
npm run prove
#    The last line must read:  [INFO]  snarkJS: OK!
```

### What success looks like

- `npm run parity` ends with `PARITY OK: ...`.
- `npm run prove` ends with `[INFO]  snarkJS: OK!` and prints the 5 public
  signals in the order above.

A passing `snarkJS: OK!` means: the circuit compiled, the trusted setup is valid,
your JS Merkle tree matches the circuit, and a real Groth16 proof of membership
verified. That is the Stage 1 milestone — a legitimate portfolio artifact on its
own. Stages 2–4 (in-browser proving, contracts, frontend) build on this.

> Note: depth-20 + power-14 trusted setup is CPU-heavy for snarkjs (single-threaded
> JS). Use a multi-core machine. The included `circuits/withdraw_demo.circom`
> (depth-4) runs the identical pipeline in seconds if you want a fast smoke test.