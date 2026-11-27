#!/bin/sh
# BOB-212 prototype: stage the deploy dir (assets only, bobnet-prototype-bob-212) in a fresh temp dir, with _headers:
# noindex, and each viewer's CSP by the hash beside it. Prints the dir. Deploying it is Mario's.
#   sh design/BOB-212/tools/stage.sh
set -e
P=$(cd "$(dirname "$0")/../prototype" && pwd)
D=$(mktemp -d /tmp/bob212-v5-deploy.XXXX)
mkdir -p "$D/public/vendor"
cp "$P"/index.html "$P"/app.js "$P"/data.js "$P"/proto.css "$P"/style.css "$D/public/"
cp "$P"/vendor/*.html "$D/public/vendor/"
L=$(cat "$P/vendor/likec4-viewer.hash"); E=$(cat "$P/vendor/erd-viewer.hash")
V="style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
cat > "$D/public/_headers" <<H
/*
  X-Robots-Tag: noindex
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer

/vendor/likec4-viewer.html
  Content-Security-Policy: default-src 'none'; script-src $L 'wasm-unsafe-eval'; $V

/vendor/erd-viewer.html
  Content-Security-Policy: default-src 'none'; script-src $E; $V
H
cat > "$D/wrangler.jsonc" <<W
// BOB-212 design A, prototype v5 (Toolshed, the library standard's sample). Assets only: no Worker script, no
// bindings. Deploy from this directory, never from packages/broker.
{
  "name": "bobnet-prototype-bob-212",
  "compatibility_date": "2026-11-01",
  "assets": { "directory": "./public" }
}
W
echo "$D"
