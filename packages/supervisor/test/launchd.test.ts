import { describe, expect, it } from "vitest";
import { launchAgentPlist, servicePath } from "../src/launchd.ts";

describe("launchd", () => {
  it("builds a PATH without per-shell temporaries, node's folder first", () => {
    const node = "/Users/x/.local/share/fnm/node-versions/v24/installation/bin/node";
    const path = servicePath(node, "/Users/x/.local/state/fnm_multishells/123_456/bin:/opt/homebrew/bin:/usr/bin");
    expect(path.split(":")).toEqual(["/Users/x/.local/share/fnm/node-versions/v24/installation/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]);
  });

  it("writes a plist that runs the supervisor and restarts it after a crash", () => {
    const plist = launchAgentPlist("/a/bin.ts", "/n/node", "/Users/x");
    expect(plist).toContain("<string>/n/node</string><string>/a/bin.ts</string>");
    expect(plist).toContain("<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>");
    expect(plist).toContain("/Users/x/.local/state/bobnet/supervisor.log");
    expect(plist).not.toContain("fnm_multishells");
  });
});
