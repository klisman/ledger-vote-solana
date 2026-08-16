import idl from "@/idl/ledger_vote.json";

const BY_CODE = new Map(idl.errors.map((err) => [err.code, err.msg]));

function collectText(err: unknown, depth = 0): string {
  if (depth > 6 || err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const cause =
      "cause" in err && err.cause != null ? collectText(err.cause, depth + 1) : "";
    const context =
      "context" in err && err.context != null
        ? collectText(err.context, depth + 1)
        : "";
    return [err.name, err.message, cause, context].filter(Boolean).join(" ");
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

function programMessage(code: number): string | undefined {
  return BY_CODE.get(code);
}

export function formatTxError(err: unknown): string {
  const text = collectText(err);

  const hashed = text.match(/custom program error:\s*#(\d+)/i);
  if (hashed) {
    return programMessage(Number(hashed[1])) ?? `Program error ${hashed[1]}`;
  }

  const hex = text.match(/custom program error:\s*(0x[0-9a-f]+)/i);
  if (hex) {
    const code = Number.parseInt(hex[1], 16);
    return programMessage(code) ?? `Program error ${code}`;
  }

  const custom = text.match(/Custom\((\d+)\)/);
  if (custom) {
    const code = Number(custom[1]);
    return programMessage(code) ?? `Program error ${code}`;
  }

  const numbered = text.match(/Error Number:\s*(\d+)/);
  if (numbered) {
    const mapped = programMessage(Number(numbered[1]));
    if (mapped) return mapped;
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
  if (/ProgramAccountNotFound/i.test(text)) {
    return "Program is not loaded on this cluster. For localnet, start solana-test-validator with the .so at the declare_id address.";
  }
  if (/InsufficientFundsFor(Fee|Rent)|insufficient (lamports|funds|sol)/i.test(text)) {
    return "Not enough SOL to pay fees or rent. Airdrop the connected Phantom wallet on localnet, not the CLI id.json key.";
  }
  if (/AccountNotFound/i.test(text)) {
    return "An account in this transaction is missing on localnet. Airdrop the connected wallet, and confirm Phantom is on http://127.0.0.1:8899.";
  }
  if (/could not find.*program/i.test(text)) {
    return "Program is not loaded on this cluster. For localnet, start solana-test-validator with the .so at the declare_id address.";
  }
  if (/blockhash/i.test(text)) {
    return "Blockhash expired — try again";
  }

  return text.length > 280 ? `${text.slice(0, 277)}…` : text;
}
