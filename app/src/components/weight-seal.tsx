import { voteWeight } from "@/lib/weight";

export function WeightSeal({ amount }: { amount: bigint | null }) {
  const weight = amount == null || amount <= 0n ? null : voteWeight(amount);

  return (
    <div className="seal" aria-label="Square-root vote weight">
      <span className="seal-ring" />
      <span className="seal-kicker">floor √ amount</span>
      <span className="seal-value">{weight === null ? "—" : weight.toString()}</span>
      <span className="seal-foot">
        {amount == null
          ? "no ATA"
          : amount === 0n
            ? "zero balance"
            : `${amount.toString()} raw`}
      </span>
    </div>
  );
}
