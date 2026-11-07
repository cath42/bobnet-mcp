import { describe, expect, it } from "vitest";
import { systemdUnit } from "../src/systemd.ts";

describe("systemd", () => {
  it("writes a user unit that runs the supervisor, restarts it after a failure, and reads its credentials from a file", () => {
    const unit = systemdUnit("/home/x/bobnet/packages/supervisor/src/bin.ts", "/home/x/.local/share/fnm/node-versions/v24/installation/bin/node", "/home/x");
    expect(unit).toContain('ExecStart="/home/x/.local/share/fnm/node-versions/v24/installation/bin/node" "/home/x/bobnet/packages/supervisor/src/bin.ts"');
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("EnvironmentFile=-%h/.config/bobnet/supervisor.env");
    expect(unit).toContain("StandardError=append:/home/x/.local/state/bobnet/supervisor.log");
    expect(unit).toMatch(/^Environment="PATH=\/home\/x\/\.local\/share\/fnm\/node-versions\/v24\/installation\/bin:/m);
    expect(unit).toContain("WantedBy=default.target");
  });

  it("quotes a path with spaces, quotes or a percent sign", () => {
    expect(systemdUnit('/a b/"x"%.ts', "/n/node", "/h")).toContain('ExecStart="/n/node" "/a b/\\"x\\"%%.ts"');
  });
});
