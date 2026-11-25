import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeSlug } from './vault.js';

export interface CredentialMeta {
  name: string;
  service: string;
  envVar?: string;
  maskedValue: string;
  tags: string[];
  allowAgentRead: boolean;
  notes?: string;
  addedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialWithSecret extends CredentialMeta {
  value: string;
}

interface EncryptedRecord {
  name: string;
  service: string;
  envVar?: string;
  maskedValue: string;
  tags: string[];
  allowAgentRead: boolean;
  notes?: string;
  addedBy: string;
  createdAt: string;
  updatedAt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

function maskSecret(secret: string): string {
  const s = secret.trim();
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

export class CredentialStore {
  private readonly secretsDir: string;
  private readonly storePath: string;
  private readonly keyPath: string;

  constructor(vaultPath: string) {
    this.secretsDir = path.join(vaultPath, '.secrets');
    this.storePath = path.join(this.secretsDir, 'credentials.enc.json');
    this.keyPath = path.join(this.secretsDir, 'master.key');
  }

  private getMasterKey(): Buffer {
    if (process.env.AGENT_COLAB_MASTER_KEY) {
      return crypto
        .createHash('sha256')
        .update(process.env.AGENT_COLAB_MASTER_KEY)
        .digest();
    }
    fs.mkdirSync(this.secretsDir, { recursive: true });
    if (!fs.existsSync(this.keyPath)) {
      const key = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(this.keyPath, key + '\n', { encoding: 'utf8', mode: 0o600 });
    }
    const hex = fs.readFileSync(this.keyPath, 'utf8').trim();
    return Buffer.from(hex, 'hex');
  }

  private encrypt(plaintext: string): { iv: string; authTag: string; ciphertext: string } {
    const key = this.getMasterKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: encrypted.toString('base64'),
    };
  }

  private decrypt(record: EncryptedRecord): string {
    const key = this.getMasterKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(record.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  private readAll(): Record<string, EncryptedRecord> {
    if (!fs.existsSync(this.storePath)) return {};
    const raw = fs.readFileSync(this.storePath, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, EncryptedRecord>;
  }

  private writeAll(records: Record<string, EncryptedRecord>): void {
    fs.mkdirSync(this.secretsDir, { recursive: true });
    fs.writeFileSync(this.storePath, JSON.stringify(records, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  private toMeta(r: EncryptedRecord): CredentialMeta {
    return {
      name: r.name,
      service: r.service,
      envVar: r.envVar,
      maskedValue: r.maskedValue,
      tags: r.tags,
      allowAgentRead: r.allowAgentRead,
      notes: r.notes,
      addedBy: r.addedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  list(): CredentialMeta[] {
    return Object.values(this.readAll())
      .map((r) => this.toMeta(r))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): CredentialWithSecret | null {
    const key = sanitizeSlug(name);
    const rec = this.readAll()[key];
    if (!rec) return null;
    return {
      ...this.toMeta(rec),
      value: this.decrypt(rec),
    };
  }

  upsert(input: {
    name: string;
    value?: string;
    service?: string;
    envVar?: string;
    tags?: string[];
    allowAgentRead?: boolean;
    notes?: string;
    addedBy?: string;
  }): CredentialMeta {
    const key = sanitizeSlug(input.name);
    const all = this.readAll();
    const existing = all[key];
    const now = new Date().toISOString();

    if (!existing && (!input.value || !input.value.trim())) {
      throw new Error(`Credential value is required when creating "${key}".`);
    }

    const encrypted =
      input.value && input.value.trim()
        ? this.encrypt(input.value.trim())
        : {
            iv: existing!.iv,
            authTag: existing!.authTag,
            ciphertext: existing!.ciphertext,
          };

    const next: EncryptedRecord = {
      name: key,
      service: input.service?.trim() || existing?.service || key,
      envVar: input.envVar !== undefined ? input.envVar.trim() || undefined : existing?.envVar,
      maskedValue:
        input.value && input.value.trim() ? maskSecret(input.value) : existing!.maskedValue,
      tags: input.tags ?? existing?.tags ?? [],
      allowAgentRead: input.allowAgentRead ?? existing?.allowAgentRead ?? true,
      notes: input.notes !== undefined ? input.notes.trim() || undefined : existing?.notes,
      addedBy: input.addedBy ?? existing?.addedBy ?? 'user',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...encrypted,
    };

    all[key] = next;
    this.writeAll(all);
    return this.toMeta(next);
  }

  delete(name: string): boolean {
    const key = sanitizeSlug(name);
    const all = this.readAll();
    if (!all[key]) return false;
    delete all[key];
    this.writeAll(all);
    return true;
  }
}
