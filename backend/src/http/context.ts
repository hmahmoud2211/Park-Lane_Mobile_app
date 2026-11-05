import type { IncomingMessage, ServerResponse } from 'node:http';

/** One request as the routes see it. */
export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** The path without the query string: routes match on it, and the access log prints only it. */
  path: string;
  method: string;
}

export function contextOf(req: IncomingMessage, res: ServerResponse): RequestContext {
  const url = new URL(req.url ?? '/', 'http://backend');
  return { req, res, url, path: url.pathname, method: req.method ?? 'GET' };
}
