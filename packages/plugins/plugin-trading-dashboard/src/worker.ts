import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Reads whatever each bot actually persists — deliberately two different
 * shapes, because the two bots genuinely store state differently:
 *
 *   sovereign-ibkr-fund : SQLite at /fund-state/state/bot-state.db
 *                         (state_kv key/value + a trades ledger)
 *   trading-bot         : JSON files in its checkout
 *
 * The host route this replaces looked for `bot-state.json` under
 * `instances/<id>/workspace/ibkr-fund` for BOTH. That directory does not exist —
 * the fund moved to SQLite on a separate durable mount — so the fund half of the
 * dashboard had been silently empty. Reading the real source is most of the
 * value of this rewrite.
 */

const PAPERCLIP_HOME = process.env.PAPERCLIP_HOME || "/paperclip";
const INSTANCE_ID = process.env.PAPERCLIP_INSTANCE_ID || "default";

const DEFAULTS = {
  fundDb: "/fund-state/state/bot-state.db",
  botDir: "trading-co/trading-bot",
};

function workspaceBase(): string {
  return resolve(PAPERCLIP_HOME, "instances", INSTANCE_ID, "workspace");
}

function resolveDir(configured: string): string {
  return isAbsolute(configured) ? configured : resolve(workspaceBase(), configured);
}

function readJsonSafe(filePath: string): unknown {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ fund */

type Json = Record<string, unknown>;

/**
 * Open the fund ledger read-only.
 *
 * `node:sqlite` is imported lazily so the whole plugin does not fail to load on
 * a runtime without it — the dashboard should degrade to "fund not connected",
 * not take the worker down.
 *
 * readOnly is not just hygiene: the fund writes this database continuously in
 * WAL mode, and a reader that could write might contend with a live trading
 * cycle.
 */
async function readFundState(dbPath: string): Promise<{ state: Json; trades: Json[] } | null> {
  if (!existsSync(dbPath)) return null;

  let DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => {
    prepare(sql: string): { all(...params: unknown[]): unknown[] };
    close(): void;
  };
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return null;
  }

  let db: { prepare(sql: string): { all(...p: unknown[]): unknown[] }; close(): void } | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });

    // state_kv holds JSON-encoded values under well-known keys.
    const state: Json = {};
    for (const row of db.prepare("SELECT key, value FROM state_kv").all() as Array<{
      key: string;
      value: string;
    }>) {
      try {
        state[row.key] = JSON.parse(row.value);
      } catch {
        state[row.key] = row.value;
      }
    }

    // trades.data is the JSON trade record (symbol, action, fill, realised P&L,
    // cost basis, reason). Newest last, matching the JSON bots' ordering.
    const trades: Json[] = [];
    for (const row of db.prepare("SELECT data FROM trades ORDER BY id").all() as Array<{
      data: string;
    }>) {
      try {
        trades.push(JSON.parse(row.data) as Json);
      } catch {
        /* skip an unreadable row rather than losing the whole ledger */
      }
    }

    return { state, trades };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------- bot */

function readBotState(dir: string): { state: Json; trades: Json[] } | null {
  const state = readJsonSafe(resolve(dir, "bot-state.json")) as Json | null;
  if (!state) return null;
  const trades = readJsonSafe(resolve(dir, "trade-history.json"));
  return { state, trades: Array.isArray(trades) ? (trades as Json[]) : [] };
}

/* ---------------------------------------------------------------- plugin */

const plugin = definePlugin({
  /**
   * This worker serves more than one company (the fund company and the trading
   * company each have their own Trading page), so it must declare itself
   * multi-company or the host fails closed: `configChanged` for a second,
   * distinct company is rejected with CROSS_TENANT_CONFIG, that company never
   * receives its config, and `accounts` silently falls back to the "both"
   * default — showing each company the other's book, which is exactly what the
   * per-company scoping exists to prevent.
   *
   * The contract this asserts (per-company state keyed on companyId) is already
   * satisfied: configuration is pulled per request via `ctx.config.get(companyId)`
   * rather than held worker-global, and the only state here is the read-through
   * cache, which is keyed by companyId. The module constants above are derived
   * from env and are company-independent.
   */
  multiCompanyConfig: true,

  async setup(ctx) {
    ctx.logger.info("trading-dashboard plugin setup");

    /**
     * Short read-through cache.
     *
     * The fund ledger is a 400KB SQLite file with a ~1.3MB WAL on an SD card,
     * and the UI polls. Re-reading it on every poll made the page visibly slow.
     * The underlying data only changes on an agent heartbeat (4h), so a few
     * seconds of staleness costs nothing and removes the repeated disk hit.
     */
    const cache = new Map<string, { at: number; value: unknown }>();
    const CACHE_MS = 5_000;

    ctx.data.register("status", async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";

      const cached = cache.get(companyId);
      if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

      const config = companyId ? await ctx.config.get(companyId).catch(() => null) : null;

      // Which book this company owns. Per-company config, so /IBK/trading shows
      // the fund and /ZAC/trading shows the crypto bot rather than both pages
      // showing both.
      const accounts = typeof config?.accounts === "string" ? config.accounts : "both";
      const wantFund = accounts === "both" || accounts === "fund";
      const wantBot = accounts === "both" || accounts === "bot";

      const fundDb =
        typeof config?.fundDb === "string" && config.fundDb ? config.fundDb : DEFAULTS.fundDb;
      const botDir = resolveDir(
        typeof config?.botDir === "string" && config.botDir ? config.botDir : DEFAULTS.botDir,
      );

      const fund = wantFund ? await readFundState(fundDb) : null;
      const bot = wantBot ? readBotState(botDir) : null;

      if (wantFund && !fund) ctx.logger.warn("fund ledger not readable", { fundDb });
      if (wantBot && !bot) ctx.logger.warn("bot state not readable", { botDir });

      const value = {
        // `shown` distinguishes "this company does not own that book" from
        // "the book is configured but unreadable" — the UI omits the section
        // entirely in the first case and explains itself in the second.
        shown: { fund: wantFund, bot: wantBot },
        fund: fund ? { state: fund.state, trades: fund.trades } : null,
        bot: bot ? { state: bot.state, trades: bot.trades } : null,
        searched: { fundDb, botDir },
      };
      cache.set(companyId, { at: Date.now(), value });
      return value;
    });
  },
});

runWorker(plugin, import.meta.url);
