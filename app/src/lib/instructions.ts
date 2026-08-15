import {
  AccountRole,
  type Address,
  type Instruction,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import idl from "@/idl/ledger_vote.json";
import { concatBytes, encodeAnchorString, encodeAnchorVecString, i64le, u8 } from "@/lib/bytes";
import { PROGRAM_ID } from "@/lib/cluster";

function disc(name: string): Uint8Array {
  const ix = idl.instructions.find((item) => item.name === name);
  if (!ix) throw new Error(`Missing IDL instruction ${name}`);
  return Uint8Array.from(ix.discriminator);
}

function meta(
  address: Address,
  role: AccountRole,
): { address: Address; role: AccountRole } {
  return { address, role };
}

export function getInitializeInstruction(accounts: {
  payer: Address;
  config: Address;
  voteMint: Address;
  tokenProgram: Address;
}): Instruction {
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      meta(accounts.payer, AccountRole.WRITABLE_SIGNER),
      meta(accounts.config, AccountRole.WRITABLE),
      meta(accounts.voteMint, AccountRole.READONLY),
      meta(accounts.tokenProgram, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
    ],
    data: disc("initialize"),
  };
}

export function getCreatePollInstruction(input: {
  authority: Address;
  config: Address;
  poll: Address;
  question: string;
  options: string[];
  startTs: bigint;
  endTs: bigint;
}): Instruction {
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      meta(input.authority, AccountRole.WRITABLE_SIGNER),
      meta(input.config, AccountRole.WRITABLE),
      meta(input.poll, AccountRole.WRITABLE),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
    ],
    data: concatBytes(
      disc("create_poll"),
      encodeAnchorString(input.question),
      encodeAnchorVecString(input.options),
      i64le(input.startTs),
      i64le(input.endTs),
    ),
  };
}

export function getCastVoteInstruction(input: {
  voter: Address;
  config: Address;
  poll: Address;
  voterAta: Address;
  voteReceipt: Address;
  tokenProgram: Address;
  choice: number;
}): Instruction {
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      meta(input.voter, AccountRole.WRITABLE_SIGNER),
      meta(input.config, AccountRole.READONLY),
      meta(input.poll, AccountRole.WRITABLE),
      meta(input.voterAta, AccountRole.READONLY),
      meta(input.voteReceipt, AccountRole.WRITABLE),
      meta(input.tokenProgram, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
    ],
    data: concatBytes(disc("cast_vote"), u8(input.choice)),
  };
}

export function getClosePollInstruction(accounts: {
  authority: Address;
  config: Address;
  poll: Address;
}): Instruction {
  return {
    programAddress: PROGRAM_ID,
    accounts: [
      meta(accounts.authority, AccountRole.READONLY_SIGNER),
      meta(accounts.config, AccountRole.READONLY),
      meta(accounts.poll, AccountRole.WRITABLE),
    ],
    data: disc("close_poll"),
  };
}
