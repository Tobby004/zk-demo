"use client";

import { useState } from "react";
import * as snarkjs from "snarkjs";
import { buildSampleInput } from "@/lib/zk";

const WASM_URL = "/withdraw.wasm";
const ZKEY_URL = "/withdraw_final.zkey";
const VKEY_URL = "/verification_key.json";

const SIGNAL_NAMES = ["root", "nullifierHash", "recipient", "relayer", "fee"];

export default function Home() {
  const [status, setStatus] = useState("idle");
  const [log, setLog] = useState([]);
  const [proof, setProof] = useState(null);
  const [publicSignals, setPublicSignals] = useState(null);
  const [verified, setVerified] = useState(null);
  const [privacySet, setPrivacySet] = useState(null);
  const [ms, setMs] = useState(null);

  const push = (m) => setLog((l) => [...l, m]);

  async function run() {
    setStatus("running");
    setLog([]);
    setProof(null);
    setPublicSignals(null);
    setVerified(null);
    const t0 = performance.now();
    try {
      push("Building sample deposit + Merkle proof...");
      const { input, privacySet } = await buildSampleInput();
      setPrivacySet(privacySet);

      push("Generating zero-knowledge proof in your browser...");
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        WASM_URL,
        ZKEY_URL
      );
      setProof(proof);
      setPublicSignals(publicSignals);

      push("Verifying proof...");
      const vKey = await (await fetch(VKEY_URL)).json();
      const ok = await snarkjs.groth16.verify(vKey, publicSignals, proof);
      setVerified(ok);
      setMs(Math.round(performance.now() - t0));
      push(ok ? "Done." : "Verification FAILED.");
      setStatus("done");
    } catch (e) {
      console.error(e);
      push("Error: " + (e?.message || String(e)));
      setStatus("error");
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ marginBottom: 4 }}>zk-mixer — in-browser proving</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Stage 2 demo. Generates and verifies a Groth16 membership proof entirely
        in your browser. No blockchain, no real funds — educational, testnet-only.
      </p>

      <button
        onClick={run}
        disabled={status === "running"}
        style={{ padding: "10px 18px", fontSize: 16, cursor: status === "running" ? "default" : "pointer", borderRadius: 8, border: "1px solid #333", background: status === "running" ? "#eee" : "#111", color: status === "running" ? "#999" : "#fff" }}
      >
        {status === "running" ? "Proving..." : "Generate & verify a proof"}
      </button>

      {privacySet != null && (
        <p style={{ marginTop: 16 }}>
          Privacy set (deposits in this demo tree): <b>{privacySet}</b>
        </p>
      )}

      {log.length > 0 && (
        <pre style={{ background: "#f5f5f5", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap" }}>
          {log.join("\n")}
        </pre>
      )}

      {verified != null && (
        <div style={{ marginTop: 16, padding: 16, borderRadius: 8, background: verified ? "#e8f7ee" : "#fdeaea", border: `1px solid ${verified ? "#9ad7b3" : "#e3a3a3"}` }}>
          <b style={{ fontSize: 18 }}>
            {verified ? "\u2713 Proof verified" : "\u2717 Proof did NOT verify"}
          </b>
          {ms != null && <span style={{ color: "#666" }}> &nbsp;({ms} ms)</span>}
        </div>
      )}

      {publicSignals && (
        <>
          <h3>Public signals</h3>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {publicSignals.map((v, i) => (
                <tr key={i}>
                  <td style={{ padding: "4px 12px 4px 0", color: "#666" }}>
                    {SIGNAL_NAMES[i] ?? `signal ${i}`}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" }}>
                    {v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {proof && (
        <>
          <h3>Proof</h3>
          <pre style={{ background: "#f5f5f5", padding: 12, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
            {JSON.stringify(proof, null, 2)}
          </pre>
        </>
      )}
    </main>
  );
}
