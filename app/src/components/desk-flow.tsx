import { useState } from "react";
import type { Address } from "@solana/kit";
import { WeightSeal } from "@/components/weight-seal";
import { CLUSTER, PROGRAM_ID, shortAddress } from "@/lib/cluster";
import type { ConfigAccount, PollAccount, VoteReceiptAccount } from "@/lib/decode";
import type { EligibleVoteMint } from "@/lib/eligible-mints";
import { deskStepCopy, type DeskStep } from "@/lib/desk-step";

type Phase = "scheduled" | "open" | "ended" | "locked";

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <code>{text}</code>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function PollCard({
  poll,
  phase,
  receipt,
  ataFrozen,
  ataAmount,
  isAuthority,
  anotherPollOpen,
  disabled,
  onClose,
  onVote,
  onThaw,
}: {
  poll: PollAccount;
  phase: Phase;
  receipt?: VoteReceiptAccount;
  ataFrozen: boolean;
  ataAmount: bigint | null;
  isAuthority: boolean;
  anotherPollOpen: boolean;
  disabled: boolean;
  onClose: () => void;
  onVote: (choice: number) => void;
  onThaw: () => void;
}) {
  const total = poll.tallies.reduce((sum, n) => sum + n, 0n);
  const canThawThis =
    Boolean(receipt) &&
    ataFrozen &&
    (poll.closed || phase === "ended" || phase === "locked");

  return (
    <article className="sheet poll-card">
      <div className="poll-head">
        <p className="kicker">
          {phase === "open"
            ? "Open"
            : phase === "scheduled"
              ? "Scheduled"
              : phase === "locked"
                ? "Locked"
                : "Ended"}
        </p>
        {isAuthority && !poll.closed ? (
          <button
            type="button"
            className="btn-ghost"
            disabled={disabled}
            onClick={onClose}
          >
            Close voting
          </button>
        ) : null}
      </div>
      <h2>{poll.question || "Untitled"}</h2>
      <p className="hint">
        {new Date(Number(poll.startTs) * 1000).toLocaleString()} →{" "}
        {new Date(Number(poll.endTs) * 1000).toLocaleString()}
      </p>
      <ul className="tally">
        {poll.options.map((option, i) => {
          const weight = poll.tallies[i] ?? 0n;
          const pct = total === 0n ? 0 : Number((weight * 1000n) / total) / 10;
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
                  disabled={disabled || ataAmount == null || ataAmount === 0n}
                  onClick={() => onVote(i)}
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
          You voted for {poll.options[receipt.choice] ?? `option ${receipt.choice + 1}`}{" "}
          with weight {receipt.weight.toString()}.
        </p>
      ) : null}
      {canThawThis ? (
        anotherPollOpen ? (
          <p className="hint">
            Tokens stay frozen while another question is still open.
          </p>
        ) : (
          <button
            type="button"
            className="btn-ghost"
            disabled={disabled}
            onClick={onThaw}
          >
            Unfreeze my tokens
          </button>
        )
      ) : null}
    </article>
  );
}

export function DeskFlow({
  step,
  disabled,
  wallet,
  mintUiAmount,
  onAmount,
  mintInput,
  onMintInput,
  eligibleMints,
  canMint,
  question,
  onQuestion,
  optionFields,
  onOption,
  startLocal,
  endLocal,
  onStart,
  onEnd,
  config,
  isAuthority,
  polls,
  receipts,
  ataAmount,
  ataFrozen,
  focusPoll,
  phaseOf,
  onOpenBook,
  onCreatePoll,
  onMintToWallet,
  onVote,
  onClose,
  onThaw,
}: {
  step: DeskStep;
  disabled: boolean;
  wallet?: Address;
  mintUiAmount: string;
  onAmount: (value: string) => void;
  mintInput: string;
  onMintInput: (value: string) => void;
  eligibleMints: EligibleVoteMint[];
  canMint: boolean;
  question: string;
  onQuestion: (value: string) => void;
  optionFields: string[];
  onOption: (index: number, value: string) => void;
  startLocal: string;
  endLocal: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
  config: ConfigAccount | null;
  isAuthority: boolean;
  polls: PollAccount[];
  receipts: Record<string, VoteReceiptAccount>;
  ataAmount: bigint | null;
  ataFrozen: boolean;
  focusPoll: PollAccount | null;
  phaseOf: (poll: PollAccount) => Phase;
  onOpenBook: () => void;
  onCreatePoll: () => void;
  onMintToWallet: () => void;
  onVote: (poll: PollAccount, choice: number) => void;
  onClose: (poll: PollAccount) => void;
  onThaw: (poll: PollAccount) => void;
}) {
  const copy = deskStepCopy(step);

  return (
    <section className="step">
      <p className="kicker">{copy.mark}</p>
      <h1 className="step-title">{copy.title}</h1>
      <p className="lede">{copy.lede}</p>

      {step === "connect" ? (
        <p className="hint">Use the button in the header.</p>
      ) : null}

      {step === "program" ? (
        <CopyLine
          text={`solana-test-validator --reset --bpf-program ${PROGRAM_ID} target/deploy/ledger_vote.so`}
        />
      ) : null}

      {step === "fund" && wallet ? (
        <CopyLine text={`solana airdrop 100 ${wallet}`} />
      ) : null}

      {step === "open" ? (
        <>
          <label className="field">
            Tokens to keep
            <input
              inputMode="numeric"
              value={mintUiAmount}
              onChange={(e) => onAmount(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-ink"
            disabled={disabled}
            onClick={onOpenBook}
          >
            {mintInput.trim() ? "Use this token and open" : "Create token and open"}
          </button>
          {eligibleMints.length > 0 ? (
            <ul className="mint-pick">
              {eligibleMints.map((row) => (
                <li key={row.mint}>
                  <button
                    type="button"
                    className={mintInput === row.mint ? "btn-brass" : "btn-ghost"}
                    onClick={() => onMintInput(row.mint)}
                  >
                    {shortAddress(row.mint, 4)} · {row.amount.toString()} tokens
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <details className="advanced">
            <summary>I already have a token address</summary>
            <label className="field">
              Token mint
              <input
                value={mintInput}
                onChange={(e) => onMintInput(e.target.value)}
                placeholder="Paste mint address"
                spellCheck={false}
              />
            </label>
          </details>
        </>
      ) : null}

      {step === "poll" ? (
        <>
          <label className="field">
            Question
            <input
              maxLength={64}
              value={question}
              onChange={(e) => onQuestion(e.target.value)}
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
                  onChange={(e) => onOption(i, e.target.value)}
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
                onChange={(e) => onStart(e.target.value)}
              />
            </label>
            <label className="field">
              Closes
              <input
                type="datetime-local"
                value={endLocal}
                onChange={(e) => onEnd(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className="btn-ink"
            disabled={disabled}
            onClick={onCreatePoll}
          >
            Publish question
          </button>
        </>
      ) : null}

      {step === "tokens" ? (
        <>
          {canMint ? (
            <>
              <label className="field">
                Whole tokens
                <input
                  inputMode="numeric"
                  value={mintUiAmount}
                  onChange={(e) => onAmount(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn-brass"
                disabled={disabled}
                onClick={onMintToWallet}
              >
                Add tokens to this wallet
              </button>
            </>
          ) : (
            <p className="hint">
              Ask the clerk who opened this book to send you vote tokens.
              {config
                ? ` Mint ${shortAddress(config.voteMint, 6)}.`
                : ""}
            </p>
          )}
        </>
      ) : null}

      {step === "vote" && focusPoll ? (
        <div className="sheet-row">
          <PollCard
            poll={focusPoll}
            phase={phaseOf(focusPoll)}
            receipt={receipts[focusPoll.address]}
            ataFrozen={ataFrozen}
            ataAmount={ataAmount}
            isAuthority={isAuthority}
            anotherPollOpen={polls.some(
              (item) =>
                item.address !== focusPoll.address &&
                !item.closed &&
                phaseOf(item) === "open",
            )}
            disabled={disabled}
            onClose={() => onClose(focusPoll)}
            onVote={(choice) => onVote(focusPoll, choice)}
            onThaw={() => onThaw(focusPoll)}
          />
          <WeightSeal amount={ataAmount} />
        </div>
      ) : null}

      {step === "thaw" && focusPoll ? (
        <PollCard
          poll={focusPoll}
          phase={phaseOf(focusPoll)}
          receipt={receipts[focusPoll.address]}
          ataFrozen={ataFrozen}
          ataAmount={ataAmount}
          isAuthority={isAuthority}
          anotherPollOpen={false}
          disabled={disabled}
          onClose={() => onClose(focusPoll)}
          onVote={(choice) => onVote(focusPoll, choice)}
          onThaw={() => onThaw(focusPoll)}
        />
      ) : null}

      {step === "board" ? (
        <>
          {isAuthority ? (
            <details className="advanced">
              <summary>Add another question</summary>
              <label className="field">
                Question
                <input
                  maxLength={64}
                  value={question}
                  onChange={(e) => onQuestion(e.target.value)}
                />
              </label>
              <div className="option-grid">
                {optionFields.map((value, i) => (
                  <label key={i} className="field">
                    Option {i + 1}
                    <input
                      maxLength={32}
                      value={value}
                      onChange={(e) => onOption(i, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="btn-ink"
                disabled={disabled}
                onClick={onCreatePoll}
              >
                Publish question
              </button>
            </details>
          ) : null}
          {polls.length === 0 ? (
            <p className="hint">No questions yet.</p>
          ) : (
            polls.map((poll) => (
              <PollCard
                key={poll.address}
                poll={poll}
                phase={phaseOf(poll)}
                receipt={receipts[poll.address]}
                ataFrozen={ataFrozen}
                ataAmount={ataAmount}
                isAuthority={isAuthority}
                anotherPollOpen={polls.some(
                  (item) =>
                    item.address !== poll.address &&
                    !item.closed &&
                    phaseOf(item) === "open",
                )}
                disabled={disabled}
                onClose={() => onClose(poll)}
                onVote={(choice) => onVote(poll, choice)}
                onThaw={() => onThaw(poll)}
              />
            ))
          )}
        </>
      ) : null}

      {CLUSTER === "localnet" && step !== "connect" ? (
        <p className="foot-note">Local network</p>
      ) : null}
    </section>
  );
}
