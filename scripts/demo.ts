/**
 * `deno task demo`: runs runboard on a throwaway copy of the sample runs.
 *
 * Answering a question writes into the runs directory, so the demo never points at
 * `tests/fixtures` directly — that would dirty the checkout and break the tests.
 */
import { copy } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import { loadConfig } from "../src/config.ts";
import { serve } from "../src/main.ts";

const samples = fromFileUrl(new URL("../tests/fixtures/runs", import.meta.url));
const runsRoot = join(await Deno.makeTempDir({ prefix: "runboard-demo-" }), "runs");
await copy(samples, runsRoot);

// File times do not survive git, so age the abandoned sample import to show it as stale.
const longAgo = new Date(Date.now() - 24 * 60 * 60_000);
await Deno.utime(join(runsRoot, "imports/tracker-demo42-dead00/output.jsonl"), longAgo, longAgo);

// The demo is read-only regardless of any local config: it must never start a real runner.
const config = { ...loadConfig(), runsRoot, launcher: null, title: "runboard demo" };
console.log(`Sample runs copied to ${runsRoot} (safe to answer questions here)`);
serve(config);
