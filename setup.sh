#!/usr/bin/env bash
# setup.sh — one-time trusted setup for the withdraw circuit.
#
# HONEST NOTE: this runs a SINGLE-PARTY local setup. Groth16 needs a
# per-circuit trusted setup; the resulting "toxic waste" entropy must be
# discarded by at least one honest participant for the system to be secure.
# A solo local ceremony means YOU hold that entropy — perfectly fine for a
# testnet demo, NOT secure for real value. See README.
set -euo pipefail

SNARKJS="node_modules/.bin/snarkjs"
CIRCOM="${CIRCOM:-circom}"          # override: CIRCOM=../bin/circom ./setup.sh
POWER="${POWER:-14}"                # 2^14 = 16384 >= ~5382 constraints
ENTROPY1="$(head -c 64 /dev/urandom | base64 | tr -d '\n')"
ENTROPY2="$(head -c 64 /dev/urandom | base64 | tr -d '\n')"

mkdir -p build/ptau build/keys

echo "==> [1/4] Compiling circuit"
$CIRCOM circuits/withdraw.circom --r1cs --wasm --sym -o build \
  -l node_modules/circomlib/circuits

echo "==> [2/4] Powers of Tau (phase 1, universal)"
$SNARKJS powersoftau new bn128 "$POWER" build/ptau/pot_0000.ptau -v
$SNARKJS powersoftau contribute build/ptau/pot_0000.ptau build/ptau/pot_0001.ptau \
  --name="local-contribution-1" -v -e="$ENTROPY1"
$SNARKJS powersoftau prepare phase2 build/ptau/pot_0001.ptau build/ptau/pot_final.ptau -v

echo "==> [3/4] Groth16 setup (phase 2, circuit-specific)"
$SNARKJS groth16 setup build/withdraw.r1cs build/ptau/pot_final.ptau \
  build/keys/withdraw_0000.zkey
$SNARKJS zkey contribute build/keys/withdraw_0000.zkey build/keys/withdraw_final.zkey \
  --name="local-contribution-1" -v -e="$ENTROPY2"

echo "==> [4/4] Export verification key"
$SNARKJS zkey export verificationkey build/keys/withdraw_final.zkey \
  build/keys/verification_key.json

echo "==> setup complete. Artifacts in build/keys/"