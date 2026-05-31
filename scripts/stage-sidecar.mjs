/**
 * stage-sidecar — produce the pruned sidecar bundle that Tauri ships as a
 * resource. We drop @openai (the codex native binary, ~190MB) because we use
 * the user's system codex, and remove any dangling symlinks (Tauri's resource
 * collector follows them and fails). Keeps @eigenpal + pure-JS deps (~14MB).
 *
 * Run from the repo root after `npm run build` in sidecar/.
 *   node scripts/stage-sidecar.mjs
 *
 * The platform `node` binary is placed separately (see the release workflow /
 * README) at app/src-tauri/binaries/node-<target-triple>.
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath (not .pathname) — Windows file URLs are `/C:/...`, which breaks path joins.
const root = fileURLToPath(new URL("..", import.meta.url));
const sidecar = join(root, "sidecar");
const dist = join(sidecar, "dist", "index.js");
const out = join(sidecar, "bundle", "sidecar");

if (!existsSync(dist)) {
  console.error("sidecar/dist/index.js missing — run `npm run build` in sidecar/ first.");
  process.exit(1);
}

rmSync(join(sidecar, "bundle"), { recursive: true, force: true });
mkdirSync(join(out, "dist"), { recursive: true });
cpSync(dist, join(out, "dist", "index.js"));
// verbatimSymlinks keeps symlinks relative (otherwise cpSync rewrites them to
// absolute paths into the SOURCE tree — which then leak into the bundle).
cpSync(join(sidecar, "node_modules"), join(out, "node_modules"), {
  recursive: true,
  verbatimSymlinks: true,
});

// Drop @openai (system codex is used instead).
rmSync(join(out, "node_modules", "@openai"), { recursive: true, force: true });

// Remove dangling symlinks anywhere in the tree.
let removed = 0;
const sweep = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      try {
        realpathSync(p);
      } catch {
        rmSync(p, { force: true });
        removed++;
      }
    } else if (st.isDirectory()) {
      sweep(p);
    }
  }
};
sweep(join(out, "node_modules"));

console.log(`staged sidecar bundle → sidecar/bundle/sidecar (removed ${removed} dangling symlinks)`);
