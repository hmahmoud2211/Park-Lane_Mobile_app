import type { User } from '../../../shared/contracts/auth.ts';
import { db } from '../ems/db.ts';

/** The users table: EMS accounts. Passwords arrive already hashed (ems/auth.ts). */

/** Throws SQLite's UNIQUE error when the email is taken. */
export function insertUser(user: User, passwordHash: string, createdAt: string): void {
  db()
    .prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, user.email, user.name, passwordHash, createdAt);
}

export function findUserWithPassword(email: string): (User & { password_hash: string }) | undefined {
  return db().prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').get(email) as
    | (User & { password_hash: string })
    | undefined;
}

export function findUserById(id: string): User | null {
  return (db().prepare('SELECT id, email, name FROM users WHERE id = ?').get(id) as User | undefined) ?? null;
}

export function findUserByEmail(email: string): User | null {
  return (db().prepare('SELECT id, email, name FROM users WHERE email = ?').get(email) as User | undefined) ?? null;
}
