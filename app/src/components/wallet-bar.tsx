"use client";

import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  WalletReadyGate,
} from "@solana/kit-plugin-wallet/react";
import type { AppClient } from "@/components/providers";
import { CLUSTER, shortAddress } from "@/lib/cluster";

function WalletButtons({ client }: { client: AppClient }) {
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const connect = useConnect(client);
  const disconnect = useDisconnect(client);

  if (connected) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-mono text-sm tracking-tight">
          {shortAddress(connected.account.address, 6)}
        </p>
        <button
          type="button"
          className="btn-ghost"
          disabled={disconnect.isRunning}
          onClick={() => disconnect.dispatch()}
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-soft)]">
        No Wallet Standard wallet found. Install Phantom or Solflare, then
        refresh.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {wallets.map((wallet) => (
        <button
          key={wallet.name}
          type="button"
          className="btn-brass"
          disabled={connect.isRunning}
          onClick={() => connect.dispatch(wallet)}
        >
          Connect {wallet.name}
        </button>
      ))}
    </div>
  );
}

export function WalletBar({ client }: { client: AppClient }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="kicker">
        {CLUSTER} clerk desk
      </p>
      <WalletReadyGate
        client={client}
        fallback={<p className="text-sm text-[var(--ink-soft)]">Looking for wallets…</p>}
      >
        <WalletButtons client={client} />
      </WalletReadyGate>
    </div>
  );
}
