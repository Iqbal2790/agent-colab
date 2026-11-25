import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VaultManager } from './vault.js';

export interface SkillSyncAction {
  name: string;
  operation: 'create' | 'update' | 'skip';
  targetPath: string;
}

export interface SkillSyncResult {
  directory: string;
  direction: 'import' | 'export';
  dryRun: boolean;
  actions: SkillSyncAction[];
}

export function expandUserPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

/**
 * Universal SKILL.md directory sync — works with any agent that stores skills
 * in <dir>/<skill-name>/SKILL.md without needing per-agent hardcoded adapters.
 */
export function syncSkillsDirectory(
  vault: VaultManager,
  rawDir: string,
  direction: 'import' | 'export',
  options?: { dryRun?: boolean; sourceLabel?: string }
): SkillSyncResult {
  const dryRun = options?.dryRun ?? false;
  const dir = expandUserPath(rawDir);
  const actions: SkillSyncAction[] = [];

  if (direction === 'import') {
    if (!fs.existsSync(dir)) {
      throw new Error(`Skills directory does not exist: ${dir}`);
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      const existing = vault.getSkill(entry.name);
      const raw = fs.readFileSync(skillFile, 'utf8');
      const op = existing ? (existing.content === raw ? 'skip' : 'update') : 'create';

      actions.push({
        name: entry.name,
        operation: op,
        targetPath: path.join(vault.vaultPath, 'skills', entry.name, 'SKILL.md'),
      });

      if (!dryRun && op !== 'skip') {
        vault.upsertSkill(entry.name, raw, options?.sourceLabel ?? path.basename(path.dirname(dir)));
      }
    }
  } else {
    for (const skill of vault.listSkills()) {
      const targetFile = path.join(dir, skill.name, 'SKILL.md');
      const exists = fs.existsSync(targetFile);
      const current = exists ? fs.readFileSync(targetFile, 'utf8') : '';
      const op = exists ? (current === skill.content ? 'skip' : 'update') : 'create';

      actions.push({
        name: skill.name,
        operation: op,
        targetPath: targetFile,
      });

      if (!dryRun && op !== 'skip') {
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.writeFileSync(targetFile, skill.content, 'utf8');
      }
    }
  }

  return {
    directory: dir,
    direction,
    dryRun,
    actions,
  };
}
