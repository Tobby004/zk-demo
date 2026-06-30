// test/mixer.test.js — full pool cycle at depth 20.
// Uses your real circuit artifacts in ../../build. Run: npx hardhat test
const { expect } = require("chai");
const path = require("path");
const hre = require("hardhat");
const snarkjs = require("snarkjs");
const { poseidonContract } = require("circomlibjs");
const {
  buildHasher,
  commitmentHash,
  nullifierHash,
  generateNote,
  MerkleTree,
} = require("../../scripts/merkleTree");

const LEVELS = 20;
const WASM = path.join(__dirname, "../../build/withdraw_js/withdraw.wasm");
const ZKEY = path.join(__dirname, "../../build/keys/withdraw_final.zkey");

describe("Mixer", function () {
  it("deposit -> withdraw works; double-spend and bad root rejected", async function () {
    this.timeout(300000);
    const ethers = hre.ethers;
    const [deployer, recipient, depositor] = await ethers.getSigners();
    const DENOM = ethers.parseEther("0.1");
    const hasher = await buildHasher();

    // Poseidon hasher from circomlibjs bytecode.
    const poseidon = await new ethers.ContractFactory(
      poseidonContract.generateABI(2),
      poseidonContract.createCode(2),
      deployer
    ).deploy();
    await poseidon.waitForDeployment();

    const verifier = await (await ethers.getContractFactory("Groth16Verifier")).deploy();
    await verifier.waitForDeployment();

    const mixer = await (await ethers.getContractFactory("Mixer")).deploy(
      await verifier.getAddress(),
      await poseidon.getAddress(),
      DENOM,
      LEVELS
    );
    await mixer.waitForDeployment();

    // Deposit.
    const note = generateNote();
    const commitment = commitmentHash(hasher, note.nullifier, note.secret);
    await mixer.connect(depositor).deposit(commitment, { value: DENOM });

    // Build proof against the on-chain root.
    const tree = new MerkleTree(hasher, LEVELS, [commitment]);
    const { root, pathElements, pathIndices } = tree.proof(0);
    expect((await mixer.getLastRoot()).toString()).to.equal(root);

    const nHash = nullifierHash(hasher, note.nullifier);
    const input = {
      root,
      nullifierHash: nHash,
      recipient: BigInt(recipient.address).toString(),
      relayer: "0",
      fee: "0",
      nullifier: note.nullifier,
      secret: note.secret,
      pathElements,
      pathIndices,
    };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    const argv = JSON.parse(
      "[" + (await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)) + "]"
    );

    // Withdraw pays the recipient the full denomination (fee 0).
    const before = await ethers.provider.getBalance(recipient.address);
    await mixer
      .connect(depositor)
      .withdraw(argv[0], argv[1], argv[2], root, nHash, recipient.address, ethers.ZeroAddress, 0);
    const after = await ethers.provider.getBalance(recipient.address);
    expect(after - before).to.equal(DENOM);
    expect(await ethers.provider.getBalance(await mixer.getAddress())).to.equal(0n);

    // Double-spend rejected.
    await expect(
      mixer
        .connect(depositor)
        .withdraw(argv[0], argv[1], argv[2], root, nHash, recipient.address, ethers.ZeroAddress, 0)
    ).to.be.revertedWith("nullifier already spent");

    // Unknown root rejected. Use a DIFFERENT, unspent nullifier so the check
    // reaches the root test (the contract checks nullifier-spent first).
    await expect(
      mixer
        .connect(depositor)
        .withdraw(argv[0], argv[1], argv[2], 12345678n, 999n, recipient.address, ethers.ZeroAddress, 0)
    ).to.be.revertedWith("unknown merkle root");
  });
});