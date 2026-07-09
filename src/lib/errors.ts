export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface FbErrorPayload {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export class FacebookApiError extends Error {
  public readonly fbCode?: number;
  public readonly fbSubcode?: number;
  public readonly httpStatus: number;

  constructor(payload: FbErrorPayload, httpStatus: number) {
    super(`Facebook API error${payload.code != null ? ` (code ${payload.code})` : ''}: ${payload.message}`);
    this.name = 'FacebookApiError';
    this.fbCode = payload.code;
    this.fbSubcode = payload.error_subcode;
    this.httpStatus = httpStatus;
  }
}

// Transient Graph API errors worth retrying: 1/2 = temporary, 4/17/32 = rate limit, 613 = messenger rate limit
const RETRYABLE_FB_CODES = new Set([1, 2, 4, 17, 32, 613]);

/**
 * True when a failed Facebook call may succeed on retry.
 * Auth errors (190), permission errors (10, 200-299), invalid params (100),
 * and messenger "user unavailable" (551) never recover without human action.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof FacebookApiError) {
    if (err.fbCode != null) return RETRYABLE_FB_CODES.has(err.fbCode);
    return err.httpStatus >= 500;
  }
  // Network failures / unknown errors: allow retry
  return true;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
