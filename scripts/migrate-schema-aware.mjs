#!/usr/bin/env node
/**
 * Schema-aware migration runner.
 *
 * ## Why this exists
 *
 * Upstream's migrations hardcode the `public` schema — 97 of 201 files contain
 * `"public"."agents"`, `public.decision_queues` and friends. That is fine for a
 * stock deployment, where paperclip owns `public`.
 *
 * This deployment does not. The Neon→Supabase move (2026-08-01) placed every
 * paperclip table in a schema named `paperclip` (the connection string carries
 * `options=-csearch_path=paperclip,extensions`). Migrations 0000–0098 applied
 * cleanly *before* that move, while the schema really was `public`; everything
 * after it fails with:
 *
 *     relation "public.company_skills" does not exist
 *
 * so paperclip could never be upgraded again without this.
 *
 * ## The one subtlety that makes this safe
 *
 * `drizzle.__drizzle_migrations` is `(id, hash, created_at)` — there is no
 * `name` column, so paperclip identifies applied migrations purely by
 * sha256(file content), via `mapHashesToMigrationFiles()` in packages/db.
 *
 * That means rewriting the .sql files on disk would be a disaster: the 99
 * already-applied files would hash differently, stop resolving as applied, and
 * be re-run against a live database.
 *
 * So this script does the rewrite **in memory only**:
 *
 *   - applies the REWRITTEN sql  (targets the real schema)
 *   - records the ORIGINAL hash  (keeps upstream's detection correct forever)
 *
 * On-disk files stay pristine. `inspectMigrations()`, the server's stale-schema
 * boot check, and any future `pnpm db:migrate` all keep working unmodified.
 *
 * ## Usage
 *
 *   DATABASE_URL=... PAPERCLIP_DB_SCHEMA=paperclip node scripts/migrate-schema-aware.mjs [--dry-run]
 *
 * Set PAPERCLIP_DB_SCHEMA=public to make this a pure pass-through (no rewrite),
 * i.e. it degrades to stock behaviour on a normal deployment.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { globSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

const DB_URL = process.env.DATABASE_URL;
const SCHEMA = process.env.PAPERCLIP_DB_SCHEMA || "public";
const DRY_RUN = process.argv.includes("--dry-run");
/**
 * `src/migrations`, NOT `dist/migrations`.
 *
 * packages/db resolves its own folder relative to the module that runs —
 * `client.ts:9` does `new URL("./migrations", import.meta.url)` — and the
 * package's `exports` map points at `./src/*.ts`, which is what the server
 * actually loads (the container runs it through the tsx loader). So `src` is
 * the set the server migrates against, always.
 *
 * `dist/migrations` is a build artefact, produced only by `pnpm -C packages/db
 * build` (`cp -r src/migrations dist/migrations`), and nothing at runtime reads
 * it. In the 2026-08-24 image it was stale at 0202 while `src` carried 0226.
 * Pointed here, this script reported "No pending migrations" and exited 0 —
 * after which the server hit 0203 and crashlooped, looking exactly like the
 * failure this script exists to prevent.
 */
const MIGRATIONS_DIR =
  process.env.PAPERCLIP_MIGRATIONS_DIR || "/app/packages/db/src/migrations";

function die(msg) {
  console.error(`[migrate] FATAL: ${msg}`);
  process.exit(1);
}
if (!DB_URL) die("DATABASE_URL unset");

function loadPostgres() {
  for (const p of [
    "postgres",
    ...globSync("/app/node_modules/.pnpm/postgres@*/node_modules/postgres"),
  ]) {
    try {
      return require(p);
    } catch {
      /* keep looking */
    }
  }
  die("could not resolve the `postgres` driver");
}

/**
 * Rewrite schema-qualified references. Both forms appear in the generated SQL:
 * quoted (`"public"."agents"`) and bare (`public.decision_queues`).
 *
 * The bare form is deliberately anchored on a word boundary and followed by an
 * identifier char, so it cannot corrupt the string `public` appearing inside a
 * column name, comment, or literal (e.g. `is_public`, `publication`).
 */
