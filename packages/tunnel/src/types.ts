export type TunnelScope = 'read-only' | 'read-write';
export type TunnelProvider = 'cloudflared' | 'mock';

export interface StartTunnelOptions {
  localPort: number;
  ttlMinutes?: number;
  scope?: TunnelScope;
  provider?: TunnelProvider;
}

export interface TunnelStatus {
  active: boolean;
  provider: TunnelProvider;
  publicUrl?: string;
  token?: string;
  scope?: TunnelScope;
  startedAt?: string;
  expiresAt?: string;
  error?: string;
}
