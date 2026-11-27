#!/usr/bin/env python3
"""BOB-212 prototype data: each project's library, read from its repo's main (read only: git show, ls-tree, log).

Usage: python3 -I gen_data.py <out data.js> [<Vitals schema.json from Toad's spike>]
The shape is ADR 0016's: a version 2 manifest per project (.bobnet/library.json, written out below as it would be
in each repo), its seven fixed sections, and per page the raw files exactly as git has them. Nothing is rendered
or parsed here; the prototype does that in the page, as the build will. Two stand-ins, both marked in the data:
- `erd`: the build posts schema.sql into the viewer and Liam parses it there (0016 build B task 3). The prototype
  posts the schema as Liam's CLI parsed it in Toad's spike (private-vitals/frame-erd/schema.json).
- `erd` for Helix (version 3): ADR 0016 has Helix's build emit a schema.sql with COMMENT ON from each table's
  grain and each column's note (Toad, BOB-212). Until it does, the prototype converts architecture/model/model.json
  into what Liam would parse from that file (`helix_schema` below), and the page says so.
- `head` on BobNet's UX cards: what each spec's front matter would say. The specs have none yet.
Helix and Vitals are private repos and bobnet-mcp is public: the output is git-ignored.
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BOBNET = os.path.normpath(os.path.join(HERE, "../../.."))

# The manifests, version 2. Helix and Vitals are build.py's pages onto the sections (0016 §4), plus each repo's ADR
# folder as `children` (0016 §2's own example): both folders already open every ADR with Date/Status/Decided by lines.
MANIFESTS = {
    "bobnet": {
        "repo": BOBNET, "ref": "origin/v2", "branch": "v2", "github": "https://github.com/cath42/bobnet-mcp", "laptop": "mbp-1",
        "version": 2, "title": "BobNet Library", "tagline": "Agents across Casper's laptops, and the teams they run",
        "sections": {
            "overview": {"owner": "Peach", "pages": [{"id": "frame", "src": "product/requirements/README.md"}]},
            "architecture": {"owner": "Toad", "pages": [
                {"id": "model", "kind": "likec4", "dir": "architecture/model", "view": "index", "title": "BobNet in C4"}]},
            "decisions": {"owner": "Toad", "pages": [
                {"id": "adrs", "kind": "children", "dir": "architecture/decisions", "title": "Architecture decisions"}]},
            "usecases": {"owner": "Peach", "pages": [
                {"id": "capabilities", "kind": "children", "dir": "product/requirements", "match": r"^[a-z-]+\.md$",
                 "skip": ["README.md", "bugs.md", "migration.md"], "title": "Capabilities"}]},
            "ux": {"owner": "Daisy", "pages": [
                {"id": "features", "kind": "children", "dir": "design", "match": r"^BOB-\d+/spec\.md$", "title": "Features"}]},
        },
    },
    "helix": {
        "repo": "~/Code/helix-navigator", "ref": "origin/main", "branch": "main", "github": "https://github.com/cath42/helix-navigator", "laptop": "mbp-1",
        "version": 2, "title": "Helix Library", "tagline": "AI-native land management for US onshore oil and gas",
        "sections": {
            "architecture": {"owner": "Bill", "pages": [{"id": "overview", "src": "architecture/overview.md"}]},
            "data": {"owner": "Bill", "pages": [
                {"id": "erd", "kind": "erd", "format": "postgres", "src": "architecture/model/schema.sql", "title": "Schema",
                 "standin": "architecture/model/model.json"},
                {"id": "entities", "src": "architecture/model/entities.md"},
                {"id": "taxonomy", "kind": "table", "src": "architecture/model/taxonomy/README.md", "owner": "Bill + Picard",
                 "table": {"dir": "architecture/model/taxonomy", "areas": [
                     ["access", "Access"], ["parties-instruments", "Parties & instruments"], ["land", "Land"],
                     ["leases", "Leases"], ["units", "Units"], ["wells", "Wells"],
                     ["hold-obligations", "Hold & obligations"], ["change-sets", "Change sets"],
                     ["settings", "Settings"], ["common", "Common"]]}}]},
            "decisions": {"owner": "Bill", "pages": [
                {"id": "index", "src": "architecture/decisions-index.md"},
                {"id": "adrs", "kind": "children", "dir": "architecture/decisions", "match": r"^\d{4}-.*\.md$", "title": "Architecture decisions"}]},
            "usecases": {"owner": "Picard", "pages": [
                {"id": "scenarios", "kind": "children", "dir": "scenarios", "skip": ["README.md"], "intro": "scenarios/README.md", "title": "Scenarios",
                 "owners": {"domain": "Bill", "roles": "Picard", "user": "Picard", "technical": "Marvin"}}]},
        },
    },
    "vitals": {
        "repo": "~/Code/health", "ref": "origin/main", "branch": "main", "github": "https://github.com/cath42/vitals", "laptop": "mbp-1",
        "version": 2, "title": "Vitals Library", "tagline": "A personal health log that people and their agents write to",
        "sections": {
            "architecture": {"owner": "Galen", "pages": [{"id": "notes", "src": "docs/library/architecture.md"}]},
            "data": {"owner": "Galen", "pages": [
                {"id": "erd", "kind": "erd", "format": "postgres", "src": "database/schema/schema.sql", "title": "Schema",
                 "about": "docs/library/data-dictionary.md"},
                {"id": "entities", "kind": "mermaid", "src": "database/data-model.mmd", "title": "Entities and relations",
                 "intro": "The entity-level diagram, drawn from `database/data-model.mmd`. The schema itself: [schema.sql](schema/schema.sql) and [views.sql](views.sql)."},
                {"id": "dictionary", "src": "docs/library/data-dictionary.md"}]},
            "decisions": {"owner": "Galen", "pages": [
                {"id": "index", "src": "docs/decisions/README.md"},
                {"id": "adrs", "kind": "children", "dir": "docs/decisions", "match": r"^\d{4}-.*\.md$", "title": "Architecture decisions"}]},
            "usecases": {"owner": "Curie", "pages": [{"id": "catalogue", "src": "docs/library/use-cases.md"}]},
            "glossary": {"owner": "Galen", "pages": [{"id": "terms", "src": "docs/library/glossary.md"}]},
        },
    },
}

# What BobNet's UX cards' front matter would say (the keys are Daisy's template, spec §8). From the board.
UX_HEADS = {
    "BOB-121": {"status": "built", "verdict": "Build it with the changes I note", "verdict by": "Casper, Q-13", "verdict date": "2026-11-22",
                "prototype": "https://bobnet-prototype-bob-121.casper-cth.workers.dev"},
    "BOB-211": {"status": "built", "verdict": "Build it as shown", "verdict by": "Casper, Q-17", "verdict date": "2026-11-26",
                "prototype": "https://bobnet-prototype-bob-211.casper-cth.workers.dev"},
    "BOB-212": {"status": "waiting",
                "prototype": "https://bobnet-prototype-bob-212.casper-cth.workers.dev"},
}


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True).stdout


def changed(repo, sha, src):
    out = git(repo, "log", "-1", "--format=%h %cs", sha, "--", src).split()
    return {"sha": out[0], "date": out[1]} if out else None


def first_h1(text, fallback):
    return next((l[2:].strip() for l in text.splitlines() if l.startswith("# ")), fallback)


def helix_schema(model):
    """Helix's model.json as Liam's parse of the schema.sql Helix's build would emit: tables lower-cased, each table's
    grain and each column's note as its COMMENT ON, the mixins' columns appended, `fk: "TABLE.col"` as FOREIGN KEY."""
    tables, mixins = {}, model.get("mixins", {})
    every = [t for d in model["domains"] for t in d["tables"]] + model.get("platform_tables", {}).get("tables", [])
    names = {t["name"].lower() for t in every}
    for t in every:
        name = t["name"].lower()
        cols = list(t.get("columns", [])) + [c for m in t.get("mixins", []) for c in mixins.get(m, {}).get("columns", [])]
        columns, cons = {}, {}
        for c in cols:
            if c["name"] in columns:
                continue
            note = (c.get("note") or "").strip() or None
            columns[c["name"]] = {"name": c["name"], "type": c.get("type", ""), "default": c.get("default"), "check": None,
                                  "notNull": bool(c.get("pk")) or c.get("nullable") is False, "comment": note}
            if c.get("pk"):
                pk = cons.setdefault(f"{name}_pkey", {"type": "PRIMARY KEY", "name": f"{name}_pkey", "columnNames": []})
                pk["columnNames"].append(c["name"])
            fk = c.get("fk")
            m = re.match(r"^([A-Z_]+)\.([a-z_]+)$", fk.strip()) if isinstance(fk, str) else None
            if m and m.group(1).lower() in names:
                cons[f"{name}_{c['name']}_fkey"] = {"type": "FOREIGN KEY", "name": f"{name}_{c['name']}_fkey", "columnNames": [c["name"]],
                    "targetTableName": m.group(1).lower(), "targetColumnNames": [m.group(2)], "updateConstraint": "NO_ACTION", "deleteConstraint": "NO_ACTION"}
        tables[name] = {"name": name, "columns": columns, "comment": (t.get("grain") or "").strip() or None, "indexes": {}, "constraints": cons}
    return {"tables": tables, "enums": {}, "extensions": {}}


def main():
    schema = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else None
    out = {}
    for key, m in MANIFESTS.items():
        repo = os.path.expanduser(m["repo"])
        sha, at = git(repo, "log", "-1", "--format=%H %cI", m["ref"]).split()
        show = lambda p: git(repo, "show", f"{sha}:{p}")
        sections = {}
        for sid, sec in m["sections"].items():
            pages = []
            for p in sec["pages"]:
                kind = p.get("kind", "md")
                page = {"id": p["id"], "kind": kind, "owner": p.get("owner")}
                if kind in ("md", "table", "mermaid") or (kind == "erd" and not p.get("standin")):
                    text = show(p["src"])
                    page.update(src=p["src"], text=text, changed=changed(repo, sha, p["src"]),
                                title=p.get("title") or first_h1(text, p["id"]))
                if kind == "mermaid":
                    page["intro"] = p["intro"]
                if kind == "table":
                    t = p["table"]
                    page["areas"] = [{"label": lab, "src": f"{t['dir']}/{f}.md", "text": show(f"{t['dir']}/{f}.md")} for f, lab in t["areas"]]
                if kind == "erd":
                    page["format"] = p["format"]
                    if p.get("standin"):  # the file Helix's build will emit isn't on main yet: say what it's drawn from
                        page.update(src=p["src"], title=p["title"], text="", standin=p["standin"], changed=changed(repo, sha, p["standin"]),
                                    schema=helix_schema(json.loads(show(p["standin"]))))
                    else:
                        page["schema"] = schema  # stand-in: Liam's parse of this schema.sql (see the docstring)
                    if p.get("about"):
                        page["about"] = {"path": p["about"], "text": show(p["about"])}
                if kind == "likec4":
                    files = [f for f in git(repo, "ls-tree", "-r", "--name-only", sha, p["dir"] + "/").split()
                             if f.endswith((".c4", ".likec4")) or f.endswith("likec4.config.json")]
                    page.update(dir=p["dir"], view=p.get("view", "index"), title=p["title"],
                                files=[{"path": f, "text": show(f), "changed": changed(repo, sha, f)} for f in files],
                                changed=changed(repo, sha, p["dir"]))
                if kind == "children":
                    names = [f[len(p["dir"]) + 1:] for f in git(repo, "ls-tree", "-r", "--name-only", sha, p["dir"] + "/").split() if f.endswith(".md")]
                    names = [n for n in names if re.match(p.get("match", r"^.*\.md$"), n) and n not in p.get("skip", [])]
                    kids = []
                    for n in sorted(names):
                        src = f"{p['dir']}/{n}"
                        text = show(src)
                        kid = {"id": re.sub(r"[^a-z0-9]+", "-", n[:-3].lower()).strip("-"), "src": src, "text": text,
                               "title": first_h1(text, n), "changed": changed(repo, sha, src), "group": n.split("/")[0] if "/" in n else ""}
                        if key == "bobnet" and sid == "ux":
                            feat = n.split("/")[0]
                            kid["id"] = feat.lower()
                            kid["head"] = {"feature": feat, **UX_HEADS.get(feat, {"status": "built"})}
                        if p.get("owners"):
                            kid["owner"] = p["owners"].get(kid["group"])
                        kids.append(kid)
                    page.update(dir=p["dir"], title=p["title"], children=kids, changed=changed(repo, sha, p["dir"]))
                    if p.get("intro"):
                        page["intro"] = show(p["intro"])
                pages.append(page)
            sections[sid] = {"owner": sec["owner"], "pages": pages}
        out[key] = {"version": 2, "title": m["title"], "tagline": m["tagline"], "github": m["github"], "ref": m["branch"],
                    "laptop": m["laptop"], "commit": sha, "committed_at": at, "sections": sections, "problems": []}
    with open(sys.argv[1], "w") as fh:
        fh.write("// Generated by design/BOB-212/tools/gen_data.py from each repo's main. Do not edit. Private: never commit.\n")
        fh.write("window.LIBS = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/") + ";\n")
    for k, v in out.items():
        print(k, v["commit"][:9], {s: len(x["pages"]) for s, x in v["sections"].items()})


if __name__ == "__main__":
    main()
