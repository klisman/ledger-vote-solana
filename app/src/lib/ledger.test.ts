import { address, getAddressEncoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import idl from "@/idl/ledger_vote.json";
import { concatBytes, encodeAnchorString, u64le } from "@/lib/bytes";
import { decodeConfig, decodePoll } from "@/lib/decode";
import { formatTxError } from "@/lib/errors";
import { getCreatePollInstruction, getThawVoteInstruction } from "@/lib/instructions";
import { uiAmountToRaw, unwrapOption } from "@/lib/token-amount";
import { voteWeight } from "@/lib/weight";

const encoder = new TextEncoder();
const addr = getAddressEncoder();
const system = address("11111111111111111111111111111111");
const token = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

describe("uiAmountToRaw", () => {
  it("scales whole tokens by decimals", () => {
    expect(uiAmountToRaw("100", 6)).toBe(100_000_000n);
    expect(uiAmountToRaw("1", 0)).toBe(1n);
  });

  it("rejects fractional and empty amounts", () => {
    expect(() => uiAmountToRaw("100.5", 6)).toThrow(/whole number/);
    expect(() => uiAmountToRaw("", 6)).toThrow(/whole number/);
    expect(() => uiAmountToRaw("abc", 6)).toThrow(/whole number/);
  });
});

describe("utf8Len", () => {
  it("counts UTF-8 bytes not JS characters", async () => {
    const { utf8Len } = await import("@/lib/bytes");
    expect(utf8Len("q")).toBe(1);
    expect(utf8Len("é")).toBe(2);
  });
});

describe("unwrapOption", () => {
  it("reads Kit Some / None", () => {
    expect(unwrapOption({ __option: "Some", value: "mint" })).toBe("mint");
    expect(unwrapOption({ __option: "None" })).toBeNull();
  });
});

describe("voteWeight", () => {
  it("matches floor(sqrt) for the README table", () => {
    expect(voteWeight(0n)).toBe(0n);
    expect(voteWeight(1n)).toBe(1n);
    expect(voteWeight(100n)).toBe(10n);
    expect(voteWeight(1_000_000n)).toBe(1_000n);
    expect(voteWeight(1_000_000_000_000n)).toBe(1_000_000n);
    expect(voteWeight(42n)).toBe(6n);
  });
});

describe("account decode", () => {
  it("reads Config after the 8-byte discriminator", () => {
    const disc = Uint8Array.from(
      idl.accounts.find((item) => item.name === "Config")!.discriminator,
    );
    const data = concatBytes(
      disc,
      addr.encode(system),
      addr.encode(token),
      u64le(3n),
      Uint8Array.of(255),
    );
    const config = decodeConfig(data);
    expect(config.pollCount).toBe(3n);
    expect(config.bump).toBe(255);
    expect(config.authority).toBe(system);
    expect(config.voteMint).toBe(token);
  });

  it("trims padded poll question and options", () => {
    const disc = Uint8Array.from(
      idl.accounts.find((item) => item.name === "Poll")!.discriminator,
    );
    const question = new Uint8Array(64);
    question.set(encoder.encode("best color"));
    const options = new Uint8Array(32 * 4);
    options.set(encoder.encode("yes"));
    options.set(encoder.encode("no"), 32);
    const data = concatBytes(
      disc,
      u64le(0n),
      addr.encode(system),
      Uint8Array.of(1),
      question,
      options,
      Uint8Array.of(2),
      u64le(100n),
      u64le(200n),
      Uint8Array.of(1),
      u64le(10n),
      u64le(20n),
      u64le(0n),
      u64le(0n),
    );
    const poll = decodePoll(system, data);
    expect(poll.question).toBe("best color");
    expect(poll.options).toEqual(["yes", "no"]);
    expect(poll.closed).toBe(true);
    expect(poll.tallies).toEqual([10n, 20n]);
  });
});

describe("formatTxError", () => {
  it("unwraps nested Kit simulation logs into program errors", () => {
    expect(
      formatTxError({
        message: "Transaction failed when it was simulated",
        cause: { logs: ["Program log: custom program error: 0x177b"] },
      }),
    ).toBe("Vote mint freeze authority must be the Config PDA");
  });

  it("maps Kit Custom program error: #code from the simulation wrapper", () => {
    const err = new Error(
      "Failed to send transaction: Transaction failed when it was simulated in order to estimate its resource limits. The resource limit estimates provided are for a transaction that failed when simulated and may not be representative of the resources this transaction would consume if successful.",
    );
    err.cause = new Error("Custom program error: #6011");
    expect(formatTxError(err)).toBe(
      "Vote mint freeze authority must be the Config PDA",
    );
  });

  it("does not treat signature replay as already voted", () => {
    expect(formatTxError("This transaction has already been processed")).toBe(
      "That transaction was already processed — try again if nothing changed",
    );
  });
});

describe("create_poll encoding", () => {
  it("starts with the IDL discriminator", () => {
    const ix = getCreatePollInstruction({
      authority: system,
      config: system,
      poll: system,
      question: "q",
      options: ["a", "b"],
      startTs: 1n,
      endTs: 2n,
    });
    const expected = Uint8Array.from(
      idl.instructions.find((item) => item.name === "create_poll")!.discriminator,
    );
    expect([...ix.data!.subarray(0, 8)]).toEqual([...expected]);
    expect(encodeAnchorString("q")[0]).toBe(1);
  });
});

describe("thaw_vote encoding", () => {
  it("starts with the IDL discriminator", () => {
    const ix = getThawVoteInstruction({
      voter: system,
      config: system,
      poll: system,
      voteMint: token,
      voterAta: system,
      voteReceipt: system,
      tokenProgram: token,
    });
    const expected = Uint8Array.from(
      idl.instructions.find((item) => item.name === "thaw_vote")!.discriminator,
    );
    expect([...ix.data!.subarray(0, 8)]).toEqual([...expected]);
  });
});

describe("account catalog", () => {
  it("uses 8 + InitSpace for program PDAs", async () => {
    const {
      CONFIG_SPACE,
      POLL_SPACE,
      RECEIPT_SPACE,
      MINT_SPACE,
      ATA_SPACE,
      ACCOUNT_CATALOG,
    } = await import("@/lib/account-catalog");
    expect(CONFIG_SPACE).toBe(81);
    expect(POLL_SPACE).toBe(291);
    expect(RECEIPT_SPACE).toBe(82);
    expect(MINT_SPACE).toBe(82);
    expect(ATA_SPACE).toBe(165);
    expect(ACCOUNT_CATALOG.config.creatingIx).toBe("initialize");
    expect(ACCOUNT_CATALOG.receipt.creatingIx).toBe("cast_vote");
    expect(ACCOUNT_CATALOG.config.seedsLabel).toBe('["config"]');
    expect(ACCOUNT_CATALOG.config.discriminator).toEqual(
      idl.accounts.find((item) => item.name === "Config")!.discriminator,
    );
  });
});

describe("create voter ATA", () => {
  it("targets the associated token program", async () => {
    const { generateKeyPairSigner } = await import("@solana/kit");
    const { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } = await import(
      "@solana-program/token"
    );
    const { getCreateVoterAtaInstruction } = await import("@/lib/spl");
    const payer = await generateKeyPairSigner();
    const ix = await getCreateVoterAtaInstruction({
      payer,
      owner: payer.address,
      mint: token,
      tokenProgram: token,
    });
    expect(ix.programAddress).toBe(ASSOCIATED_TOKEN_PROGRAM_ADDRESS);
  });
});

describe("eligible vote mints", () => {
  it("keeps mints whose freeze authority is the Config PDA", async () => {
    const { mintHasConfigFreeze, collectUniqueMints } = await import(
      "@/lib/eligible-mints"
    );
    expect(mintHasConfigFreeze(system, system)).toBe(true);
    expect(mintHasConfigFreeze(token, system)).toBe(false);
    expect(mintHasConfigFreeze(null, system)).toBe(false);

    const rows = collectUniqueMints([
      { mint: token, tokenProgram: token, amount: 1n, decimals: 6 },
      { mint: token, tokenProgram: token, amount: 9n, decimals: 6 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(9n);
  });
});

describe("deskStep", () => {
  const base = {
    connected: true,
    programLoaded: true,
    lamports: 1_000_000_000n,
    hasConfig: false,
    isAuthority: false,
    pollCount: 0,
    tokenBalance: null as bigint | null,
    canMint: false,
    hasOpenUnvotedPoll: false,
    canThaw: false,
  };

  it("asks to connect, then fund, then open the book", async () => {
    const { deskStep } = await import("@/lib/desk-step");
    expect(deskStep({ ...base, connected: false })).toBe("connect");
    expect(deskStep({ ...base, lamports: 0n })).toBe("fund");
    expect(deskStep(base)).toBe("open");
  });

  it("walks clerk then voter: first poll, tokens, vote, thaw, board", async () => {
    const { deskStep } = await import("@/lib/desk-step");
    expect(
      deskStep({ ...base, hasConfig: true, isAuthority: true, pollCount: 0 }),
    ).toBe("poll");
    expect(
      deskStep({
        ...base,
        hasConfig: true,
        pollCount: 1,
        hasOpenUnvotedPoll: true,
        tokenBalance: 0n,
        canMint: true,
      }),
    ).toBe("tokens");
    expect(
      deskStep({
        ...base,
        hasConfig: true,
        pollCount: 1,
        hasOpenUnvotedPoll: true,
        tokenBalance: 100n,
      }),
    ).toBe("vote");
    expect(
      deskStep({
        ...base,
        hasConfig: true,
        pollCount: 1,
        tokenBalance: 100n,
        canThaw: true,
      }),
    ).toBe("thaw");
    expect(
      deskStep({
        ...base,
        hasConfig: true,
        pollCount: 1,
        tokenBalance: 100n,
      }),
    ).toBe("board");
  });
});
