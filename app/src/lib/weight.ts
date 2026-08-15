/** Integer square root matching Rust `u64::isqrt` / `floor(sqrt(amount))`. */
export function voteWeight(amount: bigint): bigint {
  if (amount <= 0n) return 0n;
  if (amount < 2n) return amount;
  let x = amount;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + amount / x) / 2n;
  }
  return x;
}
