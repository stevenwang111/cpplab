export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class SandboxUnavailableError extends ApiError {
  constructor(message: string, detail?: string) {
    super(503, 'SANDBOX_UNAVAILABLE', message, detail);
  }
}
