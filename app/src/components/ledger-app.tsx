"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  address,
  fetchEncodedAccount,
  fetchEncodedAccounts,
  type Address,
} from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { useClient, useSendTransaction } from "@solana/react";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import type { AppClient } from "@/components/providers";
import { WalletBar } from "@/components/wallet-bar";
import { WeightSeal } from "@/components/weight-seal";
import { CLUSTER, explorerTx, PROGRAM_ID, shortAddress } from "@/lib/cluster";
import { readU64le } from "@/lib/bytes";
import type { ConfigAccount, PollAccount, VoteReceiptAccount } from "@/lib/decode";
import { decodeConfig, decodePoll, decodeVoteReceipt } from "@/lib/decode";
import { formatTxError } from "@/lib/errors";
import {
  getCastVoteInstruction,
  getClosePollInstruction,
  getCreatePollInstruction,
  getInitializeInstruction,
} from "@/lib/instructions";
import { configPda, pollPda, votePda } from "@/lib/pdas";

function toDatetimeLocal(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): bigint {
  return BigInt(Math.floor(new Date(value).getTime() / 1000));
}

function phaseOf(poll: PollAccount, now: number): "scheduled" | "open" | "ended" | "locked" {
  if (poll.closed) return "locked";
  if (now < Number(poll.startTs)) return "scheduled";
  if (now > Number(poll.endTs)) return "ended";
  return "open";
}

function signatureOf(result: unknown): string {
  if (result && typeof result === "object" && "signature" in result) {
    return String((result as { signature: string }).signature);
  }
  return "";
}

async function mintTokenProgram(
  rpc: AppClient["rpc"],
  mint: Address,
): Promise<Address> {
  const account = await fetchEncodedAccount(rpc, mint);
  if (!account.exists) {
    throw new Error("Mint account not found on this cluster");
  }
  const owner = account.programAddress;
  if (owner !== TOKEN_PROGRAM_ADDRESS && owner !== TOKEN_2022_PROGRAM_ADDRESS) {
    throw new Error("That address is not an SPL Token or Token-2022 mint");
  }
  return owner;
}

