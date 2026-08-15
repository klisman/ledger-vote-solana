import idl from "@/idl/ledger_vote.json";

const BY_CODE = new Map(idl.errors.map((err) => [err.code, err.msg]));

function collectText(err: unknown, depth = 0): string {
  if (depth > 6 || err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const cause =
      "cause" in err && err.cause != null ? collectText(err.cause, depth + 1) : "";
    return [err.name, err.message, cause].filter(Boolean).join(" ");
  }
  if (typeof err !== "object") return String(err);
  const o = err as Record<string, unknown>;
  const logs = Array.isArray(o.logs)
    ? o.logs.filter((item): item is string => typeof item === "string").join("\n")
    : "";
  const nested = [o.cause, o.context, o.data, o.error]
    .map((item) => collectText(item, depth + 1))
    .filter(Boolean)
    .join(" ");
  try {
    return [JSON.stringify(err), logs, nested].filter(Boolean).join(" ");
  } catch {
    return logs || nested;
  }
}

export function formatTxError(err: unknown): string {
  const text = collectText(err);

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
  if (/already in use/i.test(text)) {
    return "That account already exists (you may have already voted)";
  }
  if (/already been processed/i.test(text)) {
    return "That transaction was already processed — try again if nothing changed";
  }
  if (/insufficient (lamports|funds|sol)/i.test(text)) {
    return "Not enough SOL to pay fees or rent";
  }
  if (/blockhash/i.test(text)) {
    return "Blockhash expired — try again";
  }
  if (/AccountNotFound|could not find.*program/i.test(text)) {
    return "Program is not loaded on this cluster. For localnet, start solana-test-validator with the .so at the declare_id address.";
  }

  return text.length > 280 ? `${text.slice(0, 277)}…` : text;
}
