// generateInput.js
// Builds a small sample tree, picks one deposit as "ours", and writes
// build/input.json (circuit input) and build/note.json (the secret note).
const fs = require("fs");
const path = require("path");
const {
  buildHasher,
  commitmentHash,
  nullifierHash,
  generateNote,
  randomFieldElement,
  MerkleTree,
} = require("./merkleTree");

const LEVELS = 20;

async function main() {
  const hasher = await buildHasher();

  // Our note.
  const note = generateNote();
  const commitment = commitmentHash(hasher, note.nullifier, note.secret);
  const nullHash = nullifierHash(hasher, note.nullifier);

  // A few other deposits so the privacy set > 1 and our leaf isn't index 0.
  const others = [0, 1, 2].map(() => {
    const n = generateNote();
    return commitmentHash(hasher, n.nullifier, n.secret);
  });

  // Tree order: two others, then ours (index 2), then one more.
  const leaves = [others[0], others[1], commitment, others[2]];
  const ourIndex = 2;

  const tree = new MerkleTree(hasher, LEVELS, leaves);
  const { root, pathElements, pathIndices } = tree.proof(ourIndex);

  // Public recipient/relayer/fee. Addresses are just field elements here;
  // on-chain (Stage 3) these become the uint160 of the addresses.
  const recipient = randomFieldElement().toString();
  const relayer = "0";
  const fee = "0";

  const input = {
    root,
    nullifierHash: nullHash,
    recipient,
    relayer,
    fee,
    nullifier: note.nullifier,
    secret: note.secret,
    pathElements,
    pathIndices,
  };

  fs.writeFileSync(
    path.join(__dirname, "../build/input.json"),
    JSON.stringify(input, null, 2)
  );
  fs.writeFileSync(
    path.join(__dirname, "../build/note.json"),
    JSON.stringify({ ...note, commitment, nullifierHash: nullHash, leafIndex: ourIndex }, null, 2)
  );

  console.log("commitment   :", commitment);
  console.log("nullifierHash:", nullHash);
  console.log("root         :", root);
  console.log("privacy set  :", leaves.length, "deposits");
  console.log("wrote build/input.json and build/note.json");
}

main().then(() => process.exit(0));