import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertCompanyAccess } from "./authz.js";

const PAPERCLIP_HOME = process.env.PAPERCLIP_HOME || process.env.HOME || "/paperclip";
const INSTANCE_ID = process.env.PAPERCLIP_INSTANCE_ID || "default";

function readJsonSafe(filePath: string): unknown {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function getWorkspaceBase(): string {
  return resolve(PAPERCLIP_HOME, "instances", INSTANCE_ID, "workspace");
}

// Map company names to their workspace bot data paths
const COMPANY_BOT_PATHS: Record<string, { stateFile: string; tradeFile: string; type: string }[]> = {};

function getBotPaths(companyName: string, wsBase: string): { stateFile: string; tradeFile: string; type: string }[] {
  const lower = companyName.toLowerCase();
  if (lower.includes("trading") || lower.includes("binance") || lower.includes("zack")) {
    return [{
      stateFile: resolve(wsBase, "trading-co", "trading-bot", "bot-state.json"),
      tradeFile: resolve(wsBase, "trading-co", "trading-bot", "trade-history.json"),
      type: "binance",
    }];
  }
  if (lower.includes("ibkr") || lower.includes("fund") || lower.includes("interactive")) {
    return [{
      stateFile: resolve(wsBase, "ibkr-fund", "bot-state.json"),
      tradeFile: resolve(wsBase, "ibkr-fund", "trade-history.json"),
      type: "ibkr",
    }];
  }
  return [];
}

export function tradingRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/trading/status", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const wsBase = getWorkspaceBase();

    // Look up company name to determine which bot data to return
    const companies = await db.query.companies.findMany({
      where: (c, { eq }) => eq(c.id, companyId),
      columns: { id: true, name: true },
    });
    const company = companies[0];
    const bots = company ? getBotPaths(company.name, wsBase) : [];

    const result: Record<string, { state: unknown; trades: unknown }> = {};
    for (const bot of bots) {
      result[bot.type] = {
        state: readJsonSafe(bot.stateFile),
        trades: readJsonSafe(bot.tradeFile) || [],
      };
    }

    res.json(result);
  });

  return router;
}
