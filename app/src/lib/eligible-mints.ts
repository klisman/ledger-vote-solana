import type { Address } from "@solana/kit";
import { fetchMaybeMint, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { unwrapOption } from "@/lib/token-amount";

export type EligibleVoteMint = {
  mint: Address;
  tokenProgram: Address;
  amount: bigint;
  decimals: number;
};

type ParsedTokenRow = {
  account: {
    data: {
      parsed?: {
        type?: string;
        info?: {
          mint?: string;
          tokenAmount?: { amount?: string; decimals?: number };
        };
      };
    };
  };
};

type TokenAccountsRpc = {
  getTokenAccountsByOwner: (
    owner: Address,
    filter: { programId: Address },
    config: { encoding: "jsonParsed" },
  ) => { send: () => Promise<{ value: readonly ParsedTokenRow[] }> };
};

export function mintHasConfigFreeze(
  freezeAuthority: Address | null,
  configPda: Address,
): boolean {
  return freezeAuthority === configPda;
}

export function collectUniqueMints(
  holdings: EligibleVoteMint[],
): EligibleVoteMint[] {
  const byMint = new Map<string, EligibleVoteMint>();
  for (const row of holdings) {
    const current = byMint.get(row.mint);
    if (!current || row.amount > current.amount) {
      byMint.set(row.mint, row);
    }
  }
  return [...byMint.values()];
}

function rowsFromParsed(
  value: readonly ParsedTokenRow[],
  tokenProgram: Address,
): EligibleVoteMint[] {
  const out: EligibleVoteMint[] = [];
  for (const row of value) {
    const parsed = row.account.data.parsed;
    if (parsed?.type !== "account" || !parsed.info?.mint) continue;
    const amountRaw = parsed.info.tokenAmount?.amount ?? "0";
    out.push({
      mint: parsed.info.mint as Address,
      tokenProgram,
      amount: BigInt(amountRaw),
      decimals: parsed.info.tokenAmount?.decimals ?? 0,
    });
  }
  return out;
}

export async function listEligibleVoteMints(
  rpc: TokenAccountsRpc & Parameters<typeof fetchMaybeMint>[0],
  owner: Address,
  configPda: Address,
): Promise<EligibleVoteMint[]> {
  const [classic, token2022] = await Promise.all([
    rpc
      .getTokenAccountsByOwner(
        owner,
        { programId: TOKEN_PROGRAM_ADDRESS },
        { encoding: "jsonParsed" },
      )
      .send(),
    rpc
      .getTokenAccountsByOwner(
        owner,
        { programId: TOKEN_2022_PROGRAM_ADDRESS },
        { encoding: "jsonParsed" },
      )
      .send(),
  ]);

  const holdings = collectUniqueMints([
    ...rowsFromParsed(classic.value, TOKEN_PROGRAM_ADDRESS),
    ...rowsFromParsed(token2022.value, TOKEN_2022_PROGRAM_ADDRESS),
  ]);

  const eligible: EligibleVoteMint[] = [];
  for (const row of holdings) {
    try {
      const mintAccount = await fetchMaybeMint(rpc, row.mint);
      if (!mintAccount.exists) continue;
      const freeze = unwrapOption(mintAccount.data.freezeAuthority);
      if (!mintHasConfigFreeze(freeze, configPda)) continue;
      eligible.push(row);
    } catch {
      continue;
    }
  }
  return eligible;
}
