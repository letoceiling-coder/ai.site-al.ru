export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider: string,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export async function withRetry<T>(
  execute: () => Promise<T>,
  retries = 2,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await execute();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
