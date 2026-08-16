import { address, type Address } from "@solana/kit";
import idl from "@/idl/ledger_vote.json";

export type Cluster = "devnet" | "localnet";

export const CLUSTER: Cluster =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet" ? "devnet" : "localnet";

export const VALIDATOR_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  (CLUSTER === "localnet"
    ? "http://127.0.0.1:8899"
    : "https://api.devnet.solana.com");

export const RPC_SUBSCRIPTIONS_URL = (
  CLUSTER === "localnet"
    ? "ws://127.0.0.1:8900"
    : VALIDATOR_RPC_URL.replace(/^http/, "ws")
) as `${string}://${string}`;

/**
 * Localnet JSON-RPC goes through this Next app so a wallet extension cannot
 * redirect getAccountInfo to a public cluster.
 */
export const RPC_URL: `${string}://${string}` =
  CLUSTER === "localnet" && typeof window !== "undefined"
    ? (`${window.location.origin}/solana-rpc` as `${string}://${string}`)
    : (VALIDATOR_RPC_URL as `${string}://${string}`);

export const WALLET_CHAIN = (
  CLUSTER === "localnet" ? "solana:localnet" : "solana:devnet"
) as "solana:devnet" | "solana:localnet";

export const PROGRAM_ID: Address = address(
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? idl.address,
);

export function explorerTx(signature: string): string | null {
  if (CLUSTER === "localnet") return null;
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function shortAddress(value: string, size = 4): string {
  if (value.length <= size * 2 + 1) return value;
  return `${value.slice(0, size)}…${value.slice(-size)}`;
}
