import { auditAdmin } from '../ems/adminAudit.ts';
import { lookupToken, bearerOf, requireUser } from '../ems/auth.ts';
import { ApiError } from '../errors.ts';
import { linkValid, publicBase } from '../health/files.ts';
import { readBytes, readJson } from '../http/body.ts';
import { authorizeAdmin } from '../http/guards.ts';
import { decodeSegment } from '../http/params.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok, sendBytes } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';
import {
  MAX_DOCUMENT_BYTES,
  addCharge,
  addContract,
  addDocument,
  adminFinance,
  cancelCharge,
  documentFile,
  memberMayOpenDocument,
  recordPayment,
  removeDocument,
  saveMeterReadings,
  setUnitDetails,
  unitCharges,
  unitMeterHistory,
  unitOverview,
  unitPayments,
} from '../unit/finance.ts';

/**
 * My Unit and Bills (unit/finance.ts):
 *   GET  /api/unit/overview                        details, finance (owners), meters, documents
 *   GET  /api/unit/charges?group=bills|installments    GET /api/unit/payments     (owners)
 *   GET  /api/unit/meters?months=12                GET /api/unit/documents/:id/file   (member, or a signed link)
 * Building management:
 *   PUT  /api/admin/units/:id/details              GET /api/admin/units/:id/finance
 *   POST /api/admin/units/:id/contracts            POST /api/admin/units/:id/charges      POST /api/admin/charges/:id/void
 *   POST /api/admin/units/:id/payments             PUT  /api/admin/units/:id/meters
 *   POST /api/admin/units/:id/documents?kind=&title=   (the file as the body)    DELETE /api/admin/documents/:id
 */
export const unitFinanceRoutes: RouteGroup = async ({ req, res, path, method, url }) => {
  if (path === '/api/unit/overview' && method === 'GET') {
    ok(res, unitOverview(requireUser(req), publicBase(req)));
    return true;
  }
  if (path === '/api/unit/charges' && method === 'GET') {
    ok(res, unitCharges(requireUser(req), url.searchParams.get('group')));
    return true;
  }
  if (path === '/api/unit/payments' && method === 'GET') {
    ok(res, unitPayments(requireUser(req)));
    return true;
  }
  if (path === '/api/unit/meters' && method === 'GET') {
    ok(res, unitMeterHistory(requireUser(req), Number(url.searchParams.get('months')) || 12));
    return true;
  }
  const file = /^\/api\/unit\/documents\/([^/]+)\/file$/.exec(path);
  if (file && method === 'GET') {
    const id = decodeSegment(file[1]);
    const session = lookupToken(bearerOf(req), ['session']);
    if (!linkValid(path, url) && !(session && memberMayOpenDocument(session.user, id))) throw new ApiError('not_found', 'Not found.');
    const found = documentFile(id);
    if (!found) throw new ApiError('not_found', 'Not found.');
    sendBytes(res, found.row.mime, found.bytes);
    return true;
  }

  if (!path.startsWith('/api/admin/units/') && !path.startsWith('/api/admin/charges/') && !path.startsWith('/api/admin/documents/')) return false;
  const unitRoute = /^\/api\/admin\/units\/([^/]+)\/(details|finance|contracts|charges|payments|meters|documents)$/.exec(path);
  const chargeVoid = /^\/api\/admin\/charges\/([^/]+)\/void$/.exec(path);
  const documentDelete = /^\/api\/admin\/documents\/([^/]+)$/.exec(path);
  if (!unitRoute && !chargeVoid && !documentDelete) return false;
  const { user } = authorizeAdmin(req);

  if (chargeVoid && method === 'POST') {
    const id = decodeSegment(chargeVoid[1]);
    ok(res, cancelCharge(id));
    auditAdmin(user, 'charge.void', { type: 'charge', id });
    return true;
  }
  if (documentDelete && method === 'DELETE') {
    const id = decodeSegment(documentDelete[1]);
    ok(res, removeDocument(id));
    auditAdmin(user, 'document.delete', { type: 'unit_document', id });
    return true;
  }
  if (!unitRoute) return false;
  const unitId = decodeSegment(unitRoute[1]);
  const target = { type: 'unit', id: unitId };
  switch (`${method} ${unitRoute[2]}`) {
    case 'PUT details':
      ok(res, setUnitDetails(unitId, await readJson(req)));
      auditAdmin(user, 'unit.details', target);
      return true;
    case 'GET finance':
      ok(res, adminFinance(unitId, publicBase(req)));
      return true;
    case 'POST contracts': {
      const created = addContract(unitId, await readJson(req));
      auditAdmin(user, 'unit.contract', target, created);
      ok(res, created);
      return true;
    }
    case 'POST charges': {
      const charge = addCharge(unitId, await readJson(req));
      auditAdmin(user, 'unit.charge', target, { charge: charge.reference, amount: charge.amount });
      ok(res, charge);
      return true;
    }
    case 'POST payments': {
      const payment = recordPayment(unitId, await readJson(req), user);
      auditAdmin(user, 'unit.payment', target, { receipt: payment.receiptNo, amount: payment.amount });
      ok(res, payment);
      return true;
    }
    case 'PUT meters':
      ok(res, saveMeterReadings(unitId, await readJson(req, 64 * 1024)));
      auditAdmin(user, 'unit.meters', target);
      return true;
    case 'POST documents': {
      throttle('unit-document', user?.id ?? 'api-key');
      const bytes = await readBytes(req, MAX_DOCUMENT_BYTES);
      const document = addDocument(unitId, { kind: url.searchParams.get('kind'), title: url.searchParams.get('title'), bytes }, user, publicBase(req));
      auditAdmin(user, 'unit.document', target, { document: document.id, kind: document.kind });
      ok(res, document);
      return true;
    }
    default:
      return false;
  }
};
