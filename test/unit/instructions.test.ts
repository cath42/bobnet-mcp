import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildInstructions } from "../../src/client/instructions.ts";

describe("buildInstructions", () => {
  it("teaches the Bobiverse metaphor", () => {
    const txt = buildInstructions({ env: {}, cwd: "/tmp/foo" });
    assert.match(txt, /Bobiverse/);
    assert.match(txt, /BobNet/);
    assert.match(txt, /replicant/i);
  });

  it("lists canonical Bob-names in the roster", () => {
    const txt = buildInstructions({ env: {}, cwd: "/tmp" });
    for (const name of ["Bob", "Riker", "Homer", "Bill", "Charles"]) {
      assert.match(txt, new RegExp(`\\b${name}\\b`), `missing roster name: ${name}`);
    }
  });

  it("recognizes user-driven naming via prompts like 'register as <Name>'", () => {
    const txt = buildInstructions({ env: {}, cwd: "/tmp" });
    assert.match(txt, /register as <Name>/);
  });

  it("instructs Claude to read CLAUDE.md for purpose/expertise", () => {
    const txt = buildInstructions({ env: {}, cwd: "/tmp" });
    assert.match(txt, /CLAUDE\.md/);
    // and fallbacks
    assert.match(txt, /AGENTS\.md/);
    assert.match(txt, /README\.md/);
  });

  it("notes that cwd is auto-attached by the broker", () => {
    const txt = buildInstructions({ env: {}, cwd: "/tmp" });
    assert.match(txt, /auto-attaches your working-directory path/);
  });

  it("env BOBNET_NAME overrides the user-driven naming hint", () => {
    const txt = buildInstructions({
      env: { BOBNET_NAME: "Riker" },
      cwd: "/tmp",
    });
    assert.match(txt, /Use "Riker"/);
    assert.match(txt, /BOBNET_NAME/);
  });

  it("env BOBNET_PURPOSE overrides the CLAUDE.md instruction", () => {
    const txt = buildInstructions({
      env: { BOBNET_PURPOSE: "running tests" },
      cwd: "/tmp",
    });
    assert.match(txt, /Use "running tests"/);
  });

  it("env BOBNET_EXPERTISE renders as JSON array", () => {
    const txt = buildInstructions({
      env: { BOBNET_EXPERTISE: "typescript,node" },
      cwd: "/tmp",
    });
    assert.match(txt, /\["typescript", "node"\]/);
  });

  it("includes the cwd-derived basename as a fallback hint when env empty", () => {
    const txt = buildInstructions({ env: {}, cwd: "/tmp/widgets-api" });
    assert.match(txt, /"widgets-api"/);
  });

  it("documents the inbound event types", () => {
    const txt = buildInstructions({ env: {}, cwd: "/tmp" });
    assert.match(txt, /peer_joined/);
    assert.match(txt, /peer_left/);
    assert.match(txt, /message/);
    assert.match(txt, /broadcast/);
    assert.match(txt, /status_changed/);
  });

  it("documents coordination norms", () => {
    const txt = buildInstructions({ env: {}, cwd: "/tmp" });
    assert.match(txt, /list_peers/);
    assert.match(txt, /Direct by default/);
    assert.match(txt, /Status needs no announcement/);
    assert.match(txt, /urgent: true only for holds/);
    assert.doesNotMatch(txt, /broadcast.*heads-up/i);
  });

  it("env BOBNET_TEAM overrides the team suggestion", () => {
    const txt = buildInstructions({
      env: { BOBNET_TEAM: "backend" },
      cwd: "/tmp",
    });
    assert.match(txt, /Use "backend"/);
    assert.match(txt, /BOBNET_TEAM/);
  });

  it("documents team concept and info-only norms", () => {
    const txt = buildInstructions({ env: {}, cwd: "/tmp" });
    assert.match(txt, /team/i);
    assert.match(txt, /info only, no response needed/i);
    assert.match(txt, /cross-team/i);
  });
});
