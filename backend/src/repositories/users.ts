import type { Role, User } from '../../../shared/contracts/auth.ts';
import { db } from '../ems/db.ts';

/** The users table: EMS accounts. Passwords arrive already hashed (ems/auth.ts). */

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  must_change_password: number;
}

const COLUMNS = 'id, email, name, role, must_change_password';

/** `mustChangePassword` appears only when true, so ordinary accounts keep their exact shape. */
const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  ...(row.must_change_password === 1 ? { mustChangePassword: true } : {}),
});

/** Throws SQLite's UNIQUE error when the email is taken. */
export function insertUser(user: User, passwordHash: string, createdAt: string, mustChangePassword = false): void {
  db()
    .prepare('INSERT INTO users (id, email, name, password_hash, created_at, role, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(user.id, user.email, user.name, passwordHash, createdAt, user.role, mustChangePassword ? 1 : 0);
}

export function findUserWithPassword(email: string): (User & { password_hash: string }) | undefined {
  const row = db().prepare(`SELECT ${COLUMNS}, password_hash FROM users WHERE email = ?`).get(email) as (UserRow & { password_hash: string }) | undefined;
  return row ? { ...toUser(row), password_hash: row.password_hash } : undefined;
}

export function findUserById(id: string): User | null {
  const row = db().prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function findUserByEmail(email: string): User | null {
  const row = db().prepare(`SELECT ${COLUMNS} FROM users WHERE email = ?`).get(email) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function setMustChangePassword(userId: string, value: boolean): void {
  db().prepare('UPDATE users SET must_change_password = ? WHERE id = ?').run(value ? 1 : 0, userId);
}

export function countAdmins(): number {
  return Number((db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n);
}

/** Accounts for the admin dashboard, with the apartment each belongs to; `query` matches name or email. */
export function searchUsers(query: string, limit = 200) {
  const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = db()
    .prepare(
      `SELECT users.id, users.email, users.name, users.role, users.must_change_password, users.created_at,
              units.id AS unit_id, units.name AS unit_name, unit_members.role AS unit_role
       FROM users
       LEFT JOIN unit_members ON unit_members.user_id = users.id
       LEFT JOIN units ON units.id = unit_members.unit_id
       WHERE ? = '' OR users.email LIKE ? ESCAPE '\\' OR users.name LIKE ? ESCAPE '\\'
       ORDER BY users.created_at DESC LIMIT ?`,
    )
    .all(query, like, like, limit) as unknown as (UserRow & { created_at: string; unit_id: string | null; unit_name: string | null; unit_role: string | null })[];
  return rows.map((row) => ({
    ...toUser(row),
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    unit: row.unit_id ? { id: row.unit_id, name: row.unit_name, role: row.unit_role } : null,
  }));
}

export function findUserName(id: string): string | null {
  return (db().prepare('SELECT name FROM users WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? null;
}

export function updatePasswordHash(userId: string, passwordHash: string): void {
  db().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

/** The clinic's front desk, who are told about every doctor's day. */
export function deskUserIds(): string[] {
  return (db().prepare("SELECT id FROM users WHERE role = 'clinic_staff'").all() as { id: string }[]).map((row) => row.id);
}

/** The same accounts by name and email, for the clinic CLI. */
export function listDeskAccounts(): { name: string; email: string }[] {
  return db().prepare("SELECT name, email FROM users WHERE role = 'clinic_staff' ORDER BY name").all() as { name: string; email: string }[];
}
