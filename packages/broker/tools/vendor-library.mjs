// BOB-212 (ADR 0015 §6): the library page's two vendored files, pinned, in public/vendor/, each named by its version
// so the Worker serves it immutable. markdown-it's single-file ESM build, and mermaid 11.x's single-file build (it sets
// globalThis.mermaid). Their licences go in public/vendor/LICENSES.txt. Re-run after a version change here, and change
// the names in public/library.js to match.
//   node packages/broker/tools/vendor-library.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PINS = [
  { name: "markdown-it", version: "15.0.3", file: "dist/browser/markdown-it.esm.min.mjs" },
  { name: "mermaid", version: "11.17.2", file: "dist/mermaid.min.js" },
];
const out = fileURLToPath(new URL("../public/vendor/", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "bobnet-vendor-"));
const licences = [];
for (const p of PINS) {
  const tgz = execFileSync("npm", ["pack", "--silent", `${p.name}@${p.version}`], { cwd: tmp, encoding: "utf8" }).trim().split("\n").pop();
  const dir = join(tmp, p.name);
  execFileSync("mkdir", ["-p", dir]);
  execFileSync("tar", ["-xzf", join(tmp, tgz), "-C", dir]);
  // The source map isn't vendored: its reference would only 404.
  const code = readFileSync(join(dir, "package", p.file), "utf8").replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n");
  const name = `${p.name}-${p.version}.min.js`;
  writeFileSync(join(out, name), code);
  licences.push(`${p.name} ${p.version} (${name}), from npm\n\n${readFileSync(join(dir, "package", "LICENSE"), "utf8").trim()}\n`);
  console.log(`${name}: ${Math.round(code.length / 1024)} KB`);
}
writeFileSync(join(out, "LICENSES.txt"), licences.join(`\n${"-".repeat(78)}\n\n`));
