import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import type { StartTunnelOptions, TunnelProvider, TunnelScope, TunnelStatus } from './types.js';

const TRY_CLOUDFLARE_REGEX = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

export class TunnelManager {
  private proc?: ChildProcess;
  private ttlTimer?: NodeJS.Timeout;
  private status: TunnelStatus = {
    active: false,
    provider: 'cloudflared',
  };

  getStatus(): TunnelStatus {
    if (this.status.active && this.status.expiresAt) {
      if (new Date(this.status.expiresAt).getTime() <= Date.now()) {
        this.stop();
      }
    }
    return { ...this.status };
  }

  validateToken(token: string | undefined, requiredScope: TunnelScope = 'read-only'): boolean {
    const current = this.getStatus();
    if (!current.active || !current.token || !token) return false;

    const a = Buffer.from(current.token);
    const b = Buffer.from(token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return false;
    }

    if (requiredScope === 'read-write' && current.scope !== 'read-write') {
      return false;
    }

    return true;
  }

  async start(options: StartTunnelOptions): Promise<TunnelStatus> {
    if (this.status.active) {
      return this.getStatus();
    }

    const provider: TunnelProvider = options.provider ?? 'cloudflared';
    const scope: TunnelScope = options.scope ?? 'read-only';
    const ttlMinutes = Math.max(1, Math.min(options.ttlMinutes ?? 30, 480));
    const token = crypto.randomBytes(24).toString('base64url');
    const startedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

    if (provider === 'mock') {
      this.status = {
        active: true,
        provider: 'mock',
        publicUrl: `https://mock-${token.slice(0, 8)}.trycloudflare.com`,
        token,
        scope,
        startedAt,
        expiresAt,
      };
      this.scheduleStop(ttlMinutes);
      return this.getStatus();
    }

    // Spawn cloudflared quick tunnel
    const publicUrl = await this.spawnCloudflared(options.localPort);
    this.status = {
      active: true,
      provider: 'cloudflared',
      publicUrl,
      token,
      scope,
      startedAt,
      expiresAt,
    };
    this.scheduleStop(ttlMinutes);
    return this.getStatus();
  }

  private scheduleStop(ttlMinutes: number): void {
    if (this.ttlTimer) clearTimeout(this.ttlTimer);
    this.ttlTimer = setTimeout(() => {
      this.stop();
    }, ttlMinutes * 60_000);
    this.ttlTimer.unref();
  }

  private spawnCloudflared(localPort: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['tunnel', '--url', `http://127.0.0.1:${localPort}`, '--no-autoupdate'];
      const child = spawn('cloudflared', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.proc = child;

      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.stop();
          reject(new Error('Timed out waiting for cloudflared tunnel URL (20s).'));
        }
      }, 20_000);

      const handleOutput = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const match = text.match(TRY_CLOUDFLARE_REGEX);
        if (match && !settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(match[0]);
        }
      };

      child.stdout?.on('data', handleOutput);
      child.stderr?.on('data', handleOutput);

      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.proc = undefined;
          reject(
            new Error(
              `Failed to launch cloudflared (${err.message}). Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`
            )
          );
        }
      });

      child.on('exit', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`cloudflared exited early with code ${code ?? 'unknown'}`));
        } else {
          this.status = { active: false, provider: 'cloudflared' };
          this.proc = undefined;
        }
      });
    });
  }

  stop(): TunnelStatus {
    if (this.ttlTimer) {
      clearTimeout(this.ttlTimer);
      this.ttlTimer = undefined;
    }
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
    this.proc = undefined;
    this.status = {
      active: false,
      provider: this.status.provider,
    };
    return this.getStatus();
  }
}
