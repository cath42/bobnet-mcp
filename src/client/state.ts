export interface RegisteredState {
  registered: true;
  peer_id: string;
  name: string;
  team?: string;
}

export interface UnregisteredState {
  registered: false;
}

export type SessionState = RegisteredState | UnregisteredState;

export class SessionStateBox {
  private value: SessionState = { registered: false };

  get(): SessionState {
    return this.value;
  }

  setRegistered(info: { peer_id: string; name: string; team?: string }): void {
    this.value = {
      registered: true,
      peer_id: info.peer_id,
      name: info.name,
      ...(info.team !== undefined ? { team: info.team } : {}),
    };
  }

  reset(): void {
    this.value = { registered: false };
  }

  isRegistered(): boolean {
    return this.value.registered;
  }
}
