// lib/stats.js — pool statistics derived purely from on-chain events.
//
// "Effective anonymity set" = deposits that have NOT been withdrawn yet.
// Observers can't tell WHICH deposits were spent, but they can count how many
// were, so unspent = deposits - withdrawals is the honest size of the crowd a
// new withdrawal hides in. (Unique depositors can't be measured: one person
// can deposit from many addresses.)

export const SET_LEVELS = [
  { max: 1, label: "No privacy", tone: "danger", note: "With a single unspent deposit, any withdrawal is trivially linked to it." },
  { max: 10, label: "Weak", tone: "warn", note: "A small crowd. An observer's guess is still a lot better than random." },
  { max: Infinity, label: "Moderate", tone: "ok", note: "A reasonable crowd for a demo pool. Real systems aim for far more." },
];

export function classifySet(unspent) {
  return SET_LEVELS.find((l) => unspent <= l.max) ?? SET_LEVELS[SET_LEVELS.length - 1];
}

// `mixer` is an ethers Contract whose ABI includes the Deposit and Withdrawal
// events. `fromBlock` lets you skip blocks before deployment (faster, and
// friendlier to RPC providers that cap log ranges).
export async function getPoolStats(mixer, fromBlock = 0) {
  const [deposits, withdrawals] = await Promise.all([
    mixer.queryFilter(mixer.filters.Deposit(), fromBlock),
    mixer.queryFilter(mixer.filters.Withdrawal(), fromBlock),
  ]);

  const totalDeposits = deposits.length;
  const totalWithdrawals = withdrawals.length;
  // Guard against a negative number if logs are ever incomplete.
  const unspent = Math.max(0, totalDeposits - totalWithdrawals);

  return {
    totalDeposits,
    totalWithdrawals,
    unspent,
    level: classifySet(unspent),
  };
}