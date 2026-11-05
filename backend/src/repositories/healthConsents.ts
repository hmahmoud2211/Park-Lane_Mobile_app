import { db } from '../ems/db.ts';

/** The health_consents table: whether a resident has switched Health Passport on. */

export interface ConsentRow {
  given: number;
  given_at: string | null;
}

export function findConsent(userId: string): ConsentRow | undefined {
  return db().prepare('SELECT given, given_at FROM health_consents WHERE user_id = ?').get(userId) as ConsentRow | undefined;
}

export function upsertConsent(userId: string, given: 0 | 1, givenAt: string | null, updatedAt: string): void {
  db()
    .prepare(
      `INSERT INTO health_consents (user_id, given, given_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET given = excluded.given, given_at = excluded.given_at, updated_at = excluded.updated_at`,
    )
    .run(userId, given, givenAt, updatedAt);
}
