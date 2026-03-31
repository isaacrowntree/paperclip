import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { projects, projectWorkspaces } from "@paperclipai/db";
import { eq, and, isNull } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertCompanyAccess } from "./authz.js";
import { resolveManagedProjectWorkspaceDir } from "../home-paths.js";

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

function getLegacyWorkspaceBase(): string {
  return resolve(PAPERCLIP_HOME, "instances", INSTANCE_ID, "workspace");
}

interface BotPath { stateFile: string; tradeFile: string; type: string }

function getBotPathsForDir(dir: string, type: string): BotPath {
  return {
    stateFile: resolve(dir, "bot-state.json"),
    tradeFile: resolve(dir, "trade-history.json"),
    type,
  };
}

function getLegacyBotPaths(companyName: string): BotPath[] {
  const lower = companyName.toLowerCase();
  const wsBase = getLegacyWorkspaceBase();
  if (lower.includes("trading") || lower.includes("binance") || lower.includes("zack")) {
    return [getBotPathsForDir(resolve(wsBase, "trading-co", "trading-bot"), "binance")];
  }
  if (lower.includes("ibkr") || lower.includes("fund") || lower.includes("interactive")) {
    return [getBotPathsForDir(resolve(wsBase, "ibkr-fund"), "ibkr")];
  }
  return [];
}

function deriveRepoName(repoUrl: string | null): string | null {
  if (!repoUrl) return null;
  try {
    const parsed = new URL(repoUrl);
    return parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop()?.replace(/\.git$/i, "") ?? null;
  } catch {
    return null;
  }
}

export function tradingRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/trading/status", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    // Look up company name
    const companies = await db.query.companies.findMany({
      where: (c, { eq: eqFn }) => eqFn(c.id, companyId),
      columns: { id: true, name: true },
    });
    const company = companies[0];
    if (!company) {
      res.json({});
      return;
    }

    // Collect all candidate directories: managed workspace paths + legacy paths.
    // State files are runtime artifacts that may live in either location.
    const candidateDirs: { dir: string; type: string }[] = [];

    // Managed workspace paths (via project_workspaces)
    const companyProjects = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.companyId, companyId), isNull(projects.archivedAt)));
    const lower = company.name.toLowerCase();
    const botType = (lower.includes("ibkr") || lower.includes("fund") || lower.includes("interactive"))
      ? "ibkr"
      : (lower.includes("trading") || lower.includes("binance") || lower.includes("zack"))
        ? "binance"
        : "unknown";
    for (const project of companyProjects) {
      const workspaceRows = await db
        .select({ repoUrl: projectWorkspaces.repoUrl })
        .from(projectWorkspaces)
        .where(and(eq(projectWorkspaces.companyId, companyId), eq(projectWorkspaces.projectId, project.id)));
      for (const ws of workspaceRows) {
        const repoName = deriveRepoName(ws.repoUrl);
        const managedDir = resolveManagedProjectWorkspaceDir({
          companyId,
          projectId: project.id,
          repoName,
        });
        if (existsSync(managedDir)) {
          candidateDirs.push({ dir: managedDir, type: botType });
        }
      }
    }

    // Always include legacy paths as candidates too
    for (const legacy of getLegacyBotPaths(company.name)) {
      const dir = resolve(legacy.stateFile, "..");
      candidateDirs.push({ dir, type: legacy.type });
    }

    // Pick the first candidate that has a bot-state.json, or fall back to first candidate
    let bots: BotPath[] = [];
    for (const c of candidateDirs) {
      const stateFile = resolve(c.dir, "bot-state.json");
      if (existsSync(stateFile)) {
        bots = [getBotPathsForDir(c.dir, c.type)];
        break;
      }
    }
    if (bots.length === 0 && candidateDirs.length > 0) {
      bots = [getBotPathsForDir(candidateDirs[0].dir, candidateDirs[0].type)];
    }

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