export function LedgerApp() {
  const client = useClient<AppClient>();
  const connected = useConnectedWallet(client);
  const send = useSendTransaction(client);
  const wallet = connected?.account.address as Address | undefined;

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configPdaAddress, setConfigPdaAddress] = useState<Address | null>(null);
  const [config, setConfig] = useState<ConfigAccount | null>(null);
  const [polls, setPolls] = useState<PollAccount[]>([]);
  const [receipts, setReceipts] = useState<Record<string, VoteReceiptAccount>>({});
  const [ataAmount, setAtaAmount] = useState<bigint | null>(null);
  const [tokenProgram, setTokenProgram] = useState<Address | null>(null);
  const [mintInput, setMintInput] = useState("");
  const [question, setQuestion] = useState("best color");
  const [optionFields, setOptionFields] = useState(["yes", "no", "", ""]);
  const [startLocal, setStartLocal] = useState(() => toDatetimeLocal(Math.floor(Date.now() / 1000)));
  const [endLocal, setEndLocal] = useState(() =>
    toDatetimeLocal(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
  );

  const isAuthority = Boolean(wallet && config && wallet === config.authority);

  const reload = useCallback(async () => {
    setNow(Math.floor(Date.now() / 1000));
    const [pda] = await configPda(PROGRAM_ID);
    setConfigPdaAddress(pda);
    const configAccount = await fetchEncodedAccount(client.rpc, pda);
    if (!configAccount.exists) {
      setConfig(null);
      setPolls([]);
      setReceipts({});
      setAtaAmount(null);
      setTokenProgram(null);
      return;
    }
    const decoded = decodeConfig(configAccount.data);
    setConfig(decoded);
    const program = await mintTokenProgram(client.rpc, decoded.voteMint);
    setTokenProgram(program);

    const count = Number(decoded.pollCount);
    const pollAddresses: Address[] = [];
    for (let i = 0; i < count; i += 1) {
      const [poll] = await pollPda(PROGRAM_ID, BigInt(i));
      pollAddresses.push(poll);
    }
    const pollAccounts =
      pollAddresses.length === 0
        ? []
        : await fetchEncodedAccounts(client.rpc, pollAddresses);
    const nextPolls: PollAccount[] = [];
    pollAccounts.forEach((account, i) => {
      if (account.exists) {
        nextPolls.push(decodePoll(pollAddresses[i]!, account.data));
      }
    });
    setPolls(nextPolls);

    if (!wallet) {
      setAtaAmount(null);
      setReceipts({});
      return;
    }

    const [ata] = await findAssociatedTokenPda({
      owner: wallet,
      mint: decoded.voteMint,
      tokenProgram: program,
    });
    const tokenAccount = await fetchEncodedAccount(client.rpc, ata);
    setAtaAmount(
      tokenAccount.exists && tokenAccount.data.length >= 72
        ? readU64le(tokenAccount.data, 64)
        : null,
    );

    const nextReceipts: Record<string, VoteReceiptAccount> = {};
    for (const poll of nextPolls) {
      const [receipt] = await votePda(PROGRAM_ID, poll.address, wallet);
      const account = await fetchEncodedAccount(client.rpc, receipt);
      if (account.exists) {
        nextReceipts[poll.address] = decodeVoteReceipt(account.data);
      }
    }
    setReceipts(nextReceipts);
  }, [client.rpc, wallet]);

  useEffect(() => {
    reload().catch((err: unknown) => setError(formatTxError(err)));
  }, [reload]);

  async function run(label: string, build: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await build();
      const sig = signatureOf(result);
      setNotice(sig ? `${label} · ${sig}` : label);
      await reload();
    } catch (err) {
      setError(formatTxError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onInitialize() {
    if (!wallet || !configPdaAddress) return;
    await run("Config opened", async () => {
      const mint = address(mintInput.trim());
      const program = await mintTokenProgram(client.rpc, mint);
      return send.dispatchAsync([
        getInitializeInstruction({
          payer: wallet,
          config: configPdaAddress,
          voteMint: mint,
          tokenProgram: program,
        }),
      ]);
    });
  }

  async function onCreatePoll() {
    if (!wallet || !configPdaAddress || !config) return;
    const options = optionFields.map((s) => s.trim()).filter(Boolean);
    await run("Poll entered", async () => {
      const [poll] = await pollPda(PROGRAM_ID, config.pollCount);
      return send.dispatchAsync([
        getCreatePollInstruction({
          authority: wallet,
          config: configPdaAddress,
          poll,
          question: question.trim(),
          options,
          startTs: fromDatetimeLocal(startLocal),
          endTs: fromDatetimeLocal(endLocal),
        }),
      ]);
    });
  }

  async function onClose(poll: PollAccount) {
    if (!wallet || !configPdaAddress) return;
    await run(`Poll ${poll.id} locked`, async () =>
      send.dispatchAsync([
        getClosePollInstruction({
          authority: wallet,
          config: configPdaAddress,
          poll: poll.address,
        }),
      ]),
    );
  }

  async function onVote(poll: PollAccount, choice: number) {
    if (!wallet || !configPdaAddress || !config || !tokenProgram) return;
    await run("Vote frozen", async () => {
      const [ata] = await findAssociatedTokenPda({
        owner: wallet,
        mint: config.voteMint,
        tokenProgram,
      });
      const [receipt] = await votePda(PROGRAM_ID, poll.address, wallet);
      return send.dispatchAsync([
        getCastVoteInstruction({
          voter: wallet,
          config: configPdaAddress,
          poll: poll.address,
          voterAta: ata,
          voteReceipt: receipt,
          tokenProgram,
          choice,
        }),
      ]);
    });
  }

  const explorer = useMemo(() => {
    if (!notice) return null;
    const sig = notice.split(" · ")[1];
    return sig ? explorerTx(sig) : null;
  }, [notice]);

  return (
    <div className="book">
      <header className="book-head">
        <WalletBar client={client} />
        <h1 className="display">The poll book</h1>
        <p className="lede">
          Weight is <span className="formula">floor(√ amount)</span> of the
          Config mint, snapshotted when you sign. Extra tokens still add power;
          a whale cannot linearly dominate the page.
        </p>
      </header>

      {!wallet ? (
        <section className="sheet">
          <h2>Connect a wallet</h2>
          <p>
            This desk talks to {CLUSTER}. Approve each transaction in the
            wallet after you review the accounts.
          </p>
        </section>
      ) : null}

      {wallet && !config ? (
        <section className="sheet">
          <h2>Open the book</h2>
          <p>
            No Config PDA yet. The first signer becomes authority and names the
            vote mint. Create a mint on this cluster first, then paste it here.
          </p>
          <label className="field">
            Vote mint
            <input
              value={mintInput}
              onChange={(e) => setMintInput(e.target.value)}
              placeholder="Mint address"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className="btn-ink"
            disabled={busy || send.isRunning || !mintInput.trim()}
            onClick={() => void onInitialize()}
          >
            Initialize config
          </button>
        </section>
      ) : null}

      {config && configPdaAddress ? (
        <section className="sheet">
          <div className="sheet-row">
            <div>
              <h2>Config</h2>
              <dl className="meta">
                <div>
                  <dt>Authority</dt>
                  <dd className="font-mono">{shortAddress(config.authority, 6)}</dd>
                </div>
                <div>
                  <dt>Vote mint</dt>
                  <dd className="font-mono">{shortAddress(config.voteMint, 6)}</dd>
                </div>
                <div>
                  <dt>Polls</dt>
                  <dd className="font-mono">{config.pollCount.toString()}</dd>
                </div>
                <div>
                  <dt>You</dt>
                  <dd>{isAuthority ? "authority" : "voter"}</dd>
                </div>
              </dl>
            </div>
            <WeightSeal amount={ataAmount} />
          </div>
          {ataAmount === null ? (
            <p className="hint">
              No canonical ATA for this mint. You need an associated token
              account with a positive balance before you can vote.
            </p>
          ) : null}
        </section>
      ) : null}

      {config && isAuthority ? (
        <section className="sheet">
          <h2>Enter a poll</h2>
          <label className="field">
            Question
            <input
              maxLength={64}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <div className="option-grid">
            {optionFields.map((value, i) => (
              <label key={i} className="field">
                Option {i + 1}
                {i < 2 ? "" : " (optional)"}
                <input
                  maxLength={32}
                  value={value}
                  onChange={(e) =>
                    setOptionFields((current) =>
                      current.map((item, idx) => (idx === i ? e.target.value : item)),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <div className="option-grid">
            <label className="field">
              Opens
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
              />
            </label>
            <label className="field">
              Closes
              <input
                type="datetime-local"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className="btn-ink"
            disabled={busy || send.isRunning}
            onClick={() => void onCreatePoll()}
          >
            Create poll
          </button>
        </section>
      ) : null}

      {polls.map((poll) => {
        const phase = phaseOf(poll, now);
        const total = poll.tallies.reduce((sum, n) => sum + n, 0n);
        const receipt = receipts[poll.address];
        return (
          <article key={poll.address} className="sheet poll">
            <div className="poll-head">
              <p className="kicker">
                Poll {poll.id.toString()} · {phase}
              </p>
              {isAuthority && !poll.closed ? (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy || send.isRunning}
                  onClick={() => void onClose(poll)}
                >
                  Lock poll
                </button>
              ) : null}
            </div>
            <h2>{poll.question || "(untitled)"}</h2>
            <p className="hint">
              {new Date(Number(poll.startTs) * 1000).toLocaleString()} →{" "}
              {new Date(Number(poll.endTs) * 1000).toLocaleString()}
            </p>
            <ul className="tally">
              {poll.options.map((option, i) => {
                const weight = poll.tallies[i] ?? 0n;
                const pct =
                  total === 0n ? 0 : Number((weight * 1000n) / total) / 10;
                return (
                  <li key={`${poll.address}-${i}`}>
                    <div className="tally-top">
                      <span>{option}</span>
                      <span className="font-mono">{weight.toString()}</span>
                    </div>
                    <div className="tally-track">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    {phase === "open" && !receipt ? (
                      <button
                        type="button"
                        className="btn-brass"
                        disabled={busy || send.isRunning || !ataAmount}
                        onClick={() => void onVote(poll, i)}
                      >
                        Vote {option}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {receipt ? (
              <p className="hint">
                Your receipt: option {receipt.choice + 1} · weight{" "}
                {receipt.weight.toString()} (frozen)
              </p>
            ) : null}
          </article>
        );
      })}

      {config && polls.length === 0 ? (
        <p className="hint">No polls on this Config yet.</p>
      ) : null}

      {notice ? (
        <p className="notice">
          {notice}
          {explorer ? (
            <>
              {" "}
              <a href={explorer} target="_blank" rel="noreferrer">
                Explorer
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
