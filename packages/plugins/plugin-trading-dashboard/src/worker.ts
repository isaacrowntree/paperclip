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
  async setup(ctx) {
    ctx.logger.info("trading-dashboard plugin setup");

    ctx.data.register("status", async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const config = companyId ? await ctx.config.get(companyId).catch(() => null) : null;

      const fundDb =
        typeof config?.fundDb === "string" && config.fundDb ? config.fundDb : DEFAULTS.fundDb;
      const botDir = resolveDir(
        typeof config?.botDir === "string" && config.botDir ? config.botDir : DEFAULTS.botDir,
      );

      const fund = await readFundState(fundDb);
      const bot = readBotState(botDir);

      if (!fund && !bot) {
        // Name the paths. The old route returned a bare `{}`, so an empty panel
        // was indistinguishable from a misconfigured path.
        ctx.logger.warn("no bot state found", { fundDb, botDir });
      }

      return {
        fund: fund ? { state: fund.state, trades: fund.trades } : null,
        bot: bot ? { state: bot.state, trades: bot.trades } : null,
        searched: { fundDb, botDir },
      };
    });
  },
});

runWorker(plugin, import.meta.url);
