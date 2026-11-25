import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { AuditEntry, ConnectedAgent, SearchResult } from './types.js';

export interface IndexedDoc {
  docId: string;
  docType: SearchResult['type'];
  projectSlug: string;
  title: string;
  body: string;
  relPath: string;
}

export class VaultIndexDb {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        doc_id UNINDEXED,
        doc_type UNINDEXED,
        project_slug UNINDEXED,
        title,
        body,
        rel_path UNINDEXED
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        via TEXT NOT NULL,
        details TEXT
      );
      CREATE TABLE IF NOT EXISTS connected_agents (
        id TEXT PRIMARY KEY,
        client_name TEXT NOT NULL,
        client_version TEXT,
        persona TEXT,
        tag_scope TEXT,
        via TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  clearDocuments(): void {
    this.db.exec('DELETE FROM documents_fts');
  }

  upsertDocument(doc: IndexedDoc): void {
    this.db.prepare('DELETE FROM documents_fts WHERE doc_id = ?').run(doc.docId);
    this.db
      .prepare(
        'INSERT INTO documents_fts (doc_id, doc_type, project_slug, title, body, rel_path) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(doc.docId, doc.docType, doc.projectSlug, doc.title, doc.body, doc.relPath);
  }

  removeDocument(docId: string): void {
    this.db.prepare('DELETE FROM documents_fts WHERE doc_id = ?').run(docId);
  }

  search(query: string, limit = 20): SearchResult[] {
    const trimmed = query.trim();
    if (!trimmed) return [];

    // Escape special FTS5 characters into safe phrase/token matching
    const safeTerms = trimmed
      .split(/\s+/)
      .map((term) => term.replace(/["'*:^()\-]/g, ''))
      .filter(Boolean)
      .map((term) => `"${term}"*`);

    if (safeTerms.length === 0) return [];
    const ftsQuery = safeTerms.join(' OR ');

    const rows = this.db
      .prepare(
        `
        SELECT
          doc_id,
          doc_type,
          project_slug,
          title,
          snippet(documents_fts, 4, '[', ']', '...', 24) AS snippet,
          rel_path,
          bm25(documents_fts) AS rank
        FROM documents_fts
        WHERE documents_fts MATCH ?
        ORDER BY rank
        LIMIT ?
        `
      )
      .all(ftsQuery, limit) as Array<{
      doc_id: string;
      doc_type: SearchResult['type'];
      project_slug: string;
      title: string;
      snippet: string;
      rel_path: string;
      rank: number;
    }>;

    return rows.map((row) => ({
      id: row.doc_id,
      type: row.doc_type,
      projectSlug: row.project_slug || undefined,
      title: row.title,
      snippet: row.snippet || '',
      path: row.rel_path,
      rank: row.rank,
    }));
  }

  logAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
    this.db
      .prepare(
        'INSERT INTO audit_log (timestamp, actor, action, resource, via, details) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        new Date().toISOString(),
        entry.actor,
        entry.action,
        entry.resource,
        entry.via,
        entry.details ?? null
      );
  }

  getAuditLogs(limit = 50): AuditEntry[] {
    const rows = this.db
      .prepare(
        'SELECT id, timestamp, actor, action, resource, via, details FROM audit_log ORDER BY id DESC LIMIT ?'
      )
      .all(limit) as Array<{
      id: number;
      timestamp: string;
      actor: string;
      action: string;
      resource: string;
      via: AuditEntry['via'];
      details: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      actor: r.actor,
      action: r.action,
      resource: r.resource,
      via: r.via,
      details: r.details ?? undefined,
    }));
  }

  recordConnectedAgent(input: {
    id: string;
    clientName: string;
    clientVersion?: string;
    persona?: string;
    tagScope?: string;
    via: 'mcp' | 'tunnel';
  }): ConnectedAgent {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT id, first_seen, request_count FROM connected_agents WHERE id = ?')
      .get(input.id) as { id: string; first_seen: string; request_count: number } | undefined;

    if (existing) {
      const nextCount = existing.request_count + 1;
      this.db
        .prepare(
          `UPDATE connected_agents
           SET client_name = ?, client_version = COALESCE(?, client_version),
               persona = COALESCE(?, persona), tag_scope = COALESCE(?, tag_scope),
               via = ?, last_seen = ?, request_count = ?
           WHERE id = ?`
        )
        .run(
          input.clientName,
          input.clientVersion ?? null,
          input.persona ?? null,
          input.tagScope ?? null,
          input.via,
          now,
          nextCount,
          input.id
        );
      return {
        id: input.id,
        clientName: input.clientName,
        clientVersion: input.clientVersion,
        persona: input.persona,
        tagScope: input.tagScope,
        via: input.via,
        firstSeen: existing.first_seen,
        lastSeen: now,
        requestCount: nextCount,
      };
    }

    this.db
      .prepare(
        `INSERT INTO connected_agents (id, client_name, client_version, persona, tag_scope, via, first_seen, last_seen, request_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        input.id,
        input.clientName,
        input.clientVersion ?? null,
        input.persona ?? null,
        input.tagScope ?? null,
        input.via,
        now,
        now
      );

    return {
      id: input.id,
      clientName: input.clientName,
      clientVersion: input.clientVersion,
      persona: input.persona,
      tagScope: input.tagScope,
      via: input.via,
      firstSeen: now,
      lastSeen: now,
      requestCount: 1,
    };
  }

  listConnectedAgents(): ConnectedAgent[] {
    const rows = this.db
      .prepare(
        `SELECT id, client_name, client_version, persona, tag_scope, via, first_seen, last_seen, request_count
         FROM connected_agents ORDER BY last_seen DESC`
      )
      .all() as Array<{
      id: string;
      client_name: string;
      client_version: string | null;
      persona: string | null;
      tag_scope: string | null;
      via: 'mcp' | 'tunnel';
      first_seen: string;
      last_seen: string;
      request_count: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      clientName: r.client_name,
      clientVersion: r.client_version ?? undefined,
      persona: r.persona ?? undefined,
      tagScope: r.tag_scope ?? undefined,
      via: r.via,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      requestCount: r.request_count,
    }));
  }

  removeConnectedAgent(id: string): boolean {
    const res = this.db.prepare('DELETE FROM connected_agents WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  close(): void {
    this.db.close();
  }
}
