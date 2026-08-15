import idl from "@/idl/ledger_vote.json";

const BY_CODE = new Map(idl.errors.map((err) => [err.code, err.msg]));

export function formatTxError(err: unknown): string {
  const text =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "string"
        ? err
        : JSON.stringify(err);

  const hex = text.match(/custom program error:\s*(0x[0-9a-f]+)/i);
  if (hex) {
    const code = Number.parseInt(hex[1], 16);
    return BY_CODE.get(code) ?? `Program error ${code}`;
  }

  const custom = text.match(/Custom\((\d+)\)/);
  if (custom) {
    const code = Number(custom[1]);
    return BY_CODE.get(code) ?? `Program error ${code}`;
  }

  if (/user rejected|cancelled|denied/i.test(text)) {
    return "Wallet rejected the signature";
  }
  if (/already in use|already been processed/i.test(text)) {
    return "That account already exists (you may have already voted)";
  }
  if (/insufficient (lamports|funds|sol)/i.test(text)) {
    return "Not enough SOL to pay fees or rent";
  }
  if (/blockhash/i.test(text)) {
    return "Blockhash expired — try again";
  }

  return text.length > 280 ? `${text.slice(0, 277)}…` : text;
}
