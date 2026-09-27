export const AUTH_REQUEST_TIMEOUT_MS = 12_000;

export class AuthRequestTimeoutError extends Error {
  constructor(operation: string) {
    super(`${operation} timed out`);
    this.name = "AuthRequestTimeoutError";
  }
}

export async function withAuthTimeout<T>(
  request: PromiseLike<T>,
  operation: string,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new AuthRequestTimeoutError(operation)), timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(request), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function authErrorMessage() {
  return "Unable to connect. Please try again.";
}

export function authDebug(label: string, details?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.info(`[Auth] ${label}`, details ?? {});
}
