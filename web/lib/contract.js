// lib/contract.js — wallet connection and Mixer contract access.
import { BrowserProvider, Contract } from "ethers";
import { MIXER_ADDRESS, SEPOLIA_CHAIN_ID } from "@/lib/config";

export const MIXER_ABI = [
  "function deposit(uint256 commitment) payable",
  "function withdraw(uint[2] a, uint[2][2] b, uint[2] c, uint256 root, uint256 nullifierHash, address recipient, address relayer, uint256 fee)",
  "function denomination() view returns (uint256)",
  "function getLastRoot() view returns (uint256)",
  "function isSpent(uint256 nullifierHash) view returns (bool)",
  "function nextIndex() view returns (uint32)",
  "event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp)",
  "event Withdrawal(address to, uint256 nullifierHash, address indexed relayer, uint256 fee)",
];

export async function connectWallet() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask not found. Install it and refresh.");
  }
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const network = await provider.getNetwork();
  return {
    provider,
    signer,
    address: await signer.getAddress(),
    chainId: network.chainId,
    onSepolia: network.chainId === SEPOLIA_CHAIN_ID,
  };
}

export function getMixer(signerOrProvider) {
  return new Contract(MIXER_ADDRESS, MIXER_ABI, signerOrProvider);
}