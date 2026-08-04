/**
 * Chart palette and formatting helpers.
 *
 * The colours are the validated categorical set (adjacent-pair CVD ΔE ≥ 8,
 * normal-vision ΔE ≥ 15 in both modes). Two rules they encode:
 *
 *   - Hues are assigned in FIXED ORDER and never cycled. The previous version
 *     did `COLORS[i % COLORS.length]` across 17 holdings, which silently paints
 *     two different holdings the same colour and makes the legend a lie.
 *     Anything past the 8th category folds into "Other" — see `sleeveColor`.
 *   - Drift is a DIVERGING measure (over/under target), so it gets two hues and
 *     a neutral midpoint, never a categorical slot.
 *
 * Values are exposed as CSS custom properties on `.tdash` so light/dark swap in
 * one place and dark is a selected set of steps rather than an automatic flip.
 */

/** Fixed categorical order — index by position, never by hash or modulo. */
export const SERIES_LIGHT = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
  "#4a3aa7", // 7 violet
  "#e34948", // 8 red
] as const;

export const SERIES_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
] as const;

/** Max distinct categories before folding into "Other". */
export const MAX_SERIES = SERIES_LIGHT.length;

export const OTHER_LABEL = "Other";

/**
 * Stable sleeve → colour slot mapping.
 *
 * Built from the sleeve list in a fixed order so a holding keeps its colour when
 * a filter changes the row count — colour follows the entity, never its rank.
 */
export function buildSleeveScale(sleeves: string[]): Map<string, string> {
  const unique = Array.from(new Set(sleeves)).sort();
  const scale = new Map<string, string>();
  unique.slice(0, MAX_SERIES).forEach((s, i) => scale.set(s, `var(--tdash-series-${i + 1})`));
  for (const s of unique.slice(MAX_SERIES)) scale.set(s, "var(--tdash-other)");
  return scale;
}

export const CSS = `
.tdash {
  color-scheme: light;
  --tdash-series-1: ${SERIES_LIGHT[0]};
  --tdash-series-2: ${SERIES_LIGHT[1]};
  --tdash-series-3: ${SERIES_LIGHT[2]};
  --tdash-series-4: ${SERIES_LIGHT[3]};
  --tdash-series-5: ${SERIES_LIGHT[4]};
  --tdash-series-6: ${SERIES_LIGHT[5]};
  --tdash-series-7: ${SERIES_LIGHT[6]};
  --tdash-series-8: ${SERIES_LIGHT[7]};
  --tdash-other: #8a8a85;
  /* Diverging pair for drift: under-target / neutral / over-target. */
  --tdash-under: #2a78d6;
  --tdash-over: #eb6834;
  --tdash-neutral: #8a8a85;
  /* Status ramp — reserved, never reused as a series colour. */
  --tdash-good: #1baf7a;
  --tdash-warn: #eda100;
  --tdash-critical: #e34948;
  --tdash-grid: color-mix(in oklab, currentColor 12%, transparent);
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .tdash {
    color-scheme: dark;
    --tdash-series-1: ${SERIES_DARK[0]};
    --tdash-series-2: ${SERIES_DARK[1]};
    --tdash-series-3: ${SERIES_DARK[2]};
    --tdash-series-4: ${SERIES_DARK[3]};
    --tdash-series-5: ${SERIES_DARK[4]};
    --tdash-series-6: ${SERIES_DARK[5]};
    --tdash-series-7: ${SERIES_DARK[6]};
    --tdash-series-8: ${SERIES_DARK[7]};
    --tdash-other: #9a9a94;
    --tdash-under: ${SERIES_DARK[0]};
    --tdash-over: ${SERIES_DARK[1]};
    --tdash-good: ${SERIES_DARK[2]};
    --tdash-warn: ${SERIES_DARK[3]};
    --tdash-critical: ${SERIES_DARK[7]};
  }
}
:root[data-theme="dark"] .tdash {
  color-scheme: dark;
  --tdash-series-1: ${SERIES_DARK[0]};
  --tdash-series-2: ${SERIES_DARK[1]};
  --tdash-series-3: ${SERIES_DARK[2]};
  --tdash-series-4: ${SERIES_DARK[3]};
  --tdash-series-5: ${SERIES_DARK[4]};
  --tdash-series-6: ${SERIES_DARK[5]};
  --tdash-series-7: ${SERIES_DARK[6]};
  --tdash-series-8: ${SERIES_DARK[7]};
  --tdash-other: #9a9a94;
  --tdash-under: ${SERIES_DARK[0]};
  --tdash-over: ${SERIES_DARK[1]};
  --tdash-good: ${SERIES_DARK[2]};
  --tdash-warn: ${SERIES_DARK[3]};
  --tdash-critical: ${SERIES_DARK[7]};
}
`;

/* ------------------------------------------------------------ formatting */

export function money(v: number, currency = "$", digits = 2): string {
  const abs = Math.abs(v);
  const s = abs.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${v < 0 ? "-" : ""}${currency}${s}`;
}

export function compactMoney(v: number, currency = "$"): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${currency}${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${sign}${currency}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${currency}${abs.toFixed(0)}`;
}

export function pct(v: number, digits = 1): string {
  return `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(digits)}%`;
}

export function signedPct(v: number, digits = 1): string {
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(digits)}%`;
}

export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
