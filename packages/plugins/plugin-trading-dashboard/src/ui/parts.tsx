/**
 * Shared presentational pieces.
 *
 * Deliberately plain HTML/CSS for everything except the time series. Bars,
 * donuts and drift indicators built as elements (rather than a charting lib)
 * are smaller, easier to direct-label, and keep identity out of colour alone.
 */
import { useId, useMemo, useRef, useState } from "react";
import { cn, compactMoney, money, num, pct, signedPct } from "./theme.js";

export type Json = Record<string, unknown>;
export type Tone = "good" | "warn" | "critical" | "neutral";

const toneInk: Record<Tone, string> = {
  good: "text-emerald-500",
  warn: "text-amber-500",
  critical: "text-red-500",
  neutral: "text-foreground",
};

/* ------------------------------------------------------------ stat tiles */

export function Stat({ label, value, sub, tone = "neutral", size = "md" }: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  size?: "md" | "lg";
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("font-semibold tabular-nums mt-0.5", size === "lg" ? "text-2xl" : "text-lg", toneInk[tone])}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}

/** Hero number — the one figure the view exists to answer. Not a chart. */
export function Hero({ label, value, sub, tone = "neutral" }: {
  label: string; value: string; sub?: string; tone?: Tone;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-3xl font-semibold tabular-nums mt-1", toneInk[tone])}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1 tabular-nums">{sub}</div>}
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const bg =
    tone === "good" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : tone === "warn" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : tone === "critical" ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : "bg-muted text-muted-foreground";
  // Status always ships with a label, never colour alone.
  return <span className={cn("text-[11px] px-2 py-0.5 rounded font-medium", bg)}>{children}</span>;
}

