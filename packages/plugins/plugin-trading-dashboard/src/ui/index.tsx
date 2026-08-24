/**
 * Trading Dashboard — fund and bot views.
 *
 * Two panels, each answering the question that account actually poses:
 *
 *   Fund : "what am I holding, how has it tracked, how far from target?"
 *   Bot  : "is it in a position, and if not — why not?"
 *
 * That second question is the reason the bot view leads with its gating state.
 * The bot has been signal-generating but entry-blocked for months, and the old
 * dashboard showed a flat portfolio with no indication of why.
 */
import type { PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginData, useHostContext, useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import { TrendingUp, TrendingDown, Activity, BarChart3, ShieldAlert, ArrowRight } from "lucide-react";
import {
  AllocationBars, DriftBar, Empty, EquityCurve, Hero, Legend, Panel, Stat, StatusPill,
  TradesTable, type AllocRow, type Json, type Tone,
} from "./parts.js";
import { CSS, buildSleeveScale, cn, compactMoney, money, num, pct, signedPct } from "./theme.js";

interface Bot { state: Json; trades: Json[] }
interface StatusResponse {
  shown?: { fund: boolean; bot: boolean };
  fund: Bot | null;
  bot: Bot | null;
  searched?: { fundDb: string; botDir: string };
}

function drawdownTone(p: number): Tone {
  return p > 10 ? "critical" : p > 5 ? "warn" : "good";
}

function Styles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}

function NotConnected({ what, where }: { what: string; where?: string }) {
  return (
    <div className="rounded-lg border bg-card p-8 text-center">
      <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-40" />
      <p className="text-sm text-muted-foreground">{what} has no state yet</p>
      {where && <p className="text-[11px] text-muted-foreground/70 mt-1 font-mono">{where}</p>}
    </div>
  );
}

/* ==================================================================== fund */

interface Holding {
  symbol: string; sleeve: string; targetPct: number; currentPct: number; currentValue: number;
}

function fundFacts(state: Json) {
  const snapshot = (state.lastSnapshot ?? {}) as Json;
  const risk = (state.riskMetrics ?? {}) as Json;
  const dd = (risk.drawdown ?? {}) as Json;
  const holdings = (Array.isArray(snapshot.holdings) ? snapshot.holdings : []) as Holding[];
  const navHistory = (Array.isArray(state.navHistory) ? state.navHistory : []) as number[];

  return {
    navBase: num(state.lastNav),
    navUsd: num(state.lastNavUsd) || num(snapshot.netLiquidation),
    cashBase: num(state.lastCash),
    cashUsd: num(snapshot.cashValue),
    holdings,
    navHistory,
    peak: num(dd.peak),
    drawdownPct: num(dd.drawdownPct),
    drawdownLevel: String(dd.level ?? state.drawdownLevel ?? ""),
    var95: num(risk.var95),
    cvar95: num(risk.cvar95),
    realizedVol: num(risk.realizedVol),
    leverage: num(risk.volTargetLeverage) || 1,
    lastRebalanceAt: state.lastRebalanceAt as string | undefined,
    lastExecutionAt: state.lastExecutionAt as string | undefined,
  };
}

