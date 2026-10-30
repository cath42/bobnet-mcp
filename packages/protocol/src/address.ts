// A peer is addressed as `name@laptop`. Names are unique per laptop and
// compared case-insensitively; the laptop part is always stamped by the
// broker from the connection's credentials, never taken from a client.

const SEGMENT = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export function isValidSegment(s: string): boolean {
  return SEGMENT.test(s);
}

export interface Address {
  name: string;
  laptop: string;
}

export function formatAddress(a: Address): string {
  return `${a.name}@${a.laptop}`;
}

/** Lowercased `name@laptop`, the roster key. */
export function addressKey(a: Address): string {
  return `${a.name.toLowerCase()}@${a.laptop.toLowerCase()}`;
}

/**
 * Parses a recipient. A bare name means "on the sender's laptop"; reaching
 * another laptop takes an explicit `@laptop`. Returns null when malformed.
 */
export function parseRecipient(raw: string, senderLaptop: string): Address | null {
  const at = raw.indexOf("@");
  const name = at === -1 ? raw : raw.slice(0, at);
  const laptop = at === -1 ? senderLaptop : raw.slice(at + 1);
  if (!isValidSegment(name) || !isValidSegment(laptop)) return null;
  return { name, laptop };
}
