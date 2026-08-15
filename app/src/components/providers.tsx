"use client";

import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";
import { ClientProvider } from "@solana/react";
import { RPC_URL, WALLET_CHAIN } from "@/lib/cluster";

export const client = createClient()
  .use(walletSigner({ chain: WALLET_CHAIN }))
  .use(solanaRpc({ rpcUrl: RPC_URL as `${string}://${string}` }));

export type AppClient = Awaited<typeof client>;

export function Providers({ children }: { children: React.ReactNode }) {
  return <ClientProvider client={client}>{children}</ClientProvider>;
}
