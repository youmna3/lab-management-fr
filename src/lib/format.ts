// Shared formatting helpers. Currency across the whole system is EGP (§14.1).

const egpFormatter = new Intl.NumberFormat("en-EG", {
  style: "currency",
  currency: "EGP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a value as Egyptian Pounds, e.g. 1500 -> "EGP 1,500.00". */
export function formatEGP(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return egpFormatter.format(Number.isFinite(n) ? n : 0);
}

/** Plain thousands-separated integer, e.g. 1500 -> "1,500". */
export function formatInt(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? Math.round(n) : 0).toLocaleString("en-EG");
}
