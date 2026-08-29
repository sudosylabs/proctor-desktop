import { createRequire } from 'node:module';
import type { NativeBaselineDriver } from '../common/securityUtilityProtocol.js';

export function loadNativeBaselineDriver(nativeModulePath: string): NativeBaselineDriver {
  const required: unknown = createRequire(import.meta.url)(nativeModulePath);
  if (!isNativeBaselineDriver(required)) {
    throw new Error('native baseline binding does not expose the fixed bridge surface');
  }
  const driver: NativeBaselineDriver = {
    manifest: () => required.manifest(),
    openBaseline: request => required.openBaseline(request),
    candidateWindowEvent: event => required.candidateWindowEvent(event),
    candidateWindowEventsLost: lostCount => required.candidateWindowEventsLost(lostCount),
    pollBaseline: () => required.pollBaseline(),
    stopBaseline: finalCandidateWindow => required.stopBaseline(finalCandidateWindow)
  };
  return Object.freeze(driver);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNativeBaselineDriver(value: unknown): value is NativeBaselineDriver {
  return isRecord(value)
    && Object.keys(value).length === 6
    && typeof value.manifest === 'function'
    && typeof value.openBaseline === 'function'
    && typeof value.candidateWindowEvent === 'function'
    && typeof value.candidateWindowEventsLost === 'function'
    && typeof value.pollBaseline === 'function'
    && typeof value.stopBaseline === 'function';
}
