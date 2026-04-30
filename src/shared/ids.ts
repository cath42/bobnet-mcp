import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

const peerIdGen = customAlphabet(alphabet, 12);
const messageIdGen = customAlphabet(alphabet, 16);
const connectionIdGen = customAlphabet(alphabet, 12);
const requestIdGen = customAlphabet(alphabet, 10);

export function newPeerId(): string {
  return `peer_${peerIdGen()}`;
}

export function newMessageId(): string {
  return `msg_${messageIdGen()}`;
}

export function newConnectionId(): string {
  return `conn_${connectionIdGen()}`;
}

export function newRequestId(): string {
  return requestIdGen();
}
