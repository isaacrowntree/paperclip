import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { tradingApi } from "../api/trading";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { TrendingUp, DollarSign, Shield, AlertTriangle, Activity } from "lucide-react";

const COLORS = ["#10b981", "#6366f1", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
const GROWTH_COLOR = "#10b981";

function Metric({ label, value, icon: Icon, tone }: {
  label: string; value: string;
  icon?: React.ElementType; tone?: "green" | "red" | "amber" | "default";
}) {
  const cls = tone === "green" ? "text-emerald-500" : tone === "red" ? "text-red-500" : tone === "amber" ? "text-amber-500" : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
        {Icon && <Icon className="h-3 w-3" />}{label}
      </div>
      <div className={cn("text-lg font-semibold tabular-nums", cls)}>{value}</div>
    </div>
  );
}

function IBKRWidgets({ state, trades }: { state: Record<string, unknown>; trades: unknown[] }) {
  const riskMetrics = state.riskMetrics as Record<string, unknown> | undefined;
  const navHistory = (state.navHistory || []) as number[];
  const nav = (state.lastNav as number) || 0;
  const cash = (state.lastCash as number) || 0;
  const snapshot = state.lastSnapshot as Record<string, unknown> | undefined;
  const regime = (state.regime as Record<string, unknown>)?.composite as string || "—";
  const drawdownPct = riskMetrics?.drawdown
    ? ((riskMetrics.drawdown as Record<string, unknown>).drawdownPct as number) : 0;

  const navData = navHistory.map((v, i) => ({ day: i + 1, nav: v }));

  const holdings = (snapshot?.holdings || []) as Array<{
    symbol: string; currentPct: number; sleeve: string; currentValue: number; targetPct: number;
  }>;
  const pieData = holdings.filter(h => h.currentPct > 0).map(h => ({
    name: h.symbol, value: h.currentPct,
  }));
  if (pieData.length === 0 && nav > 0) pieData.push({ name: "Cash", value: 100 });

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium flex items-center gap-1.5">
        <TrendingUp className="h-4 w-4 text-emerald-500" />
        Portfolio Overview
        <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded ml-1">Paper</span>
      </h3>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        <Metric label="NAV" value={`$${nav.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={DollarSign} />
        <Metric label="Cash" value={`$${cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={DollarSign} />
        <Metric label="Drawdown" value={`${drawdownPct.toFixed(1)}%`} icon={drawdownPct > 5 ? AlertTriangle : Shield} tone={drawdownPct > 10 ? "red" : drawdownPct > 5 ? "amber" : "green"} />
        <Metric label="Regime" value={regime} icon={Activity} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-2">NAV History</div>
          {navData.length > 1 ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={navData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => [`$${Number(v).toLocaleString()}`, "NAV"]} />
                <Area type="monotone" dataKey="nav" stroke={GROWTH_COLOR} fill={GROWTH_COLOR} fillOpacity={0.1} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-xs text-muted-foreground">Collecting data...</div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-2">Allocation</div>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} label={({ name, value }) => `${name} ${Number(value).toFixed(0)}%`} labelLine={false}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`]} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-xs text-muted-foreground">No positions</div>
          )}
        </div>
      </div>

      {holdings.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-2">Holdings</div>
          <div className="space-y-1">
            {holdings.map(h => {
              const drift = h.currentPct - h.targetPct;
              return (
                <div key={h.symbol} className="flex items-center gap-3 text-sm">
                  <span className="font-medium w-12">{h.symbol}</span>
                  <span className={cn("text-[10px] px-1 py-0.5 rounded", h.sleeve === "growth" ? "bg-emerald-500/10 text-emerald-500" : "bg-indigo-500/10 text-indigo-500")}>{h.sleeve}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(h.currentPct, 100)}%`, backgroundColor: h.sleeve === "growth" ? "#10b981" : "#6366f1" }} />
                  </div>
                  <span className="tabular-nums text-xs w-12 text-right">{h.currentPct.toFixed(1)}%</span>
                  <span className={cn("tabular-nums text-xs w-14 text-right", Math.abs(drift) > 5 ? "text-red-500" : "text-muted-foreground")}>
                    {drift > 0 ? "+" : ""}{drift.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BinanceWidgets({ state, trades }: { state: Record<string, unknown>; trades: unknown[] }) {
  const portfolio = (state.portfolioUsdt as number) || 0;
  const position = state.openPosition as Record<string, unknown> | null;
  const trailingStop = state.trailingStop as Record<string, unknown> | null;
  const peak = (state.peakEquity as number) || portfolio;
  const consecutiveLosses = (state.consecutiveLosses as number) || 0;
  const drawdownPct = peak > 0 ? ((peak - portfolio) / peak) * 100 : 0;

  const tradeList = (trades || []) as Array<Record<string, unknown>>;
  const pnl = tradeList.reduce((sum, t) => {
    if (t.type === "SELL") return sum + (t.usdt as number);
    if (t.type === "BUY") return sum - (t.usdt as number);
    return sum;
  }, 0);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium flex items-center gap-1.5">
        <TrendingUp className="h-4 w-4 text-amber-500" />
        Swing Trader
        <span className="text-[10px] bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded ml-1">BTC/USDT</span>
      </h3>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        <Metric label="Portfolio" value={`$${portfolio.toFixed(2)}`} icon={DollarSign} />
        <Metric label="Position" value={position ? "Open" : "None"} icon={position ? TrendingUp : Activity} tone={position ? "green" : "default"} />
        <Metric label="Drawdown" value={`${drawdownPct.toFixed(1)}%`} icon={drawdownPct > 5 ? AlertTriangle : Shield} tone={drawdownPct > 10 ? "red" : drawdownPct > 5 ? "amber" : "green"} />
        <Metric label="P&L" value={`$${pnl.toFixed(2)}`} tone={pnl >= 0 ? "green" : "red"} icon={DollarSign} />
      </div>

      {position && (
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-1.5">Open Position</div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 text-sm">
            <div><span className="text-muted-foreground">Entry: </span><span className="font-medium">${((position.entryTrade as Record<string, unknown>)?.price as number)?.toFixed(2)}</span></div>
            <div><span className="text-muted-foreground">Qty: </span><span className="font-medium">{((position.entryTrade as Record<string, unknown>)?.qty as number)?.toFixed(6)}</span></div>
            <div><span className="text-muted-foreground">SL: </span><span className="text-red-500 font-medium">${(position.stopLossPrice as number)?.toFixed(2)}</span></div>
            <div><span className="text-muted-foreground">TP: </span><span className="text-emerald-500 font-medium">${(position.takeProfitPrice as number)?.toFixed(2)}</span></div>
          </div>
          {trailingStop && (
            <div className="text-[11px] text-muted-foreground mt-1">
              Trailing: HWM ${(trailingStop.highWaterMark as number)?.toFixed(2)} / {(trailingStop.trailPercent as number)}%
            </div>
          )}
        </div>
      )}

      {tradeList.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-2">Recent Trades ({tradeList.length} total)</div>
          <div className="space-y-1">
            {[...tradeList].reverse().slice(0, 5).map((t, i) => {
              const isBuy = t.type === "BUY";
              const time = new Date(t.timestamp as string);
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={cn("font-medium w-8", isBuy ? "text-emerald-500" : "text-red-500")}>{t.type as string}</span>
                  <span className="tabular-nums">{(t.qty as number)?.toFixed(5)}</span>
                  <span className="text-muted-foreground">@</span>
                  <span className="tabular-nums">${(t.price as number)?.toFixed(2)}</span>
                  <span className="flex-1" />
                  <span className="text-muted-foreground">{time.toLocaleDateString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function TradingWidgets({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.trading(companyId),
    queryFn: () => tradingApi.status(companyId),
    enabled: !!companyId,
    refetchInterval: 30_000,
  });

  if (isLoading || !data) return null;

  // Server returns only the relevant bot type for this company
  const response = data as unknown as Record<string, { state: Record<string, unknown> | null; trades: unknown[] }>;
  const ibkr = response.ibkr;
  const binance = response.binance;

  const hasIbkr = ibkr?.state != null;
  const hasBinance = binance?.state != null;

  if (!hasIbkr && !hasBinance) return null;

  return (
    <div className="space-y-4">
      {hasIbkr && <IBKRWidgets state={ibkr.state!} trades={ibkr.trades} />}
      {hasBinance && <BinanceWidgets state={binance.state!} trades={binance.trades} />}
    </div>
  );
}
