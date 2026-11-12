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

// Turn ethers' nested errors into something readable. ethers often wraps the
// node's real message ("block range too large", "rate limited", ...) inside a
// generic "could not coalesce error".
export function describeError(e) {
  const nested = e?.info?.error?.message || e?.error?.message || e?.data?.message;
  const top = e?.shortMessage || e?.reason || e?.message || String(e);
  return nested && nested !== top ? `${top} — ${nested}` : top;
}

const MIN_SPAN = 1000; // don't split ranges smaller than this many blocks
const MAX_REQUESTS = 250; // hard cap so a failing node can't be hammered

async function queryRange(contract, filter, from, to, budget) {
  if (budget.left <= 0) throw budget.lastError ?? new Error("Too many RPC retries while reading events");
  budget.left -= 1;
  try {
    return await contract.queryFilter(filter, from, to);
  } catch (e) {
    budget.lastError = e;
    // Can't split any further: surface the real error.
    if (to - from < MIN_SPAN) throw e;
    // Many RPCs reject big ranges or big result sets. Split and retry each half.
    const mid = Math.floor((from + to) / 2);
    const left = await queryRange(contract, filter, from, mid, budget);
    const right = await queryRange(contract, filter, mid + 1, to, budget);
    return left.concat(right);
  }
}

// Fetch all events matching `filter`, from `fromBlock` to the latest block.
// Fast path: one request. If the node rejects it, it adapts by splitting.
export async function fetchEvents(contract, filter, fromBlock = 0) {
  const provider = contract.runner?.provider ?? contract.runner;
  const latest = await provider.getBlockNumber();
  if (fromBlock > latest) return [];
  return queryRange(contract, filter, fromBlock, latest, { left: MAX_REQUESTS, lastError: null });
}

// `mixer` is an ethers Contract whose ABI includes the Deposit and Withdrawal
// events. `fromBlock` lets you skip blocks before deployment.
export async function getPoolStats(mixer, fromBlock = 0) {
  // Sequential on purpose: two parallel log queries can trip rate limits.
  const deposits = await fetchEvents(mixer, mixer.filters.Deposit(), fromBlock);
  const withdrawals = await fetchEvents(mixer, mixer.filters.Withdrawal(), fromBlock);

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