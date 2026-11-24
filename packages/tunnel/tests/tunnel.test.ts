import { describe, it, expect, afterEach } from 'vitest';
import { TunnelManager } from '../src/index.js';

describe('@agent-colab/tunnel', () => {
  const manager = new TunnelManager();

  afterEach(() => {
    manager.stop();
  });

  it('starts a mock tunnel with scoped ephemeral token and validates scope', async () => {
    expect(manager.getStatus().active).toBe(false);

    const status = await manager.start({
      localPort: 4242,
      ttlMinutes: 15,
      scope: 'read-only',
      provider: 'mock',
    });

    expect(status.active).toBe(true);
    expect(status.publicUrl).toMatch(/^https:\/\/mock-/);
    expect(status.token).toBeTruthy();

    // Valid read-only token
    expect(manager.validateToken(status.token, 'read-only')).toBe(true);
    // Rejects write when scope is read-only
    expect(manager.validateToken(status.token, 'read-write')).toBe(false);
    // Rejects invalid token
    expect(manager.validateToken('wrong-token', 'read-only')).toBe(false);

    // Stop revokes token immediately
    manager.stop();
    expect(manager.getStatus().active).toBe(false);
    expect(manager.validateToken(status.token, 'read-only')).toBe(false);
  });
});
