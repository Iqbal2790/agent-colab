import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deleteWorkspaceFile,
  editWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  resolveSafeFilePath,
  runWorkspaceCommand,
  searchWorkspaceCode,
  writeWorkspaceFile,
} from '../src/index.js';

describe('@agent-colab/core workspace coding engine', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-colab-repo-'));
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const greet = () => "hello";\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, '.env'), 'SECRET_KEY=super-secret\n', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('blocks path traversal and sensitive files (.env, .git, *.key)', () => {
    expect(() => resolveSafeFilePath(repoDir, '../outside.txt')).toThrow(/escapes/);
    expect(() => resolveSafeFilePath(repoDir, '.env')).toThrow(/protected/);
    expect(() => resolveSafeFilePath(repoDir, '.env.production')).toThrow(/protected/);
    expect(() => resolveSafeFilePath(repoDir, 'server.key')).toThrow(/protected/);
    expect(() => resolveSafeFilePath(repoDir, '.git/config')).toThrow(/blocked/);
  });

  it('lists, reads, searches, writes, edits, and deletes files strictly inside repo root', () => {
    const files = listWorkspaceFiles(repoDir);
    expect(files).toContain('src/index.ts');
    expect(files).not.toContain('.env');

    const read = readWorkspaceFile(repoDir, 'src/index.ts');
    expect(read.content).toContain('1: export const greet');

    const matches = searchWorkspaceCode(repoDir, 'greet');
    expect(matches).toHaveLength(1);
    expect(matches[0].file).toBe('src/index.ts');

    writeWorkspaceFile(repoDir, 'src/helper.ts', 'export const n = 1;\n');
    const edited = editWorkspaceFile(repoDir, 'src/helper.ts', 'n = 1', 'n = 42');
    expect(edited.replacements).toBe(1);
    expect(readWorkspaceFile(repoDir, 'src/helper.ts').content).toContain('n = 42');

    const del = deleteWorkspaceFile(repoDir, 'src/helper.ts');
    expect(del.deleted).toBe(true);
  });

  it('runs a command inside the workspace directory', () => {
    const res = runWorkspaceCommand(repoDir, 'node -e "console.log(1 + 2)"');
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('3');
  });
});
