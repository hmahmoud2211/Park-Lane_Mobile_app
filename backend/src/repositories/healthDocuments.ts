import { db } from '../ems/db.ts';

/** The health_documents table: uploaded medical papers. Extracted text and items are sealed by the caller; `pages` stays JSON text here. */

export type DocumentStatus = 'processing' | 'needs_review' | 'confirmed' | 'failed';

export interface DocumentRow {
  id: string;
  profile_id: string;
  type: string;
  document_date: string | null;
  uploaded_at: string;
  status: DocumentStatus;
  error_code: string | null;
  pages: string;
  extracted_text: string | null;
  extracted_items: string | null;
  updated_at: string;
}

export function findHealthDocument(id: string): DocumentRow | null {
  return (db().prepare('SELECT * FROM health_documents WHERE id = ?').get(id) as DocumentRow | undefined) ?? null;
}

/** Newest upload first. */
export function listProfileDocuments(profileId: string): DocumentRow[] {
  return db().prepare('SELECT * FROM health_documents WHERE profile_id = ? ORDER BY uploaded_at DESC').all(profileId) as unknown as DocumentRow[];
}

export function listProcessingDocumentIds(): string[] {
  return (db().prepare("SELECT id FROM health_documents WHERE status = 'processing'").all() as { id: string }[]).map((row) => row.id);
}

/** Every document's `pages` JSON, to tell which stored files are still in use. */
export function listDocumentPages(): string[] {
  return (db().prepare('SELECT pages FROM health_documents').all() as { pages: string }[]).map((row) => row.pages);
}

export function findDocumentOwnerId(id: string): string | null {
  const row = db()
    .prepare('SELECT p.owner_id FROM health_documents d JOIN health_profiles p ON p.id = d.profile_id WHERE d.id = ?')
    .get(id) as { owner_id: string } | undefined;
  return row?.owner_id ?? null;
}

/** A new document, `processing` until it has been read. */
export function insertHealthDocument(document: {
  id: string;
  profileId: string;
  type: string;
  documentDate: string | null;
  pages: string;
  at: string;
}): void {
  db()
    .prepare(
      `INSERT INTO health_documents (id, profile_id, type, document_date, uploaded_at, status, pages, updated_at)
       VALUES (?, ?, ?, ?, ?, 'processing', ?, ?)`,
    )
    .run(document.id, document.profileId, document.type, document.documentDate, document.at, document.pages, document.at);
}

export function failDocumentReading(id: string, errorCode: string, updatedAt: string): void {
  db()
    .prepare("UPDATE health_documents SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ? AND status = 'processing'")
    .run(errorCode, updatedAt, id);
}

export function completeDocumentReading(id: string, reading: { documentDate: string | null; extractedText: string; extractedItems: string; updatedAt: string }): void {
  db()
    .prepare(
      `UPDATE health_documents SET status = 'needs_review', document_date = ?, extracted_text = ?, extracted_items = ?, updated_at = ?
       WHERE id = ? AND status = 'processing'`,
    )
    .run(reading.documentDate, reading.extractedText, reading.extractedItems, reading.updatedAt, id);
}

export function updateDocumentReview(id: string, status: DocumentStatus, extractedItems: string, updatedAt: string): void {
  db().prepare('UPDATE health_documents SET status = ?, extracted_items = ?, updated_at = ? WHERE id = ?').run(status, extractedItems, updatedAt, id);
}

export function deleteHealthDocument(id: string): void {
  db().prepare('DELETE FROM health_documents WHERE id = ?').run(id);
}

export function deleteProfileDocuments(profileId: string): void {
  db().prepare('DELETE FROM health_documents WHERE profile_id = ?').run(profileId);
}
