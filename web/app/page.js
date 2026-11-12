"use client";

import { useState } from "react";
import * as snarkjs from "snarkjs";
import { connectWallet, getMixer } from "@/lib/contract";
import { MIXER_ADDRESS, DEPLOY_BLOCK } from "@/lib/config";
import { getPoolStats } from "@/lib/stats";
import {
  getHasher,
  generateNote,
  commitmentHash,
  parseNote,
  buildWithdrawInput,
} from "@/lib/zk";
import { formatEther, getAddress, ZeroAddress } from "ethers";

const WASM_URL = "/withdraw.wasm";
const ZKEY_URL = "/withdraw_final.zkey";
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/* ---------- signature visual: a Merkle tree with one hidden glowing path ---------- */
function MerkleArt() {
  const depth = 3; // 8 leaves
  const W = 420, H = 240, padX = 26, padTop = 22, gap = (H - padTop - 24) / depth;
  const nodes = [];
  for (let lvl = 0; lvl <= depth; lvl++) {
    const count = 2 ** lvl;
    for (let i = 0; i < count; i++) {
      const x = padX + ((i + 0.5) * (W - 2 * padX)) / count;
      const y = padTop + lvl * gap;
      nodes.push({ lvl, i, x, y });
    }
  }
  const at = (lvl, i) => nodes.find((n) => n.lvl === lvl && n.i === i);
  // path from leaf 5 to root — "yours", but visually indistinguishable
  const path = new Set(["3-5", "2-2", "1-1", "0-0"]);
  const edges = [];
  for (let lvl = 1; lvl <= depth; lvl++) {
    for (let i = 0; i < 2 ** lvl; i++) {
      const child = at(lvl, i), parent = at(lvl - 1, Math.floor(i / 2));
      const hot = path.has(`${lvl}-${i}`) && path.has(`${lvl - 1}-${Math.floor(i / 2)}`);
      edges.push({ child, parent, hot });
    }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[440px]" role="img" aria-label="A Merkle tree with one anonymous path highlighted to the root">
      <defs>
        <filter id="g"><feGaussianBlur stdDeviation="2.5" /></filter>
      </defs>
      {edges.map((e, k) => (
        <line key={k} x1={e.child.x} y1={e.child.y} x2={e.parent.x} y2={e.parent.y}
          stroke={e.hot ? "var(--color-accent)" : "#243049"} strokeWidth={e.hot ? 1.6 : 1}
          className={e.hot ? "path-pulse" : ""} />
      ))}
      {nodes.map((n, k) => {
        const hot = path.has(`${n.lvl}-${n.i}`);
        const isRoot = n.lvl === 0;
        return (
          <g key={k}>
            {hot && <circle cx={n.x} cy={n.y} r={6} fill="var(--color-accent)" opacity="0.25" filter="url(#g)" className="path-pulse" />}
            <circle cx={n.x} cy={n.y} r={isRoot ? 4.5 : 3.2}
              fill={hot ? "var(--color-accent)" : "#2b3650"}
              stroke={isRoot ? "var(--color-accent-2)" : "transparent"} strokeWidth="1.2" />
          </g>
        );
      })}
      <text x={W - padX} y={padTop - 8} textAnchor="end" fontSize="9" fill="var(--color-muted)" className="font-mono">root</text>
    </svg>
  );
}

function Step({ n, title, body }) {
  return (
    <div className="card rounded-xl p-5">
      <div className="font-mono text-accent text-sm mb-2">0{n}</div>
      <h3 className="font-mono text-base mb-1">{title}</h3>
      <p className="text-sm text-muted leading-relaxed">{body}</p>
    </div>
  );
}

/* ---------- live pool panel: deposits, withdrawals, effective anonymity set ---------- */
// Full class names (not built dynamically) so Tailwind keeps them.
const TONE = {
  danger: { badge: "text-danger border-danger/40 bg-danger/10", dot: "bg-danger" },
  warn: { badge: "text-warn border-warn/40 bg-warn/10", dot: "bg-warn" },
  ok: { badge: "text-accent border-accent/40 bg-accent/10", dot: "bg-accent" },
};

function Stat({ label, value, strong }) {
  return (
    <div>
      <div className="font-mono text-[11px] text-muted mb-1">{label}</div>
      <div className={`font-mono text-2xl ${strong ? "text-accent text-glow" : "text-fg"}`}>{value}</div>
    </div>
  );
}

