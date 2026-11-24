import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.venv',
  '__pycache__',
]);

const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /^\.env($|\.)/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_(rsa|ed25519|ecdsa)/i,
  /^\.npmrc$/i,
];

const MAX_READ_BYTES = 200_000;
const MAX_CMD_OUTPUT = 32_000;

export function assertSafeRepoRoot(repoPath?: string): string {
  if (!repoPath || !repoPath.trim()) {
    throw new Error('This project does not have a repoPath configured yet.');
  }
  const resolved = path.resolve(repoPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Configured repoPath does not exist or is not a directory: ${resolved}`);
  }
  return fs.realpathSync(resolved);
}

export function resolveSafeFilePath(repoPath: string, relPath: string): string {
  const root = assertSafeRepoRoot(repoPath);
  const cleaned = relPath.replace(/^[/\\]+/, '');
  const candidate = path.resolve(root, cleaned);
  const rel = path.relative(root, candidate);

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Access denied: path "${relPath}" escapes the project workspace root.`);
  }

  // Block .git internals and sensitive secret files
  const normalizedSegments = rel.split(/[/\\]/).filter(Boolean);
  if (normalizedSegments[0] === '.git') {
    throw new Error('Access denied: direct access to .git internals is blocked.');
  }
  const basename = normalizedSegments[normalizedSegments.length - 1] ?? '';
  if (SENSITIVE_FILE_PATTERNS.some((p) => p.test(basename))) {
    throw new Error(`Access denied: sensitive file "${basename}" is protected.`);
  }

  // Check symlink escape on existing path or existing parent
  if (fs.existsSync(candidate)) {
    const real = fs.realpathSync(candidate);
    const realRel = path.relative(root, real);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      throw new Error(`Access denied: symlink "${relPath}" points outside workspace root.`);
    }
  }

  return candidate;
}

export function listWorkspaceFiles(
  repoPath: string,
  subDir = '',
  maxDepth = 4,
  maxEntries = 300
): string[] {
  const root = assertSafeRepoRoot(repoPath);
  const startDir = subDir ? resolveSafeFilePath(root, subDir) : root;
  const results: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > maxDepth || results.length >= maxEntries) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxEntries) break;
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      if (!entry.isDirectory() && SENSITIVE_FILE_PATTERNS.some((p) => p.test(entry.name))) {
        continue;
      }
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        results.push(`${rel}/`);
        walk(full, depth + 1);
      } else {
        results.push(rel);
      }
    }
  }

  walk(startDir, 0);
  return results;
}

export function readWorkspaceFile(
  repoPath: string,
  filePath: string,
  startLine?: number,
  endLine?: number
): { path: string; totalLines: number; content: string } {
  const full = resolveSafeFilePath(repoPath, filePath);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stat = fs.statSync(full);
  if (stat.size > MAX_READ_BYTES && !startLine && !endLine) {
    throw new Error(
      `File "${filePath}" is ${(stat.size / 1024).toFixed(1)} KB (limit 200 KB). Specify startLine and endLine.`
    );
  }
  const raw = fs.readFileSync(full, 'utf8');
  const lines = raw.split(/\r?\n/);
  const from = Math.max(1, startLine ?? 1);
  const to = Math.min(lines.length, endLine ?? lines.length);
  const numbered = lines
    .slice(from - 1, to)
    .map((line, idx) => `${from + idx}: ${line}`)
    .join('\n');

  return {
    path: filePath.replace(/\\/g, '/'),
    totalLines: lines.length,
    content: numbered.slice(0, MAX_READ_BYTES),
  };
}

export function searchWorkspaceCode(
  repoPath: string,
  query: string,
  maxResults = 40
): Array<{ file: string; line: number; text: string }> {
  const root = assertSafeRepoRoot(repoPath);
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const matches: Array<{ file: string; line: number; text: string }> = [];
  const files = listWorkspaceFiles(root, '', 6, 1500).filter((f) => !f.endsWith('/'));

  for (const rel of files) {
    if (matches.length >= maxResults) break;
    const full = path.join(root, rel);
    try {
      const stat = fs.statSync(full);
      if (stat.size > 150_000) continue;
      const buf = fs.readFileSync(full);
      if (buf.includes(0)) continue; // Skip binary files
      const lines = buf.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          matches.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 200) });
          if (matches.length >= maxResults) break;
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return matches;
}

export function writeWorkspaceFile(
  repoPath: string,
  filePath: string,
  content: string
): { path: string; bytes: number } {
  const full = resolveSafeFilePath(repoPath, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return { path: filePath.replace(/\\/g, '/'), bytes: Buffer.byteLength(content, 'utf8') };
}

export function editWorkspaceFile(
  repoPath: string,
  filePath: string,
  target: string,
  replacement: string
): { path: string; replacements: number } {
  const full = resolveSafeFilePath(repoPath, filePath);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }
  const raw = fs.readFileSync(full, 'utf8');
  if (!raw.includes(target)) {
    throw new Error(`Target snippet not found in "${filePath}".`);
  }
  const parts = raw.split(target);
  const next = parts.join(replacement);
  fs.writeFileSync(full, next, 'utf8');
  return { path: filePath.replace(/\\/g, '/'), replacements: parts.length - 1 };
}

export function deleteWorkspaceFile(repoPath: string, filePath: string): { deleted: boolean } {
  const root = assertSafeRepoRoot(repoPath);
  const full = resolveSafeFilePath(root, filePath);
  if (full === root) {
    throw new Error('Cannot delete the workspace root directory.');
  }
  if (!fs.existsSync(full)) {
    return { deleted: false };
  }
  fs.unlinkSync(full);
  return { deleted: true };
}

export function getWorkspaceGitStatus(repoPath: string): string {
  const root = assertSafeRepoRoot(repoPath);
  try {
    return execFileSync('git', ['status', '--short', '--branch'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    }).trim();
  } catch (err) {
    throw new Error(`git status failed: ${(err as Error).message}`);
  }
}

export function getWorkspaceGitDiff(repoPath: string, filePath?: string): string {
  const root = assertSafeRepoRoot(repoPath);
  const args = ['diff'];
  if (filePath) {
    resolveSafeFilePath(root, filePath);
    args.push('--', filePath);
  }
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    });
    return out.slice(0, MAX_CMD_OUTPUT) || '(no unstaged changes)';
  } catch (err) {
    throw new Error(`git diff failed: ${(err as Error).message}`);
  }
}

export function runWorkspaceCommand(
  repoPath: string,
  command: string,
  timeoutMs = 30_000
): { exitCode: number; stdout: string; stderr: string } {
  const root = assertSafeRepoRoot(repoPath);
  const cappedTimeout = Math.max(1000, Math.min(timeoutMs, 120_000));
  const res = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: cappedTimeout,
  });

  return {
    exitCode: res.status ?? (res.error ? 1 : 0),
    stdout: (res.stdout ?? '').slice(0, MAX_CMD_OUTPUT),
    stderr: (res.stderr ?? res.error?.message ?? '').slice(0, MAX_CMD_OUTPUT),
  };
}
