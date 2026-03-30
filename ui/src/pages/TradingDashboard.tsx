import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from "recharts";
import { tradingApi } from "../api/trading";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { TrendingUp, TrendingDown, DollarSign, Shield, AlertTriangle, Activity, BarChart3 } from "lucide-react";
import { PageSkeleton } from "../components/PageSkeleton";

const COLORS = ["#10b981", "#6366f1", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
const GROWTH_COLOR = "#10b981";
const DEFENSIVE_COLOR = "#6366f1";

function MetricBox({ label, value, sub, icon: Icon, tone }: {
  label: string; value: string; sub?: string;
  icon?: React.ElementType; tone?: "green" | "red" | "amber" | "default";
}) {
  const toneClass = tone === "green" ? "text-emerald-500" : tone === "red" ? "text-red-500" : tone === "amber" ? "text-amber-500" : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className={cn("text-2xl font-semibold tabular-nums", toneClass)}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function TradeTable({ trades, type }: { trades: Array<Record<string, unknown>>; type: "ibkr" | "binance" }) {
  if (!trades || trades.length === 0) {
    return <div className="text-sm text-muted-foreground py-4">No trades yet</div>;
  }
  const recent = [...trades].reverse().slice(0, 20);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground text-xs">
            <th className="text-left py-2 font-medium">Time</th>
            <th className="text-left py-2 font-medium">Symbol</th>
            <th className="text-left py-2 font-medium">Action</th>
            <th className="text-right py-2 font-medium">Qty</th>
            <th className="text-right py-2 font-medium">Value</th>
            <th className="text-left py-2 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((t, i) => {
            const action = (t.action || t.type) as string;
            const isBuy = action === "BUY";
            const value = type === "ibkr" ? (t.estimatedValue as number) : (t.usdt as number);
            const time = new Date(t.timestamp as string);
            return (
              <tr key={i} className="border-b border-border/50">
                <td className="py-1.5 tabular-nums text-muted-foreground">
                  {time.toLocaleDateString()} {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="py-1.5 font-medium">{t.symbol as string}</td>
                <td className={cn("py-1.5 font-medium", isBuy ? "text-emerald-500" : "text-red-500")}>
                  {action}
                </td>
                <td className="py-1.5 text-right tabular-nums">{(t.qty as number)?.toFixed?.(4) ?? t.qty}</td>
                <td className="py-1.5 text-right tabular-nums">${value?.toFixed?.(2) ?? "—"}</td>
                <td className="py-1.5 text-muted-foreground truncate max-w-[200px]">{t.reason as string}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IBKRSection({ state, trades }: { state: Record<string, unknown> | null; trades: unknown[] }) {
  if (!state) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
        <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>IBKR Fund not connected yet</p>
        <p className="text-xs mt-1">Agents will populate data on their next heartbeat run</p>
      </div>
    );
  }

  const snapshot = state.lastSnapshot as Record<string, unknown> | undefined;
  const risk = state.lastRisk as Record<string, unknown> | undefined;
  const riskMetrics = state.riskMetrics as Record<string, unknown> | undefined;
  const navHistory = (state.navHistory || []) as number[];
  const nav = (state.lastNav as number) || (snapshot?.netLiquidation as number) || 0;
  const cash = (state.lastCash as number) || (snapshot?.cashValue as number) || 0;

  // NAV chart data
  const navData = navHistory.map((v, i) => ({ day: i + 1, nav: v }));

  // Allocation pie data
  const holdings = (snapshot?.holdings || []) as Array<{
    symbol: string; currentPct: number; sleeve: string; currentValue: number; targetPct: number;
  }>;
  const pieData = holdings.filter(h => h.currentPct > 0).map(h => ({
    name: h.symbol, value: h.currentPct, sleeve: h.sleeve,
  }));
  // If no holdings, show cash as 100%
  if (pieData.length === 0 && nav > 0) {
    pieData.push({ name: "Cash", value: 100, sleeve: "cash" });
  }

  const drawdownPct = riskMetrics?.drawdown
    ? ((riskMetrics.drawdown as Record<string, unknown>).drawdownPct as number)
    : 0;
  const var95 = (riskMetrics?.var95 as number) || 0;
  const realizedVol = (riskMetrics?.realizedVol as number) || 0;
  const regime = (state.regime as Record<string, unknown>)?.composite as string || "unknown";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricBox label="NAV" value={`$${nav.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={DollarSign} />
        <MetricBox label="Cash" value={`$${cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={DollarSign} />
        <MetricBox
          label="Drawdown"
          value={`${drawdownPct.toFixed(1)}%`}
          icon={drawdownPct > 5 ? AlertTriangle : Shield}
          tone={drawdownPct > 10 ? "red" : drawdownPct > 5 ? "amber" : "green"}
        />
        <MetricBox label="Regime" value={regime} icon={Activity} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* NAV Chart */}
        <div className="rounded-lg border bg-card p-4">
          <h4 className="text-sm font-medium mb-3">NAV History</h4>
          {navData.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={navData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => [`$${Number(v).toLocaleString()}`, "NAV"]} />
                <Area type="monotone" dataKey="nav" stroke={GROWTH_COLOR} fill={GROWTH_COLOR} fillOpacity={0.1} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
              Collecting data...
            </div>
          )}
        </div>

        {/* Allocation Pie */}
        <div className="rounded-lg border bg-card p-4">
          <h4 className="text-sm font-medium mb-3">Allocation</h4>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name} ${value.toFixed(0)}%`}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`]} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
              No positions
            </div>
          )}
        </div>
      </div>

      {/* Risk metrics row */}
      {(var95 > 0 || realizedVol > 0) && (
        <div className="grid grid-cols-3 gap-3">
          <MetricBox label="VaR (95%)" value={`${var95.toFixed(2)}%`} icon={Shield} tone={var95 > 5 ? "red" : "default"} />
          <MetricBox label="Realized Vol" value={`${realizedVol.toFixed(1)}%`} icon={Activity} />
          <MetricBox label="Vol Target Leverage" value={`${((riskMetrics?.volTargetLeverage as number) || 1).toFixed(2)}x`} icon={TrendingUp} />
        </div>
      )}

      {/* Holdings table */}
      {holdings.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h4 className="text-sm font-medium mb-3">Holdings</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="text-left py-2 font-medium">Symbol</th>
                <th className="text-left py-2 font-medium">Sleeve</th>
                <th className="text-right py-2 font-medium">Target</th>
                <th className="text-right py-2 font-medium">Current</th>
                <th className="text-right py-2 font-medium">Drift</th>
                <th className="text-right py-2 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const drift = h.currentPct - h.targetPct;
                return (
                  <tr key={h.symbol} className="border-b border-border/50">
                    <td className="py-1.5 font-medium">{h.symbol}</td>
                    <td className="py-1.5">
                      <span className={cn("text-xs px-1.5 py-0.5 rounded", h.sleeve === "growth" ? "bg-emerald-500/10 text-emerald-500" : "bg-indigo-500/10 text-indigo-500")}>
                        {h.sleeve}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{h.targetPct}%</td>
                    <td className="py-1.5 text-right tabular-nums">{h.currentPct.toFixed(1)}%</td>
                    <td className={cn("py-1.5 text-right tabular-nums", Math.abs(drift) > 5 ? "text-red-500" : "text-muted-foreground")}>
                      {drift > 0 ? "+" : ""}{drift.toFixed(1)}%
                    </td>
                    <td className="py-1.5 text-right tabular-nums">${h.currentValue.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Trade history */}
      <div className="rounded-lg border bg-card p-4">
        <h4 className="text-sm font-medium mb-3">Recent Trades</h4>
        <TradeTable trades={trades as Array<Record<string, unknown>>} type="ibkr" />
      </div>
    </div>
  );
}

