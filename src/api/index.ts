// Which API the app talks to. EXPO_PUBLIC_API_URL set → Dev 2's server over HTTP; unset → the in-app mock.
import type { GachaApi } from './contract';
import { createHttpApi } from './http';
import { createMockApi, type MockApi } from './mock';

let accessTokenProvider: () => Promise<string | null> = async () => null;
/** F7.4 installs Privy's getAccessToken here. */
export function setAccessTokenProvider(fn: () => Promise<string | null>) { accessTokenProvider = fn; }
/** Read the installed provider back. Only F7.4's wiring test uses it: without it, "the app hands the HTTP client Privy's
 *  token" is a claim no test can fail on. */
export function currentAccessTokenProvider() { return accessTokenProvider; }

// EXPO_PUBLIC_USE_MOCK=1 (or a dev build with no API URL) → the in-app mock. A release build with no
// URL and no opt-in talks to nothing and shows the "not configured" error rather than fake stock.
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
const optIn = process.env.EXPO_PUBLIC_USE_MOCK === '1';
export const usingMock = optIn || (__DEV__ && !baseUrl);
export const mock: MockApi | null = usingMock ? createMockApi() : null;
export const api: GachaApi = mock ?? createHttpApi({ baseUrl, getAccessToken: () => accessTokenProvider() });
export const apiConfigured = usingMock || baseUrl.length > 0;

export * from './contract';
export { ApiError, errorCopy, prepareErrorCopy, toApiError } from './errors';
