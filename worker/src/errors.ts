export type ErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN_ORIGIN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'AI_RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'INVALID_AI_RESPONSE'
  | 'MISCONFIGURED'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Błąd po stronie dostawcy AI (HTTP), z informacją, czy warto ponowić. */
export class ProviderError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
