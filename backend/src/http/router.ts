import type { RequestContext } from './context.ts';

/**
 * A group of routes: it answers and returns true, or returns false so the next group can
 * try. A route may check the caller before it looks at the method, so a path it owns can
 * answer 401 for any method; a method it does not handle falls through and, if no group
 * takes it, ends as 404 (never 405). Throwing an ApiError answers with that error.
 */
export type RouteGroup = (ctx: RequestContext) => Promise<boolean>;

/** Tries the groups in order; false when none answered. */
export async function dispatch(ctx: RequestContext, groups: readonly RouteGroup[]): Promise<boolean> {
  for (const group of groups) {
    if (await group(ctx)) {
      return true;
    }
  }
  return false;
}
