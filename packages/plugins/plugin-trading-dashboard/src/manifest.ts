import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "paperclip-trading-dashboard";
export const WIDGET_SLOT_ID = "trading-widgets";
export const PAGE_SLOT_ID = "trading-dashboard";

/**
 * Trading Dashboard.
 *
 * This started life as a patch to the host: a route in `server/src/routes/`, two
 * components in `ui/src/`, plus edits to `app.ts`, `routes/index.ts`,
 * `Dashboard.tsx` and `ui/package.json`. Every one of those files is upstream's,
 * so every upstream rebase conflicted on all five — and `recharts` in the host's
 * `ui/package.json` dragged ~200 lines of lockfile churn along with it.
 *
 * As a plugin it owns its own dependencies and touches no upstream file, so the
 * fork rebases cleanly forever.
 */
const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Trading Dashboard",
  description:
    "Live portfolio and swing-trader widgets for the sovereign-ibkr-fund and trading-bot agents. Reads bot-state.json / trade-history.json from the agent workspaces — never touches an exchange.",
  author: "Isaac Rowntree",
  categories: ["ui"],
  capabilities: [
    "ui.dashboardWidget.register",
    "ui.page.register",
    "companies.read",
    "projects.read",
    "project.workspaces.read",
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      /**
       * Explicit locations, so the plugin never has to guess.
       *
       * The host route this replaces inferred them from the company NAME
       * (`includes("ibkr")`, `includes("binance")`) and looked for
       * `bot-state.json` under the instance workspace. The fund has since moved
       * to SQLite on a separate durable mount, so that path stopped existing and
       * the fund panel silently showed nothing.
       */
      /**
       * Which book this company owns.
       *
       * Config is resolved per-company (`ctx.config.get(companyId)`), so the
       * IBKR Fund company shows only the fund and the Trading company shows
       * only the crypto bot. Defaults to "both" so a single-company install
       * still sees everything without configuring anything.
       */
      accounts: {
        type: "string",
        title: "Accounts shown",
        enum: ["both", "fund", "bot"],
        default: "both",
        description:
          "Which trading account this company's Trading page displays. 'fund' = sovereign-ibkr-fund only, 'bot' = crypto swing trader only.",
      },
      fundDb: {
        type: "string",
        title: "Fund ledger (SQLite)",
        default: "/fund-state/state/bot-state.db",
        description:
          "Path to sovereign-ibkr-fund's bot-state.db. Read-only; opened read-only so it cannot contend with a live trading cycle.",
      },
      botDir: {
        type: "string",
        title: "Trading bot state directory",
        default: "trading-co/trading-bot",
        description:
          "Directory holding the crypto bot's bot-state.json / trade-history.json. Relative to the instance workspace, or an absolute path.",
      },
    },
  },
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: WIDGET_SLOT_ID,
        displayName: "Trading",
        exportName: "TradingWidgets",
        order: 10,
      },
      {
        // A page slot without a routePath is never routable — the loader only
        // registers routes for slots that declare one. Mounts at
        // /:companyPrefix/trading ("trading" is not a reserved segment).
        type: "page",
        id: PAGE_SLOT_ID,
        routePath: "trading",
        displayName: "Trading",
        exportName: "TradingDashboardPage",
        order: 20,
      },
    ],
  },
};

export default manifest;
