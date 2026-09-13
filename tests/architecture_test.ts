/**
 * Enforces the dependency rule: source code dependencies point inward only.
 *
 *   domain  <-  application  <-  adapters  <-  main.ts
 *
 * The domain and application layers must also stay free of the runtime (`Deno.*`) and of
 * I/O libraries, so they can be reasoned about and tested without a filesystem.
 */
import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";

const SRC = fromFileUrl(new URL("../src", import.meta.url));

type Layer = "domain" | "application" | "adapters" | "main";

/** Which layers each layer may import from. */
const ALLOWED: Record<Layer, Layer[]> = {
  domain: ["domain"],
  application: ["domain", "application"],
  adapters: ["domain", "application", "adapters"],
  main: ["domain", "application", "adapters", "main"],
};

function layerOf(path: string): Layer {
  const top = path.split("/")[0];
  if (top === "domain" || top === "application" || top === "adapters") return top;
  return "main";
}

interface SourceFile {
  path: string;
  layer: Layer;
  text: string;
}

async function sources(): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for await (const entry of walk(SRC, { exts: [".ts"], includeDirs: false })) {
    const path = relative(SRC, entry.path);
    files.push({ path, layer: layerOf(path), text: await Deno.readTextFile(entry.path) });
  }
  return files;
}

function localImports(file: SourceFile): string[] {
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
  // `import x from "…"`, `export … from "…"`, bare `import "…"` and dynamic `import("…")`.
  const specifiers = /(?:from\s+|import\s*\(?\s*)"(\.{1,2}\/[^"]+)"/g;
  return [...file.text.matchAll(specifiers)].map((match) => {
    const parts = [...(dir ? dir.split("/") : []), ...match[1].split("/")];
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === "..") resolved.pop();
      else if (part !== ".") resolved.push(part);
    }
    return resolved.join("/");
  });
}

Deno.test("every import points inward", async () => {
  const violations: string[] = [];
  for (const file of await sources()) {
    for (const target of localImports(file)) {
      if (!ALLOWED[file.layer].includes(layerOf(target))) {
        violations.push(`${file.path} (${file.layer}) imports ${target} (${layerOf(target)})`);
      }
    }
  }
  assertEquals(violations, []);
});

Deno.test("domain and application use no runtime or I/O APIs", async () => {
  const violations: string[] = [];
  for (const file of await sources()) {
    if (file.layer !== "domain" && file.layer !== "application") continue;
    for (const [pattern, why] of [[/\bDeno\./, "Deno runtime"], [/from\s+"@std\//, "std library"]] as const) {
      if (pattern.test(file.text)) violations.push(`${file.path} uses the ${why}`);
    }
  }
  assertEquals(violations, []);
});
