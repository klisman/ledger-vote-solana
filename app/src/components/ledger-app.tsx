"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  address,
  fetchEncodedAccount,
  fetchEncodedAccounts,
  generateKeyPairSigner,
  sequentialInstructionPlan,
  type Address,
} from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { useClient, useSendTransaction } from "@solana/react";
import {
  findAssociatedTokenPda,
  fetchMaybeMint,
  getCreateMintInstructionPlan,
  getMintToATAInstructionPlanAsync,
  getSetAuthorityInstruction,
  AuthorityType,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import type { AppClient } from "@/components/providers";
import { MintDesk } from "@/components/mint-desk";
import { WalletBar } from "@/components/wallet-bar";
import { WeightSeal } from "@/components/weight-seal";
import { CLUSTER, explorerTx, PROGRAM_ID, shortAddress } from "@/lib/cluster";
import { readU64le, utf8Len } from "@/lib/bytes";
import type { ConfigAccount, PollAccount, VoteReceiptAccount } from "@/lib/decode";
import { decodeConfig, decodePoll, decodeVoteReceipt } from "@/lib/decode";
import { formatTxError } from "@/lib/errors";
import {
  getCastVoteInstruction,
  getClosePollInstruction,
  getCreatePollInstruction,
  getInitializeInstruction,
  getThawVoteInstruction,
} from "@/lib/instructions";
import { configPda, pollPda, votePda } from "@/lib/pdas";
import { useMounted } from "@/lib/use-mounted";
import {
  DEFAULT_MINT_DECIMALS,
  DEFAULT_MINT_UI_AMOUNT,
  uiAmountToRaw,
  unwrapOption,
} from "@/lib/token-amount";

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
  const mounted = useMounted();
  const wallet = mounted
    ? (connected?.account.address as Address | undefined)
    : undefined;

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configPdaAddress, setConfigPdaAddress] = useState<Address | null>(null);
  const [config, setConfig] = useState<ConfigAccount | null>(null);
  const [polls, setPolls] = useState<PollAccount[]>([]);
  const [receipts, setReceipts] = useState<Record<string, VoteReceiptAccount>>({});
  const [ataAmount, setAtaAmount] = useState<bigint | null>(null);
  const [ataFrozen, setAtaFrozen] = useState(false);
  const [programLoaded, setProgramLoaded] = useState(true);
  const [tokenProgram, setTokenProgram] = useState<Address | null>(null);
  const [mintAuthority, setMintAuthority] = useState<Address | null>(null);
  const [mintDecimals, setMintDecimals] = useState(DEFAULT_MINT_DECIMALS);
  const [mintUiAmount, setMintUiAmount] = useState(DEFAULT_MINT_UI_AMOUNT);
  const [mintInput, setMintInput] = useState("");
  const [question, setQuestion] = useState("best color");
  const [optionFields, setOptionFields] = useState(["yes", "no", "", ""]);
  const [startLocal, setStartLocal] = useState(() => toDatetimeLocal(Math.floor(Date.now() / 1000)));
  const [endLocal, setEndLocal] = useState(() =>
    toDatetimeLocal(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
  );

  const isAuthority = Boolean(wallet && config && wallet === config.authority);
  const walletSigner = connected?.signer ?? null;
  const canMint = Boolean(
    wallet && walletSigner && mintAuthority && wallet === mintAuthority,
  );

  const reload = useCallback(async () => {
    setNow(Math.floor(Date.now() / 1000));
    const [pda] = await configPda(PROGRAM_ID);
    setConfigPdaAddress(pda);
    const programAccount = await fetchEncodedAccount(client.rpc, PROGRAM_ID);
    setProgramLoaded(programAccount.exists);
    const configAccount = await fetchEncodedAccount(client.rpc, pda);
    if (!configAccount.exists) {
      setConfig(null);
      setPolls([]);
      setReceipts({});
      setAtaAmount(null);
      setAtaFrozen(false);
      setTokenProgram(null);
      setMintAuthority(null);
      return;
    }
    const decoded = decodeConfig(configAccount.data);
    setConfig(decoded);
    const program = await mintTokenProgram(client.rpc, decoded.voteMint);
    setTokenProgram(program);
    try {
      const mintAccount = await fetchMaybeMint(client.rpc, decoded.voteMint);
      if (mintAccount.exists) {
        setMintDecimals(mintAccount.data.decimals);
        setMintAuthority(unwrapOption(mintAccount.data.mintAuthority));
      } else {
        setMintAuthority(null);
      }
    } catch {
      setMintAuthority(null);
    }

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
      setAtaFrozen(false);
      setReceipts({});
      return;
    }

    const [ata] = await findAssociatedTokenPda({
      owner: wallet,
      mint: decoded.voteMint,
      tokenProgram: program,
    });
    const tokenAccount = await fetchEncodedAccount(client.rpc, ata);
    const hasAta = tokenAccount.exists && tokenAccount.data.length >= 72;
    setAtaAmount(hasAta ? readU64le(tokenAccount.data, 64) : null);
    setAtaFrozen(hasAta && tokenAccount.data.length > 108 && tokenAccount.data[108] === 2);

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

  useEffect(() => {
    if (config) return;
    const raw = mintInput.trim();
    if (!raw) {
      setMintAuthority(null);
      setMintDecimals(DEFAULT_MINT_DECIMALS);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const mint = address(raw);
        const mintAccount = await fetchMaybeMint(client.rpc, mint);
        if (cancelled) return;
        if (mintAccount.exists) {
          setMintDecimals(mintAccount.data.decimals);
          setMintAuthority(unwrapOption(mintAccount.data.mintAuthority));
          const program = await mintTokenProgram(client.rpc, mint);
          if (!cancelled) setTokenProgram(program);
        } else {
          setMintAuthority(null);
          setTokenProgram(null);
        }
      } catch {
        if (!cancelled) {
          setMintAuthority(null);
          setTokenProgram(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client.rpc, config, mintInput]);

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

  async function onCreateMintAndFund() {
    if (!wallet || !walletSigner || !configPdaAddress) return;
    const amount = uiAmountToRaw(mintUiAmount, DEFAULT_MINT_DECIMALS);
    await run("Mint created", async () => {
      const newMint = await generateKeyPairSigner();
      const createPlan = await getCreateMintInstructionPlan(
        {
          getMinimumBalance: async (space: number) =>
            client.rpc.getMinimumBalanceForRentExemption(BigInt(space)).send(),
        },
        {
          payer: walletSigner,
          newMint,
          decimals: DEFAULT_MINT_DECIMALS,
          mintAuthority: wallet,
          freezeAuthority: configPdaAddress,
        },
      );
      const fundPlan = await getMintToATAInstructionPlanAsync({
        payer: walletSigner,
        mint: newMint.address,
        owner: wallet,
        mintAuthority: walletSigner,
        amount,
        decimals: DEFAULT_MINT_DECIMALS,
      });
      const result = await send.dispatchAsync(
        sequentialInstructionPlan([createPlan, fundPlan]),
      );
      setMintInput(newMint.address);
      return result;
    });
  }

  async function onMintToWallet() {
    if (!wallet || !walletSigner) return;
    const mint = config?.voteMint ?? address(mintInput.trim());
    const program = tokenProgram ?? (await mintTokenProgram(client.rpc, mint));
    const amount = uiAmountToRaw(mintUiAmount, mintDecimals);
    await run("Tokens minted", async () =>
      send.dispatchAsync(
        await getMintToATAInstructionPlanAsync(
          {
            payer: walletSigner,
            mint,
            owner: wallet,
            mintAuthority: walletSigner,
            amount,
            decimals: mintDecimals,
          },
          { tokenProgram: program },
        ),
      ),
    );
  }

  async function onRevokeMintAuthority() {
    if (!walletSigner || !config || !tokenProgram) return;
    await run("Mint authority revoked", async () =>
      send.dispatchAsync([
        getSetAuthorityInstruction(
          {
            owned: config.voteMint,
            owner: walletSigner,
            authorityType: AuthorityType.MintTokens,
            newAuthority: null,
          },
          { programAddress: tokenProgram },
        ),
      ]),
    );
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
    if (utf8Len(question.trim()) === 0 || utf8Len(question.trim()) > 64) {
      setError("Question must be 1–64 bytes (UTF-8)");
      return;
    }
    if (options.length < 2 || options.length > 4) {
      setError("A poll needs 2–4 options");
      return;
    }
    if (options.some((item) => utf8Len(item) === 0 || utf8Len(item) > 32)) {
      setError("Each option must be 1–32 bytes (UTF-8)");
      return;
    }
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
          voteMint: config.voteMint,
          voterAta: ata,
          voteReceipt: receipt,
          tokenProgram,
          choice,
        }),
      ]);
    });
  }

  async function onThaw(poll: PollAccount) {
    if (!wallet || !configPdaAddress || !config || !tokenProgram) return;
    await run("ATA thawed", async () => {
      const [ata] = await findAssociatedTokenPda({
        owner: wallet,
        mint: config.voteMint,
        tokenProgram,
      });
      const [receipt] = await votePda(PROGRAM_ID, poll.address, wallet);
      return send.dispatchAsync([
        getThawVoteInstruction({
          voter: wallet,
          config: configPdaAddress,
          poll: poll.address,
          voteMint: config.voteMint,
          voterAta: ata,
          voteReceipt: receipt,
          tokenProgram,
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
          Config mint, snapshotted when you sign. The voter ATA is frozen so
          the same pile cannot be transferred and voted again.
        </p>
      </header>

      {!programLoaded ? (
        <p className="error">
          Program {shortAddress(PROGRAM_ID, 6)} is not on {CLUSTER}. For
          localnet, load target/deploy/ledger_vote.so at the declare_id
          address (do not anchor keys sync).
        </p>
      ) : null}

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
        <>
          <MintDesk
            amount={mintUiAmount}
            onAmount={setMintUiAmount}
            busy={busy || send.isRunning}
            canCreate={Boolean(walletSigner)}
            canMint={canMint}
            mintAuthority={mintAuthority}
            wallet={wallet}
            onCreate={() => void onCreateMintAndFund()}
            onMint={() => void onMintToWallet()}
          />
          <section className="sheet">
            <h2>Open the book</h2>
            <p>
              No Config PDA yet. The first signer becomes authority for this
              program id. The mint’s freeze authority must be the Config PDA
              (the create-mint button sets that).
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
        </>
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
              No canonical ATA for this mint. Fund it before initialize, or
              transfer tokens from a wallet that already holds them.
            </p>
          ) : null}
          {canMint ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy || send.isRunning}
              onClick={() => void onRevokeMintAuthority()}
            >
              Revoke mint authority
            </button>
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
        const anotherPollOpen = polls.some(
          (item) =>
            item.address !== poll.address &&
            !item.closed &&
            now <= Number(item.endTs),
        );
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
                        disabled={
                          busy ||
                          send.isRunning ||
                          ataAmount == null ||
                          ataAmount === 0n
                        }
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
                {receipt.weight.toString()} (ATA frozen until this poll is
                locked or ended)
              </p>
            ) : null}
            {receipt &&
            ataFrozen &&
            (poll.closed || now > Number(poll.endTs)) ? (
              anotherPollOpen ? (
                <p className="hint">
                  Tokens stay frozen while another poll is still open, so the
                  same pile cannot be moved and voted again.
                </p>
              ) : (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy || send.isRunning}
                  onClick={() => void onThaw(poll)}
                >
                  Thaw my vote tokens
                </button>
              )
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
