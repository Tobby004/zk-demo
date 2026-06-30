# zk-mixer

A from-scratch **zero-knowledge shielded pool** on Ethereum. Deposit a fixed
amount behind a secret note, then withdraw to any address with a Groth16 proof
that you own *a* deposit — without revealing *which* one. The link between
depositor and recipient is never published on-chain.

**Live demo (Sepolia testnet):** https://zk-demo-testnet.vercel.app

> **Educational · testnet-only · unaudited.** Built to learn the circom /
> snarkjs / Groth16 toolchain end to end. Runs only on the Sepolia testnet with
> valueless test ETH. Not for mainnet, not for real funds, not legal or
> financial advice.

---

## What it does

A user deposits a fixed denomination (0.1 test ETH) along with a commitment
`Poseidon(nullifier, secret)`. Later, they prove in zero knowledge that this
commitment is a leaf in the pool's Merkle tree and withdraw to a fresh address,
revealing only `nullifierHash = Poseidon(nullifier)` to prevent double-spends.
Because many deposits share one pool, an observer cannot tell which deposit
funded a given withdrawal — that crowd is the privacy (anonymity) set.

The proof is generated **in the browser**; secrets never leave the user's machine.

## Live deployment (Sepolia)

| Contract | Address |
|----------|---------|
| Mixer (pool) | [`0x8377414ed2b56b4A9CD795fE8acb519B6E6A884A`](https://sepolia.etherscan.io/address/0x8377414ed2b56b4A9CD795fE8acb519B6E6A884A) |
| Groth16 verifier | [`0x913347f34872A609EB9d08bCf540fD14301DfABA`](https://sepolia.etherscan.io/address/0x913347f34872A609EB9d08bCf540fD14301DfABA) |
| Poseidon hasher | [`0xA836c683eB072d10bd4fC9bB3Bc2D2A19680531B`](https://sepolia.etherscan.io/address/0xA836c683eB072d10bd4fC9bB3Bc2D2A19680531B) |

## Architecture

    circuit (circom)  ──compile──▶  r1cs + wasm
          │                              │
     trusted setup (Groth16)        witness + proof (snarkjs, in browser)
          │                              │
     verification key            ┌───────┴────────┐
          │                      │                │
    Solidity verifier ◀──────────┘         Mixer pool contract
    (auto-generated)                       ├─ incremental Poseidon Merkle tree
                                           ├─ rolling root history
                                           ├─ nullifier double-spend guard
                                           └─ deposit() / withdraw()
                                                    │
                                           Next.js frontend
                                           ├─ wallet connect (ethers v6)
                                           ├─ deposit + note generation
                                           └─ rebuild tree from events,
                                              prove + withdraw

The single most important invariant: the **Poseidon hash and Merkle format are
identical** across the circuit, the JavaScript tree, and the on-chain tree. A
parity test (`scripts/parity.test.js`) and a Hardhat test
(`onchain/test/merkletree.test.js`) verify this — mismatched hashing is the
classic failure where proofs verify locally but are rejected on-chain.

## Tech stack

- **Circuits:** circom 2, circomlib (Poseidon), Groth16 via snarkjs
- **Contracts:** Solidity 0.8.20, Hardhat, ethers v6
- **Hashing on-chain:** Poseidon contract deployed from circomlibjs bytecode
- **Frontend:** Next.js (App Router), snarkjs WASM proving in-browser, Tailwind v4

## Repository layout

    circuits/withdraw.circom      the withdrawal circuit (depth-20 Merkle tree)
    scripts/                      JS Merkle tree + parity test + input builder
    setup.sh / prove.sh           trusted setup and local prove/verify
    onchain/                      Hardhat project
      contracts/Mixer.sol         the pool (deposit/withdraw)
      contracts/MerkleTreeWithHistory.sol   incremental Poseidon tree
      contracts/Verifier.sol      Groth16 verifier (generated)
      test/                       Hardhat tests
      scripts/deploy.js           deploy script
    web/                          Next.js frontend

## Run it locally

**1. Circuit + local proof**

    npm install
    mkdir -p build
    circom circuits/withdraw.circom --r1cs --wasm --sym -o build -l node_modules/circomlib/circuits
    node scripts/parity.test.js      # expect: PARITY OK
    ./setup.sh                        # trusted setup
    ./prove.sh                        # expect: snarkJS: OK!

(circom is installed via Rust: https://docs.circom.io/getting-started/installation/)

**2. Contracts**

    cd onchain
    npm install
    npx hardhat test                  # tree parity + full deposit/withdraw cycle
    # to deploy, set onchain/.env (see .env.example), then:
    npx hardhat run scripts/deploy.js --network sepolia

**3. Frontend**

    cd web
    npm install
    npm run dev                       # http://localhost:3000

## Honest note on the trusted setup

Groth16 needs a per-circuit trusted setup. Its security relies on at least one
participant destroying their secret randomness ("toxic waste"). `setup.sh` runs
a **single-party local** ceremony, so the operator holds that randomness — fine
for a testnet demo, **not** secure for real value, which would require a
multi-party ceremony.

## Security notes (educational)

- Effects-before-interactions ordering in `withdraw()` (reentrancy-safe).
- Nullifier marked spent before funds are sent; double-withdraw reverts.
- `recipient`/`relayer`/`fee` are bound into the proof, so a relayer cannot
  rewrite the recipient and re-broadcast.
- Rolling history of recent roots so a withdrawal can use a recent root even if
  more deposits arrive after the proof is built.

This code is **unaudited** and intentionally testnet-only.