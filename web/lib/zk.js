import { buildPoseidon } from "circomlibjs";

export const LEVELS = 20;

export const FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const ZERO_VALUE =
  21663839004416932945382355908790599225266501822907911457504978515578255421292n;

let _hasher = null;
export async function getHasher() {
  if (_hasher) return _hasher;
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const hash = (inputs) => F.toString(poseidon(inputs.map((x) => BigInt(x))));
  _hasher = { poseidon, F, hash };
  return _hasher;
}

export function randomFieldElement() {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex) % FIELD_SIZE;
}

export function generateNote() {
  return {
    nullifier: randomFieldElement().toString(),
    secret: randomFieldElement().toString(),
  };
}

export function commitmentHash(hasher, nullifier, secret) {
  return hasher.hash([nullifier, secret]);
}
export function nullifierHash(hasher, nullifier) {
  return hasher.hash([nullifier]);
}

export class MerkleTree {
  constructor(hasher, levels, leaves = []) {
    this.hasher = hasher;
    this.levels = levels;
    this.zeros = [];
    this.layers = [];
    let current = ZERO_VALUE.toString();
    this.zeros.push(current);
    for (let i = 0; i < levels; i++) {
      current = hasher.hash([current, current]);
      this.zeros.push(current);
    }
    this.layers[0] = leaves.map((l) => BigInt(l).toString());
    this._build();
  }
  _build() {
    for (let level = 0; level < this.levels; level++) {
      const nodes = this.layers[level];
      const parents = [];
      for (let i = 0; i < nodes.length; i += 2) {
        const left = nodes[i];
        const right = i + 1 < nodes.length ? nodes[i + 1] : this.zeros[level];
        parents.push(this.hasher.hash([left, right]));
      }
      this.layers[level + 1] = parents;
    }
  }
  insert(leaf) {
    this.layers[0].push(BigInt(leaf).toString());
    this._build();
  }
  root() {
    const top = this.layers[this.levels];
    return top.length ? top[0] : this.zeros[this.levels];
  }
  proof(index) {
    const pathElements = [];
    const pathIndices = [];
    let idx = index;
    for (let level = 0; level < this.levels; level++) {
      const isRight = idx % 2;
      pathIndices.push(isRight);
      const siblingIndex = isRight ? idx - 1 : idx + 1;
      const layer = this.layers[level];
      const sibling =
        siblingIndex < layer.length ? layer[siblingIndex] : this.zeros[level];
      pathElements.push(sibling);
      idx = Math.floor(idx / 2);
    }
    return {
      leaf: this.layers[0][index],
      root: this.root(),
      pathElements,
      pathIndices,
    };
  }
}

export async function buildSampleInput() {
  const hasher = await getHasher();
  const note = generateNote();
  const commitment = commitmentHash(hasher, note.nullifier, note.secret);

  const others = [0, 1, 2].map(() => {
    const n = generateNote();
    return commitmentHash(hasher, n.nullifier, n.secret);
  });
  const leaves = [others[0], others[1], commitment, others[2]];
  const ourIndex = 2;

  const tree = new MerkleTree(hasher, LEVELS, leaves);
  const { root, pathElements, pathIndices } = tree.proof(ourIndex);

  const input = {
    root,
    nullifierHash: nullifierHash(hasher, note.nullifier),
    recipient: randomFieldElement().toString(),
    relayer: "0",
    fee: "0",
    nullifier: note.nullifier,
    secret: note.secret,
    pathElements,
    pathIndices,
  };

  return { input, privacySet: leaves.length, commitment };
}
