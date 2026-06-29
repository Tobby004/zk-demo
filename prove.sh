#!/usr/bin/env bash
# prove.sh — generate a sample input, build a witness, prove, and verify.
set -euo pipefail

SNARKJS="node_modules/.bin/snarkjs"

echo "==> Generating sample input (build/input.json) + note (build/note.json)"
node scripts/generateInput.js

echo "==> Computing witness"
node build/withdraw_js/generate_witness.js \
  build/withdraw_js/withdraw.wasm build/input.json build/witness.wtns

echo "==> Generating Groth16 proof"
$SNARKJS groth16 prove build/keys/withdraw_final.zkey build/witness.wtns \
  build/proof.json build/public.json

echo "==> Verifying proof"
$SNARKJS groth16 verify build/keys/verification_key.json \
  build/public.json build/proof.json

echo "==> public signals (order: root, nullifierHash, recipient, relayer, fee):"
cat build/public.json