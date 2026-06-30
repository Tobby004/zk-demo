// scripts/deploy.js — deploys the full pool.
// Local:   npx hardhat run scripts/deploy.js
// Sepolia: npx hardhat run scripts/deploy.js --network sepolia
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { poseidonContract } = require("circomlibjs");

const LEVELS = 20;
const DENOMINATION = hre.ethers.parseEther("0.1"); // 0.1 testnet ETH

async function main() {
  const ethers = hre.ethers;
  const [deployer] = await ethers.getSigners();
  const net = hre.network.name;

  console.log("Network :", net);
  console.log("Deployer:", deployer.address);
  console.log("Balance :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // 1. Poseidon(2) hasher from circomlibjs bytecode.
  console.log("\nDeploying Poseidon hasher...");
  const hasher = await new ethers.ContractFactory(
    poseidonContract.generateABI(2),
    poseidonContract.createCode(2),
    deployer
  ).deploy();
  await hasher.waitForDeployment();
  const hasherAddr = await hasher.getAddress();
  console.log("  Hasher  :", hasherAddr);

  // 2. Groth16 verifier.
  console.log("Deploying Verifier...");
  const verifier = await (await ethers.getContractFactory("Groth16Verifier")).deploy();
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log("  Verifier:", verifierAddr);

  // 3. Mixer pool.
  console.log("Deploying Mixer...");
  const mixer = await (await ethers.getContractFactory("Mixer")).deploy(
    verifierAddr,
    hasherAddr,
    DENOMINATION,
    LEVELS
  );
  await mixer.waitForDeployment();
  const mixerAddr = await mixer.getAddress();
  console.log("  Mixer   :", mixerAddr);

  // Save addresses for the frontend (Stage 4).
  const out = {
    network: net,
    denomination: DENOMINATION.toString(),
    levels: LEVELS,
    hasher: hasherAddr,
    verifier: verifierAddr,
    mixer: mixerAddr,
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${net}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("\nSaved", file);
  console.log("\nDone. Denomination:", ethers.formatEther(DENOMINATION), "ETH | tree depth:", LEVELS);
}

main().catch((e) => { console.error(e); process.exit(1); });