export function rewriteSchema(sql, schema) {
  if (schema === "public") return sql;
  return sql
    .replaceAll('"public".', `"${schema}".`)
    .replace(/\bpublic\.(?=[A-Za-z_"])/g, `${schema}.`);
}

/** drizzle's own separator — mirrors splitMigrationStatements() in packages/db. */
function splitStatements(content) {
  return content
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const sql = loadPostgres()(DB_URL, { max: 1, idle_timeout: 20, connect_timeout: 30 });

try {
  // Pin the search_path for this session rather than trusting the connection
  // string. Some migrations create GIN indexes with `gin_trgm_ops`, which only
  // resolves when the schema holding pg_trgm is on the path — on Supabase that
  // is `extensions`, not `public`. A URL carrying only `search_path=paperclip`
  // fails midway through with:
  //
  //     operator class "gin_trgm_ops" does not exist for access method "gin"
  //
  // (seen 2026-08-04, 42 migrations in). max:1 means this one connection serves
  // every statement below, including the transactions.
  const searchPath = process.env.PAPERCLIP_DB_SEARCH_PATH || `${SCHEMA}, extensions`;
  await sql.unsafe(`SET search_path TO ${searchPath}`);
  const [{ search_path: effective }] = await sql`show search_path`;
  console.log(`[migrate] search_path=${effective}`);

  const journalPath = path.join(MIGRATIONS_DIR, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  // Hash every migration's ORIGINAL content — this is the identity paperclip uses.
  const files = [];
  for (const entry of entries) {
    const file = `${entry.tag}.sql`;
    const content = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    files.push({
      file,
      when: entry.when,
      content,
      hash: createHash("sha256").update(content).digest("hex"),
    });
  }

  const appliedRows = await sql`select hash from drizzle.__drizzle_migrations order by id`;
  const applied = new Set(appliedRows.map((r) => r.hash));
  const pending = files.filter((f) => !applied.has(f.hash));

  console.log(`[migrate] schema=${SCHEMA} total=${files.length} applied=${applied.size} pending=${pending.length}`);

  // Staleness guard. The database can never have applied more migrations than
  // the source of truth contains, so `applied > total` means MIGRATIONS_DIR is
  // not the set the server will run — the stale-dist trap above. Failing here
  // is strictly better than the alternative: reporting "No pending migrations",
  // exiting 0, and letting the server crashloop on the first migration this
  // directory has never heard of.
  if (applied.size > files.length) {
    die(
      `stale migrations dir: ${MIGRATIONS_DIR} holds ${files.length} migration(s) but the ` +
        `database has ${applied.size} applied. This is almost certainly dist/ lagging src/ — ` +
        `re-point PAPERCLIP_MIGRATIONS_DIR at packages/db/src/migrations.`,
    );
  }
  if (pending.length === 0) {
    console.log("[migrate] No pending migrations");
  }

  if (DRY_RUN) {
    const rewritten = pending.filter((f) => rewriteSchema(f.content, SCHEMA) !== f.content);
    console.log(`[migrate] DRY RUN — ${rewritten.length}/${pending.length} pending migration(s) need a schema rewrite`);
    for (const f of pending.slice(0, 5)) console.log(`[migrate]   would apply ${f.file}`);
    if (pending.length > 5) console.log(`[migrate]   ... and ${pending.length - 5} more`);
  } else {
    let n = 0;
    for (const f of pending) {
      const statements = splitStatements(rewriteSchema(f.content, SCHEMA));
      await sql.begin(async (tx) => {
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
        // ORIGINAL hash — see the header. This is what keeps upstream's
        // hash-based detection correct on every future run.
        await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${f.hash}, ${f.when})`;
      });
      n += 1;
      if (n % 10 === 0 || n === pending.length) {
        console.log(`[migrate] applied ${n}/${pending.length} (${f.file})`);
      }
    }
    if (n > 0) console.log(`[migrate] Migrations complete — applied ${n}`);
  }
} finally {
  await sql.end();
}
