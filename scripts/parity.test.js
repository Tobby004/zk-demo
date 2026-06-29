// parity.test.js
// THE test that catches the #1 mixer bug. Two independent checks:
//   A) JS<->JS: recompute the root from leaf+path by hand and confirm it
//      equals tree.root(). Proves proof()/root() agree on the path format.
//   B) JS<->circuit: generate the circuit witness from JS-derived inputs and
//      read the circuit's internally-computed commitment back out. If the
//      circuit's Poseidon differed from circomlibjs Poseidon, witness
//      generation would assert-fail (root/nullifier constraints) OR the
//      recovered commitment would differ. Either way we catch it here.
const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");
const {
  buildHasher,
  commitmentHash,
  nullifierHash,
  generateNote,
  MerkleTree,
} = require("./merkleTree");

const LEVELS = 20;
const BUILD = path.join(__dirname, "../build");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("  ok -", msg);
}

// Read a single signal value out of the witness using the .sym map.
function readSignal(symPath, witness, signalName) {
  const lines = fs.readFileSync(symPath, "utf8").split("\n");
  for (const line of lines) {
    if (!line) continue;
    const [, witnessIdx, , name] = line.split(",");
    if (name === signalName) return witness[parseInt(witnessIdx, 10)].toString();
  }
  throw new Error("signal not found in sym: " + signalName);
}

async function main() {
  const hasher = await buildHasher();

  // ----- Test A: JS path/root self-consistency -----
  const note = generateNote();
  const commitment = commitmentHash(hasher, note.nullifier, note.secret);
  const otherLeaves = [0, 1, 2].map(() => {
    const n = generateNote();
    return commitmentHash(hasher, n.nullifier, n.secret);
  });
  const leaves = [otherLeaves[0], otherLeaves[1], commitment, otherLeaves[2]];
  const ourIndex = 2;
  const tree = new MerkleTree(hasher, LEVELS, leaves);
  const { root, pathElements, pathIndices, leaf } = tree.proof(ourIndex);

  assert(leaf === commitment, "proof().leaf equals JS commitment");

  // Recompute root by hand from leaf + path.
  let cur = leaf;
  for (let i = 0; i < LEVELS; i++) {
    cur =
      pathIndices[i] === 0
        ? hasher.hash([cur, pathElements[i]])
        : hasher.hash([pathElements[i], cur]);
  }
  assert(cur === root, "hand-recomputed root equals tree.root()");

  // ----- Test B: circuit Poseidon == JS Poseidon -----
  const input = {
    root,
    nullifierHash: nullifierHash(hasher, note.nullifier),
    recipient: "12345",
    relayer: "0",
    fee: "0",
    nullifier: note.nullifier,
    secret: note.secret,
    pathElements,
    pathIndices,
  };

  const wasmPath = path.join(BUILD, "withdraw_js/withdraw.wasm");
  const wtnsPath = path.join(BUILD, "parity.wtns");
  // If JS Poseidon != circuit Poseidon, the root/nullifier constraints
  // assert-fail here and this throws.
  await snarkjs.wtns.calculate(input, wasmPath, wtnsPath);
  assert(true, "witness generated (root & nullifier constraints satisfied)");

  // Recover the circuit's commitment signal and compare to JS.
  const wtns = await snarkjs.wtns.exportJson(wtnsPath);
  const circuitCommitment = readSignal(
    path.join(BUILD, "withdraw.sym"),
    wtns,
    "main.commitmentHasher.out"
  );
  assert(
    circuitCommitment === commitment,
    "circuit commitment equals JS commitment (Poseidon parity)"
  );

  console.log("\nPARITY OK: JS Merkle/Poseidon matches the circuit.");
}

main().then(() => process.exit(0));