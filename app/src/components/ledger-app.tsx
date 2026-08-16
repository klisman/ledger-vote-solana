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
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import type { AppClient } from "@/components/providers";
import { DeskFlow } from "@/components/desk-flow";
import { WalletBar } from "@/components/wallet-bar";
import { CLUSTER, explorerTx, PROGRAM_ID, VALIDATOR_RPC_URL } from "@/lib/cluster";
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
import { listEligibleVoteMints, type EligibleVoteMint } from "@/lib/eligible-mints";
import { deskStep } from "@/lib/desk-step";
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

function tryAddress(raw: string): Address | null {
  try {
    return address(raw);
  } catch {
    return null;
  }
}

async function mintTokenProgram(
  rpc: AppClient["rpc"],
  mint: Address,
): Promise<Address> {
  const account = await fetchEncodedAccount(rpc, mint);
  if (!account.exists) {
    throw new Error(
      `Mint account not found at ${VALIDATOR_RPC_URL} (${CLUSTER}). A public RPC reply (apiVersion 4.x, slot in the hundreds of millions) means the wallet is on mainnet, not this local validator.`,
    );
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
  const [walletLamports, setWalletLamports] = useState<bigint | null>(null);
  const [eligibleMints, setEligibleMints] = useState<EligibleVoteMint[]>([]);
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
    if (wallet) {
      const payer = await fetchEncodedAccount(client.rpc, wallet);
      setWalletLamports(payer.exists ? BigInt(payer.lamports) : 0n);
    } else {
      setWalletLamports(null);
    }
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
      const mintDecoded = await fetchMaybeMint(client.rpc, decoded.voteMint);
      if (mintDecoded.exists) {
        setMintDecimals(mintDecoded.data.decimals);
        setMintAuthority(unwrapOption(mintDecoded.data.mintAuthority));
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
      const pollAddress = pollAddresses[i]!;
      if (account.exists) {
        nextPolls.push(decodePoll(pollAddress, account.data));
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

  useEffect(() => {
    if (config || !wallet || !configPdaAddress) {
      setEligibleMints([]);
      return;
    }
    let cancelled = false;
    void listEligibleVoteMints(client.rpc, wallet, configPdaAddress)
      .then((rows) => {
        if (!cancelled) setEligibleMints(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(formatTxError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client.rpc, config, wallet, configPdaAddress, mintInput]);

  async function run(label: string, build: () => Promise<unknown>) {
    if (wallet && walletLamports === 0n) {
      setError(
        `Connected wallet has 0 SOL on ${CLUSTER}. Airdrop Phantom, not the CLI key: solana airdrop 100 ${wallet}`,
      );
      return;
    }
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

  async function onOpenBook() {
    if (!wallet || !walletSigner || !configPdaAddress) return;
    const existing = tryAddress(mintInput.trim());
    if (existing) {
      await onInitialize();
      return;
    }
    const amount = uiAmountToRaw(mintUiAmount, DEFAULT_MINT_DECIMALS);
    await run("Poll book opened", async () => {
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
        sequentialInstructionPlan([
          createPlan,
          fundPlan,
          getInitializeInstruction({
            payer: wallet,
            config: configPdaAddress,
            voteMint: newMint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
          }),
        ]),
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

  async function onInitialize() {
    if (!wallet || !configPdaAddress) return;
    await run("Poll book opened", async () => {
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
    await run("Question published", async () => {
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
    await run("Voting closed", async () =>
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
    await run("Vote recorded", async () => {
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
    await run("Tokens unfrozen", async () => {
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

  const disabled = busy || send.isRunning;
  const hasOpenUnvotedPoll = polls.some(
    (poll) => phaseOf(poll, now) === "open" && !receipts[poll.address],
  );
  const stillOpen = (poll: PollAccount) =>
    polls.some(
      (item) =>
        item.address !== poll.address &&
        !item.closed &&
        now <= Number(item.endTs),
    );
  const canThaw = Boolean(
    ataFrozen &&
      polls.some(
        (poll) =>
          receipts[poll.address] &&
          (poll.closed || now > Number(poll.endTs)) &&
          !stillOpen(poll),
      ),
  );
  const step = deskStep({
    connected: Boolean(wallet),
    programLoaded,
    lamports: walletLamports,
    hasConfig: Boolean(config),
    isAuthority,
    pollCount: polls.length,
    tokenBalance: ataAmount,
    canMint,
    hasOpenUnvotedPoll,
    canThaw,
  });
  const votePoll =
    polls.find((poll) => phaseOf(poll, now) === "open" && !receipts[poll.address]) ??
    null;
  const thawPoll =
    polls.find(
      (poll) =>
        receipts[poll.address] &&
        ataFrozen &&
        (poll.closed || now > Number(poll.endTs)) &&
        !stillOpen(poll),
    ) ?? null;
  const focusPoll = step === "thaw" ? thawPoll : votePoll;

  return (
    <div className="book">
      <header className="book-head">
        <WalletBar client={client} lamports={walletLamports} />
      </header>
      <DeskFlow
        step={step}
        disabled={disabled}
        wallet={wallet}
        mintUiAmount={mintUiAmount}
        onAmount={setMintUiAmount}
        mintInput={mintInput}
        onMintInput={setMintInput}
        eligibleMints={eligibleMints}
        canMint={canMint}
        question={question}
        onQuestion={setQuestion}
        optionFields={optionFields}
        onOption={(index, value) =>
          setOptionFields((current) =>
            current.map((item, idx) => (idx === index ? value : item)),
          )
        }
        startLocal={startLocal}
        endLocal={endLocal}
        onStart={setStartLocal}
        onEnd={setEndLocal}
        config={config}
        isAuthority={isAuthority}
        polls={polls}
        receipts={receipts}
        ataAmount={ataAmount}
        ataFrozen={ataFrozen}
        focusPoll={focusPoll}
        phaseOf={(poll) => phaseOf(poll, now)}
        onOpenBook={() => void onOpenBook()}
        onCreatePoll={() => void onCreatePoll()}
        onMintToWallet={() => void onMintToWallet()}
        onVote={(poll, choice) => void onVote(poll, choice)}
        onClose={(poll) => void onClose(poll)}
        onThaw={(poll) => void onThaw(poll)}
      />
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
