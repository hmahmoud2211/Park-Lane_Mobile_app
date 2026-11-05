import { db } from '../ems/db.ts';

/**
 * The tokens table: bearer tokens EMS issued, stored only as SHA-256 hashes. An
 * assistant token records the session it came from (parent_hash), so revoking the
 * session revokes it too.
 */

export type TokenKind = 'session' | 'assistant';

export interface TokenRow {
  user_id: string;
  kind: TokenKind;
  client_id: string | null;
  expires_at: number;
  revoked_at: number | null;
}

export function insertToken(token: {
  hash: string;
  userId: string;
  kind: TokenKind;
  clientId: string | null;
  parentHash: string | null;
  expiresAt: number;
  createdAt: number;
}): void {
  db()
    .prepare(
      'INSERT INTO tokens (token_hash, user_id, kind, client_id, parent_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(token.hash, token.userId, token.kind, token.clientId, token.parentHash, token.expiresAt, token.createdAt);
}

export function findToken(hash: string): TokenRow | undefined {
  return db()
    .prepare('SELECT user_id, kind, client_id, expires_at, revoked_at FROM tokens WHERE token_hash = ?')
    .get(hash) as TokenRow | undefined;
}

/** The token, and every token issued under it. */
export function revokeTokenAndChildren(hash: string, at: number): void {
  db()
    .prepare('UPDATE tokens SET revoked_at = ? WHERE (token_hash = ? OR parent_hash = ?) AND revoked_at IS NULL')
    .run(at, hash, hash);
}

export function revokeUserTokens(userId: string, kinds: readonly TokenKind[], at: number): void {
  const placeholders = kinds.map(() => '?').join(', ');
  db()
    .prepare(`UPDATE tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND kind IN (${placeholders})`)
    .run(at, userId, ...kinds);
}
