import viewers from "../public/vendor/viewers.json" with { type: "json" };

/** connect-src names the socket explicitly: Safari doesn't count wss:// as 'self'. frame-src is for the viewers. */
export const pageCsp = (host: string) =>
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss://${host}; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/** Where the page frames each viewer: the assets serve an .html file at its name without it, and redirect to there. */
export const viewerPath = (kind: "likec4" | "erd") => `/vendor/${viewers[kind].file.replace(/\.html$/, "")}`;

/**
 * The library's diagram viewers (ADR 0016 §6, 0017 §7), each framed sandboxed to an opaque origin with no network:
 * their own scripts by hash, and what each one's parser needs. LikeC4's Graphviz is wasm; Liam's Postgres parser
 * (pg-query-emscripten) calls eval. The page never gets either.
 */
const VIEWER_CSP = new Map(
  ([["likec4", "'wasm-unsafe-eval'"], ["erd", "'unsafe-eval'"]] as const).map(([kind, evals]) => [
    viewerPath(kind),
    `default-src 'none'; script-src ${viewers[kind].scripts.join(" ")} ${evals}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
  ]),
);

/** The content policy for a path the dashboard serves: a viewer's own, or the page's. */
export const cspFor = (pathname: string, host: string) => VIEWER_CSP.get(pathname) ?? pageCsp(host);