export function Panel({ title, right, children }: {
  title: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h4 className="text-sm font-medium">{title}</h4>
        {right && <div className="text-[11px] text-muted-foreground tabular-nums">{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-sm text-muted-foreground">{children}</div>;
}

/* ------------------------------------------------------- equity time series */

/**
 * Equity curve — hand-rolled SVG, deliberately.
 *
 * This was recharts, which cost ~930KB of bundle for exactly one chart and, more
 * importantly, is a large dependency to push through the host's plugin loader:
 * that loader fetches the module text, rewrites bare specifiers to blob URLs,
 * and imports the result, so every transitive import has to survive a shim.
 * Fewer moving parts is worth more here than a charting API.
 *
 * Keeps what actually matters: a 2px line, a soft fill, a recessive baseline
 * grid, a hover crosshair with a readout, and a value axis. Renders in a
 * viewBox with `preserveAspectRatio="none"` for the fill/line, while text is
 * drawn in screen units so it never scales oddly.
 */
export function EquityCurve({ data, height = 220, currency = "$" }: {
  data: Array<{ i: number; v: number }>;
  height?: number;
  currency?: string;
}) {
  const gradId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (data.length < 2) return null;
    const values = data.map((d) => d.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Pad the domain so the line never sits on the frame.
    const pad = (max - min) * 0.08 || Math.abs(max) * 0.02 || 1;
    const lo = min - pad;
    const hi = max + pad;
    const x = (i: number) => (i / (data.length - 1)) * 100;
    const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 100;
    const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(3)},${y(d.v).toFixed(3)}`).join(" ");
    const area = `${line} L100,100 L0,100 Z`;
    return { lo, hi, x, y, line, area, min, max };
  }, [data]);

  if (!geom) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Not enough history yet
      </div>
    );
  }

  const first = data[0].v;
  const last = data[data.length - 1].v;
  // Single series → no legend; the panel title names it.
  const stroke = last >= first ? "var(--tdash-good)" : "var(--tdash-critical)";
  const active = hover === null ? null : data[hover];

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, idx)));
  }

  const AXIS_W = 54;
  const ticks = [geom.hi, (geom.hi + geom.lo) / 2, geom.lo];

  return (
    <div className="flex" style={{ height }}>
      {/* Value axis in screen units, so labels never distort. */}
      <div
        className="flex flex-col justify-between text-[10px] text-muted-foreground tabular-nums pr-2 text-right"
        style={{ width: AXIS_W }}
      >
        {ticks.map((t, i) => <span key={i}>{compactMoney(t, currency)}</span>)}
      </div>

      <div
        ref={wrapRef}
        className="relative flex-1 cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          {/* Recessive grid — horizontal only. */}
          {[0, 50, 100].map((y) => (
            <line key={y} x1="0" x2="100" y1={y} y2={y}
              stroke="var(--tdash-grid)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={geom.area} fill={`url(#${gradId})`} />
          <path d={geom.line} fill="none" stroke={stroke} strokeWidth="2"
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          {active && (
            <>
              <line x1={geom.x(hover!)} x2={geom.x(hover!)} y1="0" y2="100"
                stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <circle cx={geom.x(hover!)} cy={geom.y(active.v)} r="4"
                fill={stroke} stroke="var(--tdash-surface, #000)" strokeWidth="1.5"
                vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>

        {/* Readout, positioned in screen units above the crosshair. */}
        {active && (
          <div
            className="pointer-events-none absolute top-1 rounded border bg-card px-2 py-1 text-[11px] shadow-sm tabular-nums"
            style={{
              left: `${geom.x(hover!)}%`,
              transform: geom.x(hover!) > 60 ? "translateX(-100%)" : "translateX(4px)",
            }}
          >
            <div className="font-medium">{money(active.v, currency, 2)}</div>
            <div className="text-muted-foreground">point {active.i}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ allocation */

export interface AllocRow {
  label: string;
  value: number;      // percent of portfolio
  amount: number;     // currency value
  color: string;      // css var
  group: string;      // sleeve
}

/**
 * Horizontal bars, sorted by magnitude.
 *
 * Replaces a 17-slice pie. A pie cannot be read at that cardinality, its labels
 * collide, and the previous implementation cycled six hues so different holdings
 * shared a colour. Bars stay readable at any count, carry a direct value label
 * (which is also the light-mode contrast relief), and each row names itself so
 * identity never rests on colour.
 */
export function AllocationBars({ rows, currency = "$" }: { rows: AllocRow[]; currency?: string }) {
  if (rows.length === 0) return <Empty>No positions</Empty>;
  const max = Math.max(...rows.map((r) => r.value), 1);

  // Label row above the bar rather than a 4-column grid. These panels sit in a
  // half-width column, where a fixed 4-column track forced the value labels to
  // wrap under the bar and read as a second row. Label-over-bar survives any
  // container width, and keeps the direct value label the light-mode contrast
  // relief depends on.
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm leading-tight">
            <span className="font-medium truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums text-xs">
              {pct(r.value)}
              <span className="text-muted-foreground ml-1.5">{money(r.amount, currency, 0)}</span>
            </span>
          </div>
          <div className="mt-1 h-2 rounded bg-muted/60 overflow-hidden">
            <div
              className="h-full rounded"
              style={{ width: `${(r.value / max) * 100}%`, backgroundColor: r.color }}
              title={`${r.label} — ${r.group} — ${pct(r.value)}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Legend — always present for ≥2 categories, so identity is never colour-alone. */
export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  if (items.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Drift from target — a diverging measure, so two hues around a neutral zero.
 * Rendered as a centre-anchored bar: left of centre = under target, right = over.
 */
export function DriftBar({ drift, scale = 6 }: { drift: number; scale?: number }) {
  const clamped = Math.max(-scale, Math.min(scale, drift));
  const halfPct = (Math.abs(clamped) / scale) * 50;
  const over = drift > 0;
  const color = Math.abs(drift) < 0.05 ? "var(--tdash-neutral)" : over ? "var(--tdash-over)" : "var(--tdash-under)";
  return (
    <div className="relative h-2.5 w-full rounded bg-muted/60 overflow-hidden" title={`${signedPct(drift)} vs target`}>
      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
      <div
        className="absolute inset-y-0 rounded"
        style={{
          backgroundColor: color,
          width: `${halfPct}%`,
          left: over ? "50%" : `${50 - halfPct}%`,
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- tables */

export function TradesTable({ trades, currency = "$", showPnl }: {
  trades: Json[]; currency?: string; showPnl?: boolean;
}) {
  if (!trades || trades.length === 0) return <Empty>No trades recorded</Empty>;
  const recent = [...trades].reverse().slice(0, 25);

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b text-muted-foreground text-[11px] uppercase tracking-wide">
            <th className="text-left font-medium py-2 px-1">When</th>
            <th className="text-left font-medium py-2 px-1">Symbol</th>
            <th className="text-left font-medium py-2 px-1">Side</th>
            <th className="text-right font-medium py-2 px-1">Qty</th>
            <th className="text-right font-medium py-2 px-1">Fill</th>
            <th className="text-right font-medium py-2 px-1">Value</th>
            {showPnl && <th className="text-right font-medium py-2 px-1">Realised</th>}
            <th className="text-left font-medium py-2 px-1">Reason</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((t, i) => {
            const side = String(t.action ?? t.type ?? "");
            const isBuy = side === "BUY";
            const fill = num(t.fillPrice) || num(t.price);
            const value = num(t.estimatedValue) || num(t.usdt) || fill * num(t.qty);
            const realised = num(t.realisedPnlUsd);
            const when = new Date(String(t.timestamp ?? ""));
            const validDate = !Number.isNaN(when.getTime());
            return (
              <tr key={i} className="border-b border-border/50">
                <td className="py-1.5 px-1 tabular-nums text-muted-foreground whitespace-nowrap">
                  {validDate ? `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—"}
                </td>
                <td className="py-1.5 px-1 font-medium">{String(t.symbol ?? "")}</td>
                <td className="py-1.5 px-1">
                  <span className={cn("font-medium", isBuy ? "text-emerald-500" : "text-red-500")}>{side}</span>
                </td>
                <td className="py-1.5 px-1 text-right tabular-nums">{num(t.qty).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                <td className="py-1.5 px-1 text-right tabular-nums">{fill ? money(fill, currency) : "—"}</td>
                <td className="py-1.5 px-1 text-right tabular-nums">{value ? money(value, currency, 0) : "—"}</td>
                {showPnl && (
                  <td className={cn("py-1.5 px-1 text-right tabular-nums",
                    realised > 0 ? "text-emerald-500" : realised < 0 ? "text-red-500" : "text-muted-foreground")}>
                    {t.realisedPnlUsd === undefined ? "—" : money(realised, currency)}
                  </td>
                )}
                <td className="py-1.5 px-1 text-muted-foreground max-w-[260px] truncate" title={String(t.reason ?? "")}>
                  {String(t.reason ?? "")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {trades.length > recent.length && (
        <div className="text-[11px] text-muted-foreground mt-2 px-1">
          Showing {recent.length} of {trades.length} trades
        </div>
      )}
    </div>
  );
}
