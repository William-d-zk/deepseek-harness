/**
 * Browser-connection account context (host implementation).
 *
 * Hosts with their own login (dsh-alioth's Alioth accounts) can register an
 * account resolver: given a request's headers it returns the signed-in
 * account (opaque string) or null. Every HTTP `/api` dispatch and every
 * remote.mux stream open runs inside an AsyncLocalStorage scope carrying
 * that account, so host plugins (directory pickers, session consumers) can
 * scope data per account without client participation.
 *
 * Account resolution happens at the connection boundaries only; the cookie
 * jar travels with the browser automatically (HttpOnly host cookies are
 * invisible to page JS), so the account claim is server-trusted.
 *
 * @module @deepseek-ai/dsh-client-connection/account-context
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type {
  ConnectionAccountHeaders,
  ConnectionAccountResolver,
  ConnectionAccountScope,
} from './account-types.ts'

/** Async context of the current dispatch/stream open. */
export const connectionAccountStorage = new AsyncLocalStorage<ConnectionAccountScope>()

/** The account (or null) of the dispatch/stream currently being processed. */
export function currentConnectionAccount(): string | null {
  return connectionAccountStorage.getStore()?.account ?? null
}

/**
 * Run `callback` with the account resolved from `headers` in scope.
 * @param headers - request headers (cookie jar).
 * @param resolve - registered resolver; absent resolves null.
 * @param callback - async work (awaits inherit the scope).
 * @returns the callback result.
 */
export async function withResolvedAccount<T>(
  headers: ConnectionAccountHeaders,
  resolve: ConnectionAccountResolver | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  let account: string | null = null
  if (resolve !== undefined) {
    try {
      account = await resolve(headers)
    } catch {
      account = null
    }
  }
  return connectionAccountStorage.run({ account }, callback)
}
