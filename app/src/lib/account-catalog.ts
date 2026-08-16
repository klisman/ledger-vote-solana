import type { Address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import idl from "@/idl/ledger_vote.json";
import { PROGRAM_ID } from "@/lib/cluster";

export type AccountKind = "mint" | "ata" | "config" | "poll" | "receipt";

export type AccountKindSpec = {
  kind: AccountKind;
  label: string;
  ownerLabel: string;
  defaultOwner: Address;
  seedsLabel: string;
  space: number;
  creatingIx: string;
  discriminator: number[] | null;
};

/** Classic SPL mint: 82 bytes. */
export const MINT_SPACE = 82;

/** Classic SPL token account / ATA: 165 bytes. */
export const ATA_SPACE = 165;

/** 8-byte discriminator + InitSpace for Config. */
export const CONFIG_SPACE = 81;

/** 8-byte discriminator + InitSpace for Poll. */
export const POLL_SPACE = 291;

/** 8-byte discriminator + InitSpace for VoteReceipt. */
export const RECEIPT_SPACE = 82;

function discOf(name: string): number[] {
  const entry = idl.accounts.find((item) => item.name === name);
  if (!entry) throw new Error(`Missing IDL discriminator for ${name}`);
  return entry.discriminator;
}

export const ACCOUNT_CATALOG: Record<AccountKind, AccountKindSpec> = {
  mint: {
    kind: "mint",
    label: "Vote mint",
    ownerLabel: "SPL Token",
    defaultOwner: TOKEN_PROGRAM_ADDRESS,
    seedsLabel: "keypair (not a PDA)",
    space: MINT_SPACE,
    creatingIx: "spl initialize_mint",
    discriminator: null,
  },
  ata: {
    kind: "ata",
    label: "Voter ATA",
    ownerLabel: "SPL Token",
    defaultOwner: TOKEN_PROGRAM_ADDRESS,
    seedsLabel: '["owner", token_program, mint]',
    space: ATA_SPACE,
    creatingIx: "associated_token createIdempotent",
    discriminator: null,
  },
  config: {
    kind: "config",
    label: "Config",
    ownerLabel: "ledger-vote",
    defaultOwner: PROGRAM_ID,
    seedsLabel: '["config"]',
    space: CONFIG_SPACE,
    creatingIx: "initialize",
    discriminator: discOf("Config"),
  },
  poll: {
    kind: "poll",
    label: "Poll",
    ownerLabel: "ledger-vote",
    defaultOwner: PROGRAM_ID,
    seedsLabel: '["poll", poll_id]',
    space: POLL_SPACE,
    creatingIx: "create_poll",
    discriminator: discOf("Poll"),
  },
  receipt: {
    kind: "receipt",
    label: "VoteReceipt",
    ownerLabel: "ledger-vote",
    defaultOwner: PROGRAM_ID,
    seedsLabel: '["vote", poll, voter]',
    space: RECEIPT_SPACE,
    creatingIx: "cast_vote",
    discriminator: discOf("VoteReceipt"),
  },
};
