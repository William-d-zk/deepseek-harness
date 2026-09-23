/** Account-context types shared by host and client compilation faces. */
export interface ConnectionAccountScope {
  readonly account: string | null
}

/** Resolve the signed-in account for one request from its headers. */
export type ConnectionAccountResolver = (headers: ConnectionAccountHeaders) => string | null | Promise<string | null>

/** Host-login headers an account resolver reads; both may be absent. */
export interface ConnectionAccountHeaders {
  readonly cookie?: string | undefined
  readonly host?: string | undefined
}
