import { reset } from "cloudflare:test";
import { afterEach } from "vitest";

// Every test starts with an empty network.
afterEach(async () => {
  await reset();
});
