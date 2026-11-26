#!/usr/bin/env python3
"""BOB-212 prototype data: each project's library, read from its repo's origin/main (read only: git show, ls-tree, log).

Usage: python3 -I gen_data.py <out data.js>
The shape is Toad's (consult c_820aa69f, ADR 0015 to come): a manifest per project, and per page its raw
markdown, exactly as git has it. The page list is build.py's PROJECTS (portfolio-orchestrator/library),
which moves into each repo as .bobnet/library.json. Nothing is rendered here: the prototype renders it.
"""
import json, os, re, subprocess, sys

LIBS = {
    "helix": {
        "title": "Helix Library", "tagline": "AI-native land management for US onshore oil and gas",
        "repo": "~/Code/helix-navigator", "github": "https://github.com/cath42/helix-navigator", "laptop": "mbp-1",
        "pages": [
            {"id": "overview", "nav": "Architecture", "src": "architecture/overview.md", "owner": "Bill"},
            {"id": "entities", "nav": "Data model", "src": "architecture/model/entities.md", "owner": "Bill"},
            {"id": "taxonomy", "nav": "Taxonomy", "src": "architecture/model/taxonomy/README.md", "owner": "Bill + Picard",
             "table": {"dir": "architecture/model/taxonomy", "areas": [
                 ["access", "Access"], ["parties-instruments", "Parties & instruments"], ["land", "Land"],
                 ["leases", "Leases"], ["units", "Units"], ["wells", "Wells"],
                 ["hold-obligations", "Hold & obligations"], ["change-sets", "Change sets"],
                 ["settings", "Settings"], ["common", "Common"]]}},
            {"id": "scenarios", "nav": "Scenarios", "src": "scenarios/README.md", "owner": "group owners",
             "children": {"dir": "scenarios", "owners": {"domain": "Bill", "roles": "Picard", "user": "Picard", "technical": "Marvin"}}},
            {"id": "decisions", "nav": "Decisions", "src": "architecture/decisions-index.md", "owner": "Bill"},
        ],
        "coming": [
            {"nav": "Use cases", "owner": "Picard", "what": "Catalogue of use cases and business scenarios"},
            {"nav": "Glossary", "owner": "Picard", "what": "Land and platform terms in users' words"},
        ],
    },
    "vitals": {
        "title": "Vitals Library", "tagline": "A personal health log that people and their agents write to",
        "repo": "~/Code/health", "github": "https://github.com/cath42/vitals", "laptop": "mbp-1",
        "pages": [
            {"id": "overview", "nav": "Architecture", "src": "docs/library/architecture.md", "owner": "Galen"},
            {"id": "entities", "nav": "Data model", "src": "database/data-model.mmd", "owner": "Galen", "mermaid": True,
             "title": "Entities and relations",
             "intro": "The entity-level diagram, drawn from `database/data-model.mmd`. Every table and column with its reasoning: [data-model.html](../docs/design/data-model.html). The schema itself: [schema.sql](schema/schema.sql) and [views.sql](views.sql)."},
            {"id": "dictionary", "nav": "Data dictionary", "src": "docs/library/data-dictionary.md", "owner": "Galen"},
            {"id": "usecases", "nav": "Use cases", "src": "docs/library/use-cases.md", "owner": "Curie"},
            {"id": "decisions", "nav": "Decisions", "src": "docs/decisions/README.md", "owner": "Galen"},
            {"id": "glossary", "nav": "Glossary", "src": "docs/library/glossary.md", "owner": "Galen"},
        ],
        "coming": [],
    },
}


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True).stdout


def changed(repo, sha, src):
    h, d = git(repo, "log", "-1", "--format=%h %cs", sha, "--", src).split()
    return {"sha": h, "date": d}


def main():
    out = {}
    for key, cfg in LIBS.items():
        repo = os.path.expanduser(cfg["repo"])
        sha, at = git(repo, "log", "-1", "--format=%H %cI", "origin/main").split()
        pages = []
        for p in cfg["pages"]:
            base = {"id": p["id"], "nav": p["nav"], "src": p["src"], "owner": p["owner"], "changed": changed(repo, sha, p["src"])}
            text = git(repo, "show", f"{sha}:{p['src']}")
            if p.get("mermaid"):
                pages.append({**base, "kind": "mermaid", "title": p["title"], "intro": p["intro"], "text": text})
                continue
            title = next((l[2:].strip() for l in text.splitlines() if l.startswith("# ")), p["nav"])
            if p.get("table"):
                t = p["table"]
                areas = [{"label": lab, "src": f"{t['dir']}/{f}.md", "text": git(repo, "show", f"{sha}:{t['dir']}/{f}.md")} for f, lab in t["areas"]]
                pages.append({**base, "kind": "table", "title": title, "text": text, "areas": areas})
                continue
            pages.append({**base, "kind": "md", "title": title, "text": text})
            ch = p.get("children")
            if ch:
                files = sorted(f for f in git(repo, "ls-tree", "-r", "--name-only", sha, ch["dir"] + "/").split() if f.endswith(".md") and f != p["src"])
                for f in files:
                    rel = f[len(ch["dir"]) + 1:]
                    group = rel.split("/")[0] if "/" in rel else ""
                    slug = re.sub(r"[^a-z0-9]+", "-", rel[:-3].lower()).strip("-")
                    t2 = git(repo, "show", f"{sha}:{f}")
                    t2title = next((l[2:].strip() for l in t2.splitlines() if l.startswith("# ")), slug)
                    pages.append({"id": f"{p['id']}-{slug}", "nav": t2title, "title": t2title, "src": f, "parent": p["id"], "group": group,
                                  "owner": ch["owners"].get(group, p["owner"]), "changed": changed(repo, sha, f), "kind": "md", "text": t2})
        out[key] = {"title": cfg["title"], "tagline": cfg["tagline"], "github": cfg["github"], "ref": "main", "laptop": cfg["laptop"],
                    "commit": sha, "committed_at": at, "pages": pages, "coming": cfg["coming"], "problems": []}
    with open(sys.argv[1], "w") as fh:
        fh.write("// Generated by design/BOB-212/tools/gen_data.py from each repo's origin/main. Do not edit.\n")
        fh.write("window.LIBS = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/") + ";\n")
    for k, v in out.items():
        print(k, v["commit"][:9], len(v["pages"]), "pages")


if __name__ == "__main__":
    main()
