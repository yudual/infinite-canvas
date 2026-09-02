import { ApiResponse } from '../types.js';

export class AssertionError extends Error {
  constructor(message: string, public expected?: any, public actual?: any) {
    super(message);
    this.name = 'AssertionError';
  }
}

export function assertTrue(value: boolean, message = 'Expected value to be true'): void {
  if (!value) {
    throw new AssertionError(message, true, value);
  }
}

export function assertFalse(value: boolean, message = 'Expected value to be false'): void {
  if (value) {
    throw new AssertionError(message, false, value);
  }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  const msg = message || `Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`;
  if (actual !== expected) {
    throw new AssertionError(msg, expected, actual);
  }
}

export function assertDeepEqual<T>(actual: T, expected: T, message?: string): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new AssertionError(message || `Deep equality mismatch`, expected, actual);
  }
}

export function assertStatus(res: ApiResponse, expectedStatus: number | number[], message?: string): void {
  const allowed = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!allowed.includes(res.status)) {
    const errorDetails = res.data && typeof res.data === 'object' ? JSON.stringify(res.data) : res.rawText;
    throw new AssertionError(
      message || `Expected HTTP status ${allowed.join(' or ')} but received ${res.status}. Response: ${errorDetails}`,
      expectedStatus,
      res.status
    );
  }
}

export function assertContains(haystack: string, needle: string, message?: string): void {
  if (!haystack || !haystack.includes(needle)) {
    throw new AssertionError(
      message || `Expected string to contain "${needle}"`,
      needle,
      haystack
    );
  }
}

export function assertNotContains(haystack: string, needle: string, message?: string): void {
  if (haystack && haystack.includes(needle)) {
    throw new AssertionError(
      message || `Expected string NOT to contain "${needle}"`,
      `not containing ${needle}`,
      haystack
    );
  }
}

export function assertValidJwt(token: string, message = 'Expected valid JWT format'): void {
  assertTrue(typeof token === 'string' && token.length > 0, `${message}: Token is empty`);
  const parts = token.split('.');
  assertTrue(parts.length === 3, `${message}: JWT must have 3 segments separated by dots, got ${parts.length}`);
}

export function assertNoKeyLeak(payload: any, secretKey: string): void {
  if (!secretKey || secretKey.length < 4) return;
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  assertNotContains(serialized, secretKey, `Security Violation: Secret API key "${secretKey}" was leaked in payload!`);
}

export function assertDefined<T>(val: T | undefined | null, name = 'Value'): asserts val is T {
  if (val === undefined || val === null) {
    throw new AssertionError(`${name} must be defined and not null`, 'defined', val);
  }
}
