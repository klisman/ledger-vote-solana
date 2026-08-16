type MintDeskProps = {
  amount: string;
  onAmount: (value: string) => void;
  busy: boolean;
  canCreate: boolean;
  canMint: boolean;
  mintAuthority: string | null;
  wallet: string | undefined;
  onCreate: () => void;
  onMint: () => void;
};

export function MintDesk({
  amount,
  onAmount,
  busy,
  canCreate,
  canMint,
  mintAuthority,
  wallet,
  onCreate,
  onMint,
}: MintDeskProps) {
  return (
    <section className="sheet">
      <h2>Vote tokens</h2>
      <p>
        {canCreate
          ? "Create a 6-decimal mint, freeze authority = Config PDA, mint authority = this wallet. That freeze is what stops the same pile being voted from a second wallet."
          : "Mint more of the Config vote mint to the connected wallet, if this wallet is mint authority."}{" "}
        Weight is still <span className="formula">floor(√ raw amount)</span> at
        vote time — the program reads the ATA, not this form.
      </p>
      <label className="field">
        Whole tokens
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          placeholder="100"
        />
      </label>
      <div className="actions">
        {canCreate ? (
          <button
            type="button"
            className="btn-brass"
            disabled={busy}
            onClick={onCreate}
          >
            Create mint & fund this wallet
          </button>
        ) : null}
        <button
          type="button"
          className="btn-ink"
          disabled={busy || !canMint}
          onClick={onMint}
        >
          Mint to this wallet
        </button>
      </div>
      {!canMint ? (
        <p className="hint">
          {mintAuthority && wallet && mintAuthority !== wallet
            ? "The connected wallet is not this mint’s authority, so the page cannot mint. Connect the mint authority, or create a new mint before initialize."
            : "Connect a wallet that can sign, then create a mint or mint into one you already control."}
        </p>
      ) : null}
    </section>
  );
}
