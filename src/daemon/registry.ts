import { newPeerId } from "../shared/ids.js";
import { nowIso } from "../shared/time.js";
import { ErrorCode, RpcError } from "../shared/errors.js";
import {
  isValidExpertise,
  isValidName,
  isValidTeam,
  PURPOSE_MAX_LEN,
  STATUS_MAX_LEN,
  TEAM_MAX_LEN,
  type PeerInfo,
} from "../shared/protocol.js";

export interface RegisteredPeer extends PeerInfo {
  connection_id: string;
}

export type RegistryEvent =
  | { kind: "joined"; peer: RegisteredPeer }
  | { kind: "left"; peer: RegisteredPeer }
  | { kind: "status"; peer: RegisteredPeer };

export type RegistryListener = (evt: RegistryEvent) => void;

export class Registry {
  private byNameMap = new Map<string, RegisteredPeer>();
  private byConnMap = new Map<string, RegisteredPeer>();
  private listeners = new Set<RegistryListener>();

  on(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  size(): number {
    return this.byNameMap.size;
  }

  list(): RegisteredPeer[] {
    return Array.from(this.byNameMap.values());
  }

  byName(name: string): RegisteredPeer | undefined {
    return this.byNameMap.get(name);
  }

  byConnection(connectionId: string): RegisteredPeer | undefined {
    return this.byConnMap.get(connectionId);
  }

  register(
    connectionId: string,
    args: {
      name: unknown;
      team?: unknown;
      cwd?: unknown;
      purpose?: unknown;
      expertise?: unknown;
    },
  ): RegisteredPeer {
    if (this.byConnMap.has(connectionId)) {
      const existing = this.byConnMap.get(connectionId)!;
      throw new RpcError(
        ErrorCode.AlreadyRegistered,
        `connection already registered as '${existing.name}'; deregister first`,
        { current_name: existing.name },
      );
    }

    if (!isValidName(args.name)) {
      throw new RpcError(
        ErrorCode.InvalidName,
        `invalid name; must match /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/`,
      );
    }

    if (this.byNameMap.has(args.name)) {
      throw new RpcError(
        ErrorCode.NameInUse,
        `name '${args.name}' is already taken`,
        { name: args.name },
      );
    }

    let team: string | undefined;
    if (args.team !== undefined) {
      if (!isValidTeam(args.team)) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          `team must be a non-empty string of at most ${TEAM_MAX_LEN} chars`,
        );
      }
      team = args.team;
    }

    const purpose = args.purpose === undefined ? undefined : String(args.purpose);
    if (purpose !== undefined && purpose.length > PURPOSE_MAX_LEN) {
      throw new RpcError(
        ErrorCode.InvalidParams,
        `purpose exceeds ${PURPOSE_MAX_LEN} chars`,
      );
    }

    let cwd: string | undefined;
    if (args.cwd !== undefined) {
      if (typeof args.cwd !== "string") {
        throw new RpcError(ErrorCode.InvalidParams, `cwd must be a string`);
      }
      if (args.cwd.length > 1024) {
        throw new RpcError(ErrorCode.InvalidParams, `cwd exceeds 1024 chars`);
      }
      cwd = args.cwd;
    }

    let expertise: string[] | undefined;
    if (args.expertise !== undefined) {
      if (!isValidExpertise(args.expertise)) {
        throw new RpcError(
          ErrorCode.InvalidParams,
          `expertise must be an array of non-empty strings (max 64 chars each)`,
        );
      }
      expertise = args.expertise;
    }

    const peer: RegisteredPeer = {
      peer_id: newPeerId(),
      name: args.name,
      ...(team !== undefined ? { team } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
      ...(purpose !== undefined ? { purpose } : {}),
      ...(expertise !== undefined ? { expertise } : {}),
      joined_at: nowIso(),
      connection_id: connectionId,
    };

    this.byNameMap.set(peer.name, peer);
    this.byConnMap.set(connectionId, peer);
    this.emit({ kind: "joined", peer });
    return peer;
  }

  deregister(connectionId: string): RegisteredPeer | null {
    const peer = this.byConnMap.get(connectionId);
    if (!peer) return null;
    this.byNameMap.delete(peer.name);
    this.byConnMap.delete(connectionId);
    this.emit({ kind: "left", peer });
    return peer;
  }

  updateStatus(connectionId: string, status: unknown): RegisteredPeer {
    const peer = this.byConnMap.get(connectionId);
    if (!peer) {
      throw new RpcError(ErrorCode.NotRegistered, `not registered`);
    }
    if (typeof status !== "string") {
      throw new RpcError(ErrorCode.InvalidParams, `status must be a string`);
    }
    if (status.length > STATUS_MAX_LEN) {
      throw new RpcError(
        ErrorCode.InvalidParams,
        `status exceeds ${STATUS_MAX_LEN} chars`,
      );
    }
    peer.status = status;
    this.emit({ kind: "status", peer });
    return peer;
  }

  sameTeam(a: RegisteredPeer, b: RegisteredPeer): boolean {
    return a.team !== undefined && a.team === b.team;
  }

  teamMembers(team: string, exceptConnId?: string): RegisteredPeer[] {
    return this.list().filter(
      (p) => p.team === team && p.connection_id !== exceptConnId,
    );
  }

  toPublicInfo(peer: RegisteredPeer): PeerInfo {
    const { connection_id: _conn, ...rest } = peer;
    return rest;
  }

  private emit(evt: RegistryEvent): void {
    for (const l of this.listeners) {
      try {
        l(evt);
      } catch {
        /* listeners must not break the registry */
      }
    }
  }
}