function PoolPanel({ stats, loading, error, onRefresh }) {
  const tone = stats ? TONE[stats.level.tone] : null;
  // One dot per deposit (capped), teal = still unspent, hollow = already withdrawn.
  const MAX_DOTS = 32;
  const shown = stats ? Math.min(stats.totalDeposits, MAX_DOTS) : 0;
  const spentShown = stats && stats.totalDeposits > 0
    ? Math.round((stats.totalWithdrawals / stats.totalDeposits) * shown)
    : 0;

  return (
    <div className="card rounded-xl p-6 mb-5">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-mono text-lg">Pool</h3>
        <button onClick={onRefresh} disabled={loading}
          className="font-mono text-xs rounded border border-border px-3 py-1.5 hover:border-accent transition disabled:opacity-50">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <p className="font-mono text-xs text-danger">{error}</p>}

      {!stats && !error && <p className="font-mono text-xs text-muted cursor">Reading events from the chain</p>}

      {stats && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-5">
            <Stat label="deposits" value={stats.totalDeposits} />
            <Stat label="withdrawn" value={stats.totalWithdrawals} />
            <Stat label="anonymity set" value={stats.unspent} strong />
          </div>

          {shown > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-5" aria-label={`${stats.unspent} of ${stats.totalDeposits} deposits unspent`}>
              {Array.from({ length: shown }).map((_, i) => {
                const spent = i < spentShown;
                return (
                  <span key={i}
                    className={`h-2.5 w-2.5 rounded-full border ${spent ? "border-border bg-transparent" : "border-accent bg-accent"}`} />
                );
              })}
              {stats.totalDeposits > MAX_DOTS && <span className="font-mono text-[10px] text-muted ml-1">+{stats.totalDeposits - MAX_DOTS} more</span>}
            </div>
          )}

          <div className={`rounded-lg border p-3 ${tone.badge}`}>
            <p className="font-mono text-xs mb-1">{stats.level.label.toUpperCase()}</p>
            <p className="text-xs text-muted leading-relaxed">{stats.level.note}</p>
          </div>

          <p className="font-mono text-[11px] text-muted mt-4 leading-relaxed">
            anonymity set = deposits not yet withdrawn. Observers can&apos;t tell which deposits were spent,
            only how many, so this is the real size of the crowd a new withdrawal hides in.
          </p>
        </>
      )}
    </div>
  );
}

