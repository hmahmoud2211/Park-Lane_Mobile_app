/**
 * Runs `attempt` again, up to `retries` more times after `delayMs`, while `shouldRetry`
 * says the failure is worth another try. Only for requests that are safe to repeat.
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  { retries, delayMs, shouldRetry }: { retries: number; delayMs: number; shouldRetry: (error: unknown) => boolean },
): Promise<T> {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (tries >= retries || !shouldRetry(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
