/**
 * The mock's `mock://` addresses resolve to files bundled for mock builds
 * only; a real `audio_url` or `file_url` is fetched with the session's
 * headers.
 *
 * The condition is healthConfig's mock check, written out here because the
 * bundler can drop the require (and the files) only when it can read the
 * condition at this spot: `__DEV__` and EXPO_PUBLIC_ variables are fixed at
 * build time.
 */
const BUNDLED: Readonly<Record<string, number>> =
  process.env.EXPO_PUBLIC_HEALTH_API === 'mock' || (__DEV__ && process.env.EXPO_PUBLIC_HEALTH_API !== 'http')
    ? // A require, not an import, so it can sit behind the build-time check above.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('./mockMedia') as typeof import('./mockMedia')).MOCK_FILES
    : {};

export type MediaSource = number | { uri: string; headers?: Record<string, string> };

/** Local files (a fresh upload in the mock) need no headers. */
const isLocal = (url: string) => /^(file|content|ph|assets-library|blob|data):/.test(url);

export function mediaSource(url: string, headers: Record<string, string>): MediaSource {
  const bundled = BUNDLED[url];
  if (bundled !== undefined) return bundled;
  return isLocal(url) ? { uri: url } : { uri: url, headers };
}
