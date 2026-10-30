import type { ClientFrame, ServerFrame } from "@bobnet/protocol";
import { env, exports } from "cloudflare:workers";
import { importJWK, type JWTPayload, SignJWT } from "jose";

export const ORIGIN = "https://bobnet.test";

export async function accessToken(
  claims: JWTPayload,
  opts: { aud?: string; iss?: string; expiresIn?: string } = {},
): Promise<string> {
  const key = await importJWK(JSON.parse(env.TEST_SIGNING_JWK), "RS256");
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(opts.iss ?? env.ACCESS_TEAM_DOMAIN)
    .setAudience(opts.aud ?? env.ACCESS_AUD)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "5m")
    .sign(key);
}

export const laptopToken = (n: 1 | 2) => accessToken({ common_name: `token-${n}.access`, sub: "" });
export const ownerToken = () => accessToken({ email: "Owner@Example.com", sub: "user-1" });

export async function upgrade(token: string | null, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}/v1/ws`, {
    headers: { upgrade: "websocket", ...(token ? { "cf-access-jwt-assertion": token } : {}), ...headers },
  });
}

type Req = ClientFrame extends infer F ? (F extends { rid: string } ? Omit<F, "rid"> : never) : never;

/** A test client: records every frame and lets a test await specific ones. */
export class Client {
  private readonly frames: ServerFrame[] = [];
  private readonly waiters: Array<() => void> = [];
  private seq = 0;

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      this.frames.push(JSON.parse(e.data as string) as ServerFrame);
      for (const w of this.waiters.splice(0)) w();
    });
  }

  static async open(token: string, headers: Record<string, string> = {}): Promise<Client> {
    const res = await upgrade(token, headers);
    if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
    res.webSocket.accept();
    const client = new Client(res.webSocket);
    await client.next((f) => f.t === "welcome");
    return client;
  }

  /** Resolves with the first not-yet-taken frame matching `pred`, removing it. */
  async next<F extends ServerFrame>(pred: (f: ServerFrame) => f is F, timeoutMs?: number): Promise<F>;
  async next(pred: (f: ServerFrame) => boolean, timeoutMs?: number): Promise<ServerFrame>;
  async next(pred: (f: ServerFrame) => boolean, timeoutMs = 2000): Promise<ServerFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.frames.findIndex(pred);
      if (i !== -1) return this.frames.splice(i, 1)[0]!;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out; frames seen: ${JSON.stringify(this.frames)}`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => (clearTimeout(t), resolve()));
      });
    }
  }

  /** True if no matching frame arrives within `ms`. */
  async never(pred: (f: ServerFrame) => boolean, ms = 150): Promise<boolean> {
    return this.next(pred, ms).then(
      () => false,
      () => true,
    );
  }

  /** Sends a request and resolves with its `ok` result, or rejects with its error code. */
  async request<R = any>(frame: Req): Promise<R> {
    const rid = String(++this.seq);
    this.ws.send(JSON.stringify({ ...frame, rid }));
    const reply = await this.next((f) => (f.t === "ok" || f.t === "error") && f.rid === rid);
    if (reply.t === "error") throw Object.assign(new Error(reply.message), { code: reply.code });
    return (reply as Extract<ServerFrame, { t: "ok" }>).result as R;
  }

  raw(data: string): void {
    this.ws.send(data);
  }

  close(): void {
    this.ws.close(1000, "done");
  }
}

export async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
  throw new Error("expected an error");
}

export async function agent(laptop: 1 | 2, name: string, team?: string): Promise<Client> {
  const c = await Client.open(await laptopToken(laptop));
  await c.request({ t: "register", name, ...(team ? { team } : {}) });
  return c;
}