function BinanceSection({ state, trades }: { state: Record<string, unknown> | null; trades: unknown[] }) {
  if (!state) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
        <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>Binance Trading Bot not connected yet</p>
      </div>
    );
  }

  const portfolio = (state.portfolioUsdt as number) || 0;
  const position = state.openPosition as Record<string, unknown> | null;
  const trailingStop = state.trailingStop as Record<string, unknown> | null;
  const peak = (state.peakEquity as number) || portfolio;
  const consecutiveLosses = (state.consecutiveLosses as number) || 0;
  const drawdownPct = peak > 0 ? ((peak - portfolio) / peak) * 100 : 0;

  // P&L from trades
  const tradeList = (trades || []) as Array<Record<string, unknown>>;
  const pnl = tradeList.reduce((sum, t) => {
    if (t.type === "SELL") return sum + (t.usdt as number);
    if (t.type === "BUY") return sum - (t.usdt as number);
    return sum;
  }, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricBox label="Portfolio" value={`$${portfolio.toFixed(2)}`} icon={DollarSign} />
        <MetricBox
          label="Position"
          value={position ? "Open" : "None"}
          icon={position ? TrendingUp : Activity}
          tone={position ? "green" : "default"}
        />
        <MetricBox
          label="Drawdown"
          value={`${drawdownPct.toFixed(1)}%`}
          icon={drawdownPct > 5 ? AlertTriangle : Shield}
          tone={drawdownPct > 10 ? "red" : drawdownPct > 5 ? "amber" : "green"}
        />
        <MetricBox
          label="Streak"
          value={consecutiveLosses > 0 ? `${consecutiveLosses} losses` : "OK"}
          tone={consecutiveLosses >= 3 ? "red" : consecutiveLosses > 0 ? "amber" : "green"}
        />
      </div>

      {position && (
        <div className="rounded-lg border bg-card p-4">
          <h4 className="text-sm font-medium mb-2">Open Position</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Entry: </span>
              <span className="font-medium">${((position.entryTrade as Record<string, unknown>)?.price as number)?.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Qty: </span>
              <span className="font-medium">{((position.entryTrade as Record<string, unknown>)?.qty as number)?.toFixed(6)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">SL: </span>
              <span className="text-red-500 font-medium">${(position.stopLossPrice as number)?.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">TP: </span>
              <span className="text-emerald-500 font-medium">${(position.takeProfitPrice as number)?.toFixed(2)}</span>
            </div>
          </div>
          {trailingStop && (
            <div className="text-xs text-muted-foreground mt-2">
              Trailing stop: HWM ${(trailingStop.highWaterMark as number)?.toFixed(2)}, trail {(trailingStop.trailPercent as number)}%
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border bg-card p-4">
        <h4 className="text-sm font-medium mb-3">Trade History ({tradeList.length} trades, P&L: <span className={pnl >= 0 ? "text-emerald-500" : "text-red-500"}>${pnl.toFixed(2)}</span>)</h4>
        <TradeTable trades={tradeList as Array<Record<string, unknown>>} type="binance" />
      </div>
    </div>
  );
}

export function TradingDashboard() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Trading" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.trading(selectedCompanyId!),
    queryFn: () => tradingApi.status(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000, // refresh every 30s
  });

  if (isLoading) return <PageSkeleton />;
  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load trading data: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-7xl">
      {/* IBKR Fund */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-emerald-500" />
          <h2 className="text-lg font-semibold">IBKR Fund</h2>
          <span className="text-xs bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded">Paper Trading</span>
        </div>
        <IBKRSection state={data?.ibkr.state ?? null} trades={data?.ibkr.trades ?? []} />
      </section>

      {/* Binance Trading Bot */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <TrendingDown className="h-5 w-5 text-amber-500" />
          <h2 className="text-lg font-semibold">Binance Swing Trader</h2>
          <span className="text-xs bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded">BTC/USDT</span>
        </div>
        <BinanceSection state={data?.binance.state ?? null} trades={data?.binance.trades ?? []} />
      </section>
    </div>
  );
}
