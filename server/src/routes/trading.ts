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

export function tradingRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/trading/status", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const wsBase = getWorkspaceBase();

    // IBKR Fund data
    const ibkrState = readJsonSafe(resolve(wsBase, "ibkr-fund", "bot-state.json"));
    const ibkrTrades = readJsonSafe(resolve(wsBase, "ibkr-fund", "trade-history.json"));

    // Binance Trading Bot data
    const binanceState = readJsonSafe(resolve(wsBase, "trading-co", "trading-bot", "bot-state.json"));
    const binanceTrades = readJsonSafe(resolve(wsBase, "trading-co", "trading-bot", "trade-history.json"));

    res.json({
      ibkr: {
        state: ibkrState,
        trades: ibkrTrades || [],
      },
      binance: {
        state: binanceState,
        trades: binanceTrades || [],
      },
    });
  });

  return router;
}