export default function Home() {
  const [wallet, setWallet] = useState(null);
  const [denom, setDenom] = useState(null);

  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [txHash, setTxHash] = useState(null);

  const [wNote, setWNote] = useState("");
  const [recipient, setRecipient] = useState("");
  const [wStatus, setWStatus] = useState("");
  const [wBusy, setWBusy] = useState(false);
  const [wTx, setWTx] = useState(null);

  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");

  async function loadStats(w = wallet) {
    if (!w || !w.onSepolia) return;
    setStatsLoading(true);
    setStatsError("");
    try {
      setStats(await getPoolStats(getMixer(w.provider), DEPLOY_BLOCK));
    } catch (e) {
      setStatsError("Could not load pool stats: " + (e?.shortMessage || e?.message || String(e)));
    } finally {
      setStatsLoading(false);
    }
  }

  async function onConnect() {
    try {
      const w = await connectWallet();
      setWallet(w);
      // Only talk to the contract once we know we're on Sepolia; on any other
      // chain there is no contract at this address and the call would fail.
      if (w.onSepolia) {
        setDenom(await getMixer(w.provider).denomination());
        loadStats(w);
      }
    } catch (e) {
      setStatus("Error: " + (e?.message || String(e)));
    }
  }

  async function onDeposit() {
    setBusy(true); setStatus(""); setNote(null); setTxHash(null);
    try {
      const hasher = await getHasher();
      const n = generateNote();
      const commitment = commitmentHash(hasher, n.nullifier, n.secret);
      setStatus("Sending deposit — confirm in MetaMask");
      const tx = await getMixer(wallet.signer).deposit(commitment, { value: denom });
      setStatus("Waiting for confirmation");
      await tx.wait();
      setNote({
        string: `${n.nullifier}-${n.secret}`,
        json: { v: 1, network: "sepolia", mixer: MIXER_ADDRESS, nullifier: n.nullifier, secret: n.secret, commitment },
      });
      setTxHash(tx.hash);
      setStatus("Deposit confirmed");
      loadStats();
    } catch (e) {
      setStatus("Error: " + (e?.reason || e?.message || String(e)));
    } finally { setBusy(false); }
  }

  function downloadNote() {
    const blob = new Blob([JSON.stringify(note.json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `zkmixer-note-${note.json.commitment.slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  async function onWithdraw() {
    setWBusy(true); setWStatus(""); setWTx(null);
    try {
      const parsed = parseNote(wNote);
      const recipientAddr = getAddress(recipient.trim());
      const mixer = getMixer(wallet.signer);

      setWStatus("Reading deposits from the chain");
      const events = await mixer.queryFilter(mixer.filters.Deposit(), DEPLOY_BLOCK);
      const ordered = events
        .map((e) => ({ leafIndex: Number(e.args.leafIndex), commitment: e.args.commitment.toString() }))
        .sort((a, b) => a.leafIndex - b.leafIndex);
      const leaves = ordered.map((o) => o.commitment);

      setWStatus("Building Merkle proof and zero-knowledge proof");
      const recipientField = BigInt(recipientAddr).toString();
      const { input, root } = await buildWithdrawInput(leaves, parsed, recipientField, "0", "0");

      if (await mixer.isSpent(input.nullifierHash)) throw new Error("This note has already been withdrawn.");

      const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_URL, ZKEY_URL);
      const argv = JSON.parse("[" + (await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)) + "]");

      setWStatus("Submitting withdrawal — confirm in MetaMask");
      const tx = await mixer.withdraw(argv[0], argv[1], argv[2], root, input.nullifierHash, recipientAddr, ZeroAddress, 0);
      setWStatus("Waiting for confirmation");
      await tx.wait();
      setWTx(tx.hash);
      setWStatus("Withdrawal confirmed — funds sent");
      loadStats();
    } catch (e) {
      setWStatus("Error: " + (e?.reason || e?.message || String(e)));
    } finally { setWBusy(false); }
  }

  const wrongNet = wallet && !wallet.onSepolia;

  return (
    <div className="min-h-screen bg-ink text-fg">
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-border bg-ink/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono">
            <span className="inline-block h-2 w-2 rounded-full bg-accent text-glow" />
            <span className="font-medium tracking-tight">zk-mixer</span>
            <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">SEPOLIA · TESTNET</span>
          </div>
          {wallet ? (
            <span className="font-mono text-xs rounded-md border border-border px-3 py-1.5 text-muted">{short(wallet.address)}</span>
          ) : (
            <button onClick={onConnect} className="btn-accent font-mono text-sm rounded-md px-4 py-1.5 transition">Connect wallet</button>
          )}
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-grid" />
        <div className="absolute inset-0 glow-radial" />
        <div className="relative mx-auto max-w-5xl px-5 py-20 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p className="font-mono text-xs text-accent mb-4">ZERO-KNOWLEDGE · GROTH16 · POSEIDON</p>
            <h1 className="font-mono text-3xl sm:text-4xl leading-tight mb-4">
              Prove you own a deposit<br /><span className="text-accent text-glow">without revealing which one.</span>
            </h1>
            <p className="text-muted max-w-md leading-relaxed mb-8">
              A fixed-denomination shielded pool. Deposit behind a secret note, then withdraw
              to any address with a proof that links to nothing. Educational, Sepolia testnet, no real funds.
            </p>
            <a href="#app" className="btn-accent inline-block font-mono text-sm rounded-md px-5 py-2.5 transition">Launch app ↓</a>
          </div>
          <div className="flex justify-center md:justify-end">
            <MerkleArt />
          </div>
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-5xl px-5 py-16">
        <h2 className="font-mono text-sm text-muted mb-6">HOW IT WORKS</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <Step n={1} title="Deposit" body="Send the fixed amount with a commitment. You get back a secret note — the only key to your funds." />
          <Step n={2} title="Wait" body="Let other deposits land. Your withdrawal hides among them — the more deposits, the stronger the privacy." />
          <Step n={3} title="Withdraw" body="Prove membership in zero knowledge, in your browser. Funds go to any address, unlinked from the deposit." />
        </div>
      </section>

      {/* app */}
      <section id="app" className="mx-auto max-w-5xl px-5 pb-24">
        <h2 className="font-mono text-sm text-muted mb-6">APP</h2>

        {!wallet && (
          <div className="card rounded-xl p-8 text-center">
            <p className="text-muted mb-4">Connect a wallet on Sepolia to deposit or withdraw.</p>
            <button onClick={onConnect} className="btn-accent font-mono text-sm rounded-md px-5 py-2.5 transition">Connect wallet</button>
          </div>
        )}

        {wrongNet && (
          <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 mb-6 font-mono text-sm text-warn">
            Wrong network. Switch MetaMask to Sepolia, then reconnect.
          </div>
        )}

        {wallet && !wrongNet && (
          <>
            <PoolPanel stats={stats} loading={statsLoading} error={statsError} onRefresh={() => loadStats()} />

            <div className="grid md:grid-cols-2 gap-5">
              {/* DEPOSIT */}
              <div className="card rounded-xl p-6">
                <div className="flex items-baseline justify-between mb-5">
                  <h3 className="font-mono text-lg">Deposit</h3>
                  <span className="font-mono text-sm text-accent">{denom ? formatEther(denom) : "—"} ETH</span>
                </div>
                <button onClick={onDeposit} disabled={busy}
                  className={`w-full font-mono text-sm rounded-md py-3 transition ${busy ? "bg-surface-2 text-muted" : "btn-accent"}`}>
                  {busy ? "Working…" : `Deposit ${denom ? formatEther(denom) : ""} ETH`}
                </button>
                {status && <p className={`font-mono text-xs mt-4 ${status.startsWith("Error") ? "text-danger" : "text-muted cursor"}`}>{status}</p>}

                {note && (
                  <div className="mt-5 rounded-lg border border-warn/40 bg-warn/5 p-4">
                    <p className="font-mono text-xs text-warn mb-2">⚠ SAVE THIS NOTE — the only key to withdraw</p>
                    <textarea readOnly value={note.string} onFocus={(e) => e.target.select()}
                      className="w-full h-14 bg-surface-2 border border-border rounded p-2 font-mono text-[11px] text-fg resize-none" />
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => navigator.clipboard.writeText(note.string)} className="font-mono text-xs rounded border border-border px-3 py-1.5 hover:border-accent transition">Copy</button>
                      <button onClick={downloadNote} className="font-mono text-xs rounded border border-border px-3 py-1.5 hover:border-accent transition">Download</button>
                    </div>
                    {txHash && <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" className="block font-mono text-xs text-accent mt-3 hover:underline">view on Etherscan ↗</a>}
                  </div>
                )}
              </div>

              {/* WITHDRAW */}
              <div className="card rounded-xl p-6">
                <div className="flex items-baseline justify-between mb-5">
                  <h3 className="font-mono text-lg">Withdraw</h3>
                  {stats && <span className="font-mono text-xs text-muted">anonymity set: <span className="text-accent">{stats.unspent}</span></span>}
                </div>
                <label className="block font-mono text-xs text-muted mb-1">note</label>
                <textarea value={wNote} onChange={(e) => setWNote(e.target.value)} placeholder="<nullifier>-<secret>"
                  className="w-full h-14 bg-surface-2 border border-border rounded p-2 font-mono text-[11px] mb-3 resize-none focus:border-accent outline-none" />
                <label className="block font-mono text-xs text-muted mb-1">recipient</label>
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x… any address"
                  className="w-full bg-surface-2 border border-border rounded p-2 font-mono text-xs mb-4 focus:border-accent outline-none" />
                <button onClick={onWithdraw} disabled={wBusy}
                  className={`w-full font-mono text-sm rounded-md py-3 transition ${wBusy ? "bg-surface-2 text-muted" : "btn-accent"}`}>
                  {wBusy ? "Proving…" : "Generate proof & withdraw"}
                </button>
                {wStatus && <p className={`font-mono text-xs mt-4 ${wStatus.startsWith("Error") ? "text-danger" : "text-muted cursor"}`}>{wStatus}</p>}
                {wTx && <a href={`https://sepolia.etherscan.io/tx/${wTx}`} target="_blank" rel="noreferrer" className="block font-mono text-xs text-accent mt-3 hover:underline">view on Etherscan ↗</a>}
              </div>
            </div>
          </>
        )}
      </section>

      {/* footer */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-5 py-8 text-xs text-muted font-mono space-y-2">
          <p>Educational · testnet-only · unaudited · not for real funds · not legal or financial advice.</p>
          <p>
            Pool contract:{" "}
            <a href={`https://sepolia.etherscan.io/address/${MIXER_ADDRESS}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">{short(MIXER_ADDRESS)} ↗</a>
          </p>
        </div>
      </footer>
    </div>
  );
}