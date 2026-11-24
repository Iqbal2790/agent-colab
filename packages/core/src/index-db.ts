import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { AuditEntry, SearchResult } from './types.js';

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

  close(): void {
    this.db.close();
  }
}
