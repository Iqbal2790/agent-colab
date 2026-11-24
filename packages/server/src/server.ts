import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { VaultManager } from '@agent-colab/core';
import { TunnelManager } from '@agent-colab/tunnel';
import { createApp } from './app.js';

export interface StartServerOptions {
  host?: string;
  port?: number;
  vaultPath?: string;
  staticDir?: string;
  watchVault?: boolean;
}

function resolveDefaultStaticDir(): string | undefined {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, '../../../apps/web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

export function startHttpServer(options?: StartServerOptions) {
  const host = options?.host ?? process.env.HOST ?? '127.0.0.1';
  const port = options?.port ?? Number(process.env.PORT ?? 4242);
  const vault = new VaultManager(options?.vaultPath);
  vault.init();
  if (options?.watchVault !== false) {
    vault.startWatcher();
  }

  const tunnel = new TunnelManager();
  const staticDir = options?.staticDir ?? resolveDefaultStaticDir();
  const app = createApp({ vault, tunnel, port, staticDir });

  const server = serve({
    fetch: app.fetch,
    hostname: host,
    port,
  });

  const shutdown = () => {
    tunnel.stop();
    vault.close();
    server.close();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, app, vault, tunnel, host, port, shutdown };
}
