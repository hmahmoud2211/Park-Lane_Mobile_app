import { db } from '../ems/db.ts';

/** The gateway_containers table: the CUBE gateway container this backend runs for a unit. */

/** `removed`: its container was taken away; the row keeps its id, name and port for when it is made again. */
export type GatewayContainerStatus = 'provisioning' | 'running' | 'failed' | 'removed';

export interface GatewayContainer {
  unitId: string;
  gatewayId: string;
  containerName: string;
  port: number | null;
  status: GatewayContainerStatus;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  unit_id: string;
  gateway_id: string;
  container_name: string;
  port: number | null;
  status: GatewayContainerStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'unit_id, gateway_id, container_name, port, status, last_error, created_at, updated_at';
const toContainer = (row: Row): GatewayContainer => ({
  unitId: row.unit_id,
  gatewayId: row.gateway_id,
  containerName: row.container_name,
  port: row.port,
  status: row.status,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function findGatewayContainer(unitId: string): GatewayContainer | null {
  const row = db().prepare(`SELECT ${COLUMNS} FROM gateway_containers WHERE unit_id = ?`).get(unitId) as Row | undefined;
  return row ? toContainer(row) : null;
}

export function listGatewayContainers(): GatewayContainer[] {
  return (db().prepare(`SELECT ${COLUMNS} FROM gateway_containers ORDER BY created_at`).all() as unknown as Row[]).map(toContainer);
}

export function insertGatewayContainer(unitId: string, gatewayId: string, containerName: string, at: string): void {
  db()
    .prepare(`INSERT INTO gateway_containers (unit_id, gateway_id, container_name, status, created_at, updated_at) VALUES (?, ?, ?, 'provisioning', ?, ?)`)
    .run(unitId, gatewayId, containerName, at, at);
}

export function updateGatewayContainer(unitId: string, changes: { status?: GatewayContainerStatus; lastError?: string | null; port?: number }): void {
  const current = findGatewayContainer(unitId);
  if (!current) {
    return;
  }
  db()
    .prepare('UPDATE gateway_containers SET status = ?, last_error = ?, port = ?, updated_at = ? WHERE unit_id = ?')
    .run(
      changes.status ?? current.status,
      changes.lastError === undefined ? current.lastError : changes.lastError,
      changes.port ?? current.port,
      new Date().toISOString(),
      unitId,
    );
}

export function deleteGatewayContainer(unitId: string): void {
  db().prepare('DELETE FROM gateway_containers WHERE unit_id = ?').run(unitId);
}

export function usedGatewayPorts(): number[] {
  return (db().prepare('SELECT port FROM gateway_containers WHERE port IS NOT NULL').all() as { port: number }[]).map((row) => row.port);
}
