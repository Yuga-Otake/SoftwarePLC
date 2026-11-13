export type AIErrorKind = 'auth' | 'network' | 'rate_limit' | 'bad_output' | 'refusal' | 'api';

/** AI プロバイダの失敗。message はそのままユーザーに見せられる日本語。API キーは決して含めない。 */
export class AIError extends Error {
  readonly kind: AIErrorKind;
  readonly status?: number;
  constructor(kind: AIErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AIError';
    this.kind = kind;
    this.status = status;
  }
}
