// BOB-115: removes alexa-mcp's leftover peers (Canva@ubu1, Dot@ubu1, team alexa) from the broker.
// The broker lets only a connection hosting a peer deregister it (broker.ts hosted()), and only from
// that peer's laptop, so this runs on ubu1, with the credentials ubu1's supervisor uses:
//   node forget-alexa-peers.ts ~/.local/share/bobnet/<installed tag>
// It registers each name over its own connection (both are offline, so the name is free), then
// deregisters it. A peer that is already gone answers not_hosted on the deregister: nothing to do.
const root = process.argv[2];
if (!root) throw new Error("usage: node forget-alexa-peers.ts <release root>");
const { BrokerConnection } = await import(`${root}/packages/client/src/connection.ts`);
const { loadConfig } = await import(`${root}/packages/client/src/config.ts`);
const { createLogger } = await import(`${root}/packages/client/src/log.ts`);

const config = loadConfig();
const connection = new BrokerConnection({ url: config.url, credentials: config.credentials, log: createLogger(), onPush: () => {} });
connection.start();
try {
  for (const name of ["Canva", "Dot"]) {
    const { address } = await connection.register({ name, team: "alexa", purpose: "alexa-mcp (archived 2026-11-16): being removed, BOB-115" });
    await connection.deregister(name);
    console.log(`removed ${address}`);
  }
} finally {
  connection.stop();
}
