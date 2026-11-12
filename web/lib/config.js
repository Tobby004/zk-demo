// Deployed Sepolia addresses (from onchain/deployments/sepolia.json).
// If you redeploy, update MIXER_ADDRESS here.
export const MIXER_ADDRESS = "0x8377414ed2b56b4A9CD795fE8acb519B6E6A884A";

export const SEPOLIA_CHAIN_ID = 11155111n;
export const LEVELS = 20;

// Block the Mixer was deployed in. Event queries start here instead of block 0,
// which is faster and friendlier to RPC providers that cap log ranges.
// 0 is always correct, just slower. To set it: open the Mixer's contract
// creation transaction on Etherscan and copy its block number.
export const DEPLOY_BLOCK = 0;