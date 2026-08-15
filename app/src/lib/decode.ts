import { getAddressDecoder, type Address } from "@solana/kit";
import idl from "@/idl/ledger_vote.json";
import { cstr, readI64le, readU64le } from "@/lib/bytes";

export type ConfigAccount = {
  authority: Address;
  voteMint: Address;
  pollCount: bigint;
  bump: number;
};

export type PollAccount = {
  address: Address;
  id: bigint;
  authority: Address;
  bump: number;
  question: string;
  options: string[];
  optionCount: number;
  startTs: bigint;
  endTs: bigint;
  closed: boolean;
  tallies: bigint[];
};

export type VoteReceiptAccount = {
  poll: Address;
  voter: Address;
  choice: number;
  weight: bigint;
  bump: number;
};

const addressDecoder = getAddressDecoder();

function discOf(name: string): Uint8Array {
  const entry = idl.accounts.find((item) => item.name === name);
  if (!entry) throw new Error(`Missing IDL discriminator for ${name}`);
  return Uint8Array.from(entry.discriminator);
}

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  if (data.length < prefix.length) return false;
  return prefix.every((byte, i) => data[i] === byte);
}

export function decodeConfig(data: Uint8Array): ConfigAccount {
  if (!startsWith(data, discOf("Config"))) {
    throw new Error("Not a Config account");
  }
  let o = 8;
  const authority = addressDecoder.decode(data.subarray(o, o + 32));
  o += 32;
  const voteMint = addressDecoder.decode(data.subarray(o, o + 32));
  o += 32;
  const pollCount = readU64le(data, o);
  o += 8;
  return { authority, voteMint, pollCount, bump: data[o] ?? 0 };
}

export function decodePoll(address: Address, data: Uint8Array): PollAccount {
  if (!startsWith(data, discOf("Poll"))) {
    throw new Error("Not a Poll account");
  }
  let o = 8;
  const id = readU64le(data, o);
  o += 8;
  const authority = addressDecoder.decode(data.subarray(o, o + 32));
  o += 32;
  const bump = data[o] ?? 0;
  o += 1;
  const question = cstr(data.subarray(o, o + 64));
  o += 64;
  const optionSlots: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    optionSlots.push(cstr(data.subarray(o, o + 32)));
    o += 32;
  }
  const optionCount = data[o] ?? 0;
  o += 1;
  const startTs = readI64le(data, o);
  o += 8;
  const endTs = readI64le(data, o);
  o += 8;
  const closed = data[o] === 1;
  o += 1;
  const tallies = [
    readU64le(data, o),
    readU64le(data, o + 8),
    readU64le(data, o + 16),
    readU64le(data, o + 24),
  ];
  return {
    address,
    id,
    authority,
    bump,
    question,
    options: optionSlots.slice(0, optionCount),
    optionCount,
    startTs,
    endTs,
    closed,
    tallies: tallies.slice(0, optionCount),
  };
}

export function decodeVoteReceipt(data: Uint8Array): VoteReceiptAccount {
  if (!startsWith(data, discOf("VoteReceipt"))) {
    throw new Error("Not a VoteReceipt account");
  }
  let o = 8;
  const poll = addressDecoder.decode(data.subarray(o, o + 32));
  o += 32;
  const voter = addressDecoder.decode(data.subarray(o, o + 32));
  o += 32;
  const choice = data[o] ?? 0;
  o += 1;
  const weight = readU64le(data, o);
  o += 8;
  return { poll, voter, choice, weight, bump: data[o] ?? 0 };
}