function FundView({ state, trades }: { state: Json; trades: Json[] }) {
  const f = fundFacts(state);
  const sleeveScale = buildSleeveScale(f.holdings.map((h) => h.sleeve));

  const invested = f.holdings.reduce((s, h) => s + num(h.currentValue), 0);
  const rows: AllocRow[] = [...f.holdings]
    .filter((h) => num(h.currentPct) > 0)
    .sort((a, b) => num(b.currentPct) - num(a.currentPct))
    .map((h) => ({
      label: h.symbol,
      value: num(h.currentPct),
      amount: num(h.currentValue),
      color: sleeveScale.get(h.sleeve) ?? "var(--tdash-other)",
      group: h.sleeve,
    }));

  const sleeves = Array.from(new Set(f.holdings.map((h) => h.sleeve))).sort();
  const maxDrift = f.holdings.reduce(
    (m, h) => Math.max(m, Math.abs(num(h.currentPct) - num(h.targetPct))), 0,
  );

  const equity = f.navHistory.map((v, i) => ({ i: i + 1, v }));
  const periodChange = equity.length > 1 ? equity[equity.length - 1].v - equity[0].v : 0;
  const periodPct = equity.length > 1 && equity[0].v > 0 ? (periodChange / equity[0].v) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Hero
          label="Net Asset Value"
          value={money(f.navBase, "$", 0)}
          sub={f.navUsd ? `US${money(f.navUsd, "$", 0)}` : undefined}
        />
        <Stat label="Cash" value={money(f.cashBase, "$", 0)} sub={f.cashUsd ? `US${money(f.cashUsd, "$", 0)}` : undefined} size="lg" />
        <Stat
          label="Drawdown"
          value={pct(f.drawdownPct)}
          sub={f.peak ? `peak ${money(f.peak, "$", 0)}` : undefined}
          tone={drawdownTone(f.drawdownPct)}
          size="lg"
        />
        <Stat
          label="Invested"
          value={money(invested, "$", 0)}
          sub={`${f.holdings.length} positions`}
          size="lg"
        />
      </div>

      <Panel
        title="Equity curve"
        right={equity.length > 1
          ? `${signedPct(periodPct)} over ${equity.length} points`
          : undefined}
      >
        <EquityCurve data={equity} />
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Allocation" right={`${rows.length} holdings`}>
          <AllocationBars rows={rows} />
          <Legend items={sleeves.map((s) => ({ label: s, color: sleeveScale.get(s) ?? "var(--tdash-other)" }))} />
        </Panel>

        <Panel
          title="Drift from target"
          right={maxDrift ? `max ${pct(maxDrift)}` : undefined}
        >
          {f.holdings.length === 0 ? <Empty>No positions</Empty> : (
            <div className="space-y-1.5">
              {[...f.holdings]
                .sort((a, b) =>
                  Math.abs(num(b.currentPct) - num(b.targetPct)) -
                  Math.abs(num(a.currentPct) - num(a.targetPct)))
                .map((h) => {
                  const drift = num(h.currentPct) - num(h.targetPct);
                  return (
                    <div key={h.symbol} className="grid grid-cols-[3.25rem_1fr_3.5rem] items-center gap-2 text-sm">
                      <span className="font-medium truncate">{h.symbol}</span>
                      <DriftBar drift={drift} />
                      <span className={cn("text-right tabular-nums text-xs",
                        Math.abs(drift) > 5 ? "text-amber-500" : "text-muted-foreground")}>
                        {signedPct(drift)}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
          <div className="flex gap-3 mt-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "var(--tdash-under)" }} />under target
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "var(--tdash-over)" }} />over target
            </span>
          </div>
        </Panel>
      </div>

      <Panel title="Risk">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="VaR 95%" value={pct(f.var95, 2)} tone={f.var95 > 5 ? "warn" : "neutral"} />
          <Stat label="CVaR 95%" value={pct(f.cvar95, 2)} />
          <Stat label="Realised vol" value={pct(f.realizedVol)} />
          <Stat label="Leverage" value={`${f.leverage.toFixed(2)}x`} />
        </div>
      </Panel>

      <Panel
        title="Trade history"
        right={f.lastExecutionAt
          ? `last execution ${new Date(f.lastExecutionAt).toLocaleDateString()}`
          : undefined}
      >
        <TradesTable trades={trades} showPnl />
      </Panel>
    </div>
  );
}

/* ===================================================================== bot */

function botFacts(state: Json, trades: Json[]) {
  const portfolio = num(state.portfolioUsdt);
  const peak = num(state.peakEquity) || portfolio;
  const position = (state.openPosition ?? null) as Json | null;
  const realised = trades.reduce((s, t) => {
    if (t.type === "SELL") return s + num(t.usdt);
    if (t.type === "BUY") return s - num(t.usdt);
    return s;
  }, 0);

  // Portfolio composition. The bot is a two-asset book: stablecoin plus, when
  // it has taken a trade, one BTC position. Marked at the last known price so
  // the split reflects market value rather than entry cost.
  const entry = (position?.entryTrade ?? null) as Json | null;
  const qty = num(entry?.qty);
  const mark = num(state.lastPrice) || num(entry?.price);
  const positionValue = qty * mark;
  const equity = portfolio + positionValue;
  const composition = [
    { label: "USDT", value: equity > 0 ? (portfolio / equity) * 100 : 100, amount: portfolio, group: "cash" },
    ...(positionValue > 0
      ? [{ label: "BTC", value: (positionValue / equity) * 100, amount: positionValue, group: "position" }]
      : []),
  ];

  return {
    portfolio, peak, position, positionValue, equity, composition, mark, qty,
    trailingStop: (state.trailingStop ?? null) as Json | null,
    regime: String(state.lastRegime ?? "unknown"),
    regimeSince: state.regimeSince as string | undefined,
    consecutiveLosses: num(state.consecutiveLosses),
    lastStopLossAt: state.lastStopLossAt as string | undefined,
    drawdownPct: peak > 0 ? ((peak - portfolio) / peak) * 100 : 0,
    realised,
    // The bot does not persist an equity series today (see README) — this stays
    // empty until it does, rather than fabricating one from trades.
    equityHistory: (Array.isArray(state.equityHistory) ? state.equityHistory : []) as number[],
  };
}

/**
 * Why the bot is or is not in the market.
 *
 * Surfaced prominently and in words. A flat balance and an empty trade table are
 * indistinguishable from a broken bot, which is exactly how months of
 * entry-blocked operation went unnoticed.
 */
function GatingState({ regime, since, position, losses }: {
  regime: string; since?: string; position: Json | null; losses: number;
}) {
  const bearish = regime === "TRENDING_DOWN";
  const days = since ? (Date.now() - new Date(since).getTime()) / 86_400_000 : null;

  const tone: Tone = position ? "good" : bearish ? "warn" : "neutral";
  const headline = position
    ? "In position"
    : bearish
      ? "Flat — defensive regime blocks new entries"
      : "Flat — waiting for an entry signal";

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        {bearish && !position
          ? <ShieldAlert className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
          : <Activity className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />}
        <div className="min-w-0">
          <div className="text-sm font-medium">{headline}</div>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <StatusPill tone={tone}>{regime}</StatusPill>
            {days !== null && (
              <span className="text-[11px] text-muted-foreground">for {days.toFixed(1)}d</span>
            )}
            {losses > 0 && (
              <StatusPill tone={losses >= 3 ? "critical" : "warn"}>{losses} consecutive losses</StatusPill>
            )}
          </div>
          {bearish && !position && (
            <p className="text-[11px] text-muted-foreground mt-2">
              The macro filter holds the book in stablecoin while the daily trend is down. Signals may
              still fire and be declined — that is the strategy working as configured, not a fault.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function BotView({ state, trades }: { state: Json; trades: Json[] }) {
  const b = botFacts(state, trades);
  const entry = (b.position?.entryTrade ?? null) as Json | null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Hero label="Portfolio" value={money(b.portfolio)} sub="USDT" />
        <Stat label="Position" value={b.position ? "Open" : "Flat"} tone={b.position ? "good" : "neutral"} size="lg" />
        <Stat
          label="Drawdown"
          value={pct(b.drawdownPct)}
          sub={`peak ${money(b.peak)}`}
          tone={drawdownTone(b.drawdownPct)}
          size="lg"
        />
        <Stat
          label="Realised P&L"
          value={money(b.realised)}
          sub={`${trades.length} trades`}
          tone={b.realised > 0 ? "good" : b.realised < 0 ? "critical" : "neutral"}
          size="lg"
        />
      </div>

      <GatingState regime={b.regime} since={b.regimeSince} position={b.position} losses={b.consecutiveLosses} />

      <Panel title="Equity curve" right={b.equityHistory.length > 1 ? `${b.equityHistory.length} points` : undefined}>
        <EquityCurve data={b.equityHistory.map((v, i) => ({ i: i + 1, v }))} />
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Allocation" right={`${b.composition.length} asset${b.composition.length === 1 ? "" : "s"}`}>
          <AllocationBars
            rows={b.composition.map((c, i) => ({
              ...c,
              color: i === 0 ? "var(--tdash-series-1)" : "var(--tdash-series-2)",
            }))}
          />
          <Legend
            items={[
              { label: "cash (USDT)", color: "var(--tdash-series-1)" },
              ...(b.positionValue > 0 ? [{ label: "position (BTC)", color: "var(--tdash-series-2)" }] : []),
            ]}
          />
        </Panel>

        <Panel title="Position" right={b.mark ? `mark ${money(b.mark)}` : undefined}>
          {b.position && entry ? (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Entry" value={money(num(entry.price))} sub={`${num(entry.qty).toFixed(6)} BTC`} />
              <Stat label="Market value" value={money(b.positionValue)} />
              <Stat label="Stop loss" value={money(num(b.position.stopLossPrice))} tone="critical" />
              <Stat label="Take profit" value={money(num(b.position.takeProfitPrice))} tone="good" />
              {b.trailingStop && (
                <Stat
                  label="Trailing"
                  value={money(num(b.trailingStop.highWaterMark))}
                  sub={`${num(b.trailingStop.trailPercent)}% trail`}
                />
              )}
            </div>
          ) : (
            <Empty>Flat — 100% in stablecoin</Empty>
          )}
        </Panel>
      </div>

      <Panel title="Risk">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Peak equity" value={money(b.peak)} />
          <Stat label="Drawdown" value={pct(b.drawdownPct)} tone={drawdownTone(b.drawdownPct)} />
          <Stat
            label="Loss streak"
            value={b.consecutiveLosses > 0 ? String(b.consecutiveLosses) : "0"}
            tone={b.consecutiveLosses >= 3 ? "critical" : b.consecutiveLosses > 0 ? "warn" : "good"}
          />
          <Stat
            label="Last stop-out"
            value={b.lastStopLossAt ? new Date(b.lastStopLossAt).toLocaleDateString() : "never"}
          />
        </div>
      </Panel>

      <Panel title="Trade history" right={`${trades.length} total`}>
        <TradesTable trades={trades} />
      </Panel>
    </div>
  );
}

/* =================================================================== slots */

function SectionHeader({ icon: Icon, title, badge, accent }: {
  icon: React.ElementType; title: string; badge: string; accent: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className={cn("h-5 w-5", accent)} />
      <h2 className="text-lg font-semibold">{title}</h2>
      <span className="text-[11px] bg-muted text-muted-foreground px-2 py-0.5 rounded">{badge}</span>
    </div>
  );
}

/**
 * Build a path to one of this plugin's own page slots, which mount under the
 * active company prefix (`/:companyPrefix/<routePath>`).
 *
 * `companyPrefix` is optional on `PluginHostContext`, and not every host
 * surface fills it in — the dashboard widget outlet passed only `companyId`,
 * so the widget's sole navigation affordance silently disappeared while
 * everything else about it kept working. That's fixed host-side, but the
 * fallback stays: losing the link is a worse failure than deriving the prefix
 * from the URL we're already rendering inside.
 *
 * The first path segment is the company prefix for any company-scoped route.
 * Bail out on the known global prefixes so we never fabricate a company path.
 */
function companyRoutePath(companyPrefix: string | null | undefined, routePath: string): string | null {
  const prefix = companyPrefix?.trim();
  if (prefix) return `/${prefix}/${routePath}`;

  if (typeof window === "undefined") return null;
  const first = window.location.pathname.split("/").filter(Boolean)[0];
  if (!first) return null;
  // Global (non-company-scoped) roots — a link built from these would 404.
  const GLOBAL = new Set(["settings", "admin", "auth", "login", "onboarding", "plugins", "api", "_plugins"]);
  if (GLOBAL.has(first.toLowerCase())) return null;
  return `/${first}/${routePath}`;
}

/**
 * Dashboard widget.
 *
 * Deliberately never renders `null` on the empty/error paths. The version this
 * replaced returned null whenever it had no data, which makes "not configured",
 * "worker errored" and "plugin not loading at all" indistinguishable from the
 * outside — the exact ambiguity that hid a dead IBKR panel for months. If it is
 * mounted, it says something.
 */
export function TradingWidgets({ context }: PluginPageProps) {
  const companyId = context.companyId ?? "";
  const nav = useHostNavigation();
  // routePath "trading" is mounted under the company prefix.
  const fullPath = companyRoutePath(context.companyPrefix, "trading");
  const { data, loading, error } = usePluginData<StatusResponse>("status", { companyId });

  if (loading) {
    return <div className="text-xs text-muted-foreground">Loading trading data…</div>;
  }
  if (error) {
    return (
      <div className="text-xs text-destructive">
        Trading: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  if (!data || (!data.fund && !data.bot)) {
    return (
      <div className="text-xs text-muted-foreground space-y-1">
        <div className="font-medium text-foreground">Trading — no state found</div>
        {data?.searched && (
          <div className="font-mono text-[10px] leading-relaxed opacity-80">
            <div>fund: {data.searched.fundDb}</div>
            <div>bot: {data.searched.botDir}</div>
          </div>
        )}
      </div>
    );
  }

  const f = data.fund ? fundFacts(data.fund.state) : null;
  const b = data.bot ? botFacts(data.bot.state, data.bot.trades) : null;

  return (
    <div className="tdash space-y-3">
      <Styles />
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          Trading
        </h3>
        {/* Through to the full view. The widget is a summary; without this the
            detailed page is only reachable by typing the URL. */}
        {fullPath && (
          <a
            {...nav.linkProps(fullPath)}
            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            View details
            <ArrowRight className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {f && <Stat label="Fund NAV" value={compactMoney(f.navBase)} sub={`${f.holdings.length} positions`} />}
        {f && <Stat label="Fund drawdown" value={pct(f.drawdownPct)} tone={drawdownTone(f.drawdownPct)} />}
        {b && <Stat label="Bot portfolio" value={money(b.portfolio)} sub={b.position ? "in position" : b.regime} />}
        {b && <Stat label="Bot drawdown" value={pct(b.drawdownPct)} tone={drawdownTone(b.drawdownPct)} />}
      </div>
      {f && f.navHistory.length > 1 && (
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Fund equity</div>
          <EquityCurve data={f.navHistory.map((v, i) => ({ i: i + 1, v }))} height={120} />
        </div>
      )}
    </div>
  );
}

/** Full page. */
export function TradingDashboardPage({ context }: PluginPageProps) {
  const companyId = context.companyId ?? "";
  const { data, loading, error } = usePluginData<StatusResponse>("status", { companyId });

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading trading data…</div>;
  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load trading data: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  // `shown` is per-company config: a company that does not own a book omits
  // that section entirely rather than showing an empty one. Older responses
  // without the field fall back to showing both.
  const showFund = data?.shown ? data.shown.fund : true;
  const showBot = data?.shown ? data.shown.bot : true;

  return (
    <div className="tdash p-6 space-y-8 max-w-7xl">
      <Styles />

      {showFund && (
        <section>
          <SectionHeader icon={TrendingUp} title="Sovereign Fund" badge="IBKR" accent="text-emerald-500" />
          {data?.fund
            ? <FundView state={data.fund.state} trades={data.fund.trades} />
            : <NotConnected what="Fund" where={data?.searched?.fundDb} />}
        </section>
      )}

      {showBot && (
        <section>
          <SectionHeader icon={TrendingDown} title="Swing Trader" badge="BTC/USDT" accent="text-amber-500" />
          {data?.bot
            ? <BotView state={data.bot.state} trades={data.bot.trades} />
            : <NotConnected what="Trading bot" where={data?.searched?.botDir} />}
        </section>
      )}
    </div>
  );
}
