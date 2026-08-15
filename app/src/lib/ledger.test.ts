import { address, getAddressEncoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import idl from "@/idl/ledger_vote.json";
import { concatBytes, encodeAnchorString, u64le } from "@/lib/bytes";
import { decodeConfig, decodePoll } from "@/lib/decode";
import { getCreatePollInstruction } from "@/lib/instructions";
import { voteWeight } from "@/lib/weight";

const encoder = new TextEncoder();
const addr = getAddressEncoder();
const system = address("11111111111111111111111111111111");
const token = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

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
