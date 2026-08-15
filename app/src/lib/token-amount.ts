import type { Option } from "@solana/kit";

export function unwrapOption<T>(option: Option<T> | T | null | undefined): T | null {
  if (option == null) return null;
  if (typeof option === "object" && "__option" in option) {
    return option.__option === "Some" ? option.value : null;
  }
  return option;
}

export function uiAmountToRaw(ui: string, decimals: number): bigint {
  const whole = ui.trim();
  if (!/^\d+$/.test(whole)) {
    throw new Error("Amount must be a whole number of tokens");
  }
  let scale = 1n;
  for (let i = 0; i < decimals; i += 1) {
    scale *= 10n;
  }
  return BigInt(whole) * scale;
}

export const DEFAULT_MINT_DECIMALS = 6;
export const DEFAULT_MINT_UI_AMOUNT = "100";
