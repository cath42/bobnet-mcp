import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "@bobnet/client/config";
import { ZodError } from "zod";
import { loadSupervisorConfig, strandedState } from "./config.ts";
import { Policy } from "./policy.ts";

// `bin.ts check` (ADR 0008 §4 step 1): the preflight an upgrading supervisor runs in the new release
// before it switches to it. It is run by that release's node and code, so its modules have imported
// by the time it runs (bin.ts imports them all); it checks the node version against the release's
// engines and parses the three configs under the release's schemas. It opens no database, takes no
// pid file and connects to nothing.

/** [major, minor, patch] of "24.1.0" or "v24.1.0"; missing parts are 0. */
function parts(v: string): [number, number, number] | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

const cmp = (a: [number, number, number], b: [number, number, number]) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return 0;
};

/**
 * Whether a node version satisfies an `engines` range as npm writes them: comparators (>=, >, <=,
 * <, =, ^, ~, a bare version) joined by spaces, alternatives by ||. Anything else doesn't.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parts(version);
  if (!v) return false;
  return range.split("||").some((alt) =>
    alt
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((c) => {
        const m = /^(>=|<=|>|<|=|\^|~)?\s*(v?\d+(?:\.\d+){0,2})$/.exec(c);
        if (!m) return false;
        const want = parts(m[2]!)!;
        const d = cmp(v, want);
        switch (m[1]) {
          case ">=":
            return d >= 0;
          case "<=":
            return d <= 0;
          case ">":
            return d > 0;
          case "<":
            return d < 0;
          case "^":
            return d >= 0 && v[0] === want[0];
          case "~":
            return d >= 0 && v[0] === want[0] && v[1] === want[1];
          default:
            return d === 0;
        }
      }),
  );
}

/**
 * What would stop this release starting here, one line each; none when it may. `release` is the
 * release's own folder; `env` is what bin.ts reads the broker's config.json and credentials from.
 */
export function preflight(dir: string, release: string, nodeVersion = process.versions.node, env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const attempt = (what: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      const why = err instanceof ZodError ? err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") : (err as Error).message.split("\n").slice(0, 5).join(" ");
      problems.push(`${what}: ${why}`);
    }
  };
  attempt("engines", () => {
    const range = (JSON.parse(readFileSync(join(release, "package.json"), "utf8")) as { engines?: { node?: string } }).engines?.node;
    if (range && !satisfies(nodeVersion, range)) throw new Error(`node ${nodeVersion} doesn't satisfy ${range}`);
  });
  attempt("supervisor.yaml", () => {
    const config = loadSupervisorConfig(dir);
    const stranded = strandedState(readFileSync(join(dir, "supervisor.yaml"), "utf8"), config.stateDir);
    if (stranded) throw new Error(stranded);
  });
  attempt("policy.yaml", () => void Policy.load(dir));
  attempt("config.json", () => {
    JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    loadConfig(env);
  });
  return problems;
}
