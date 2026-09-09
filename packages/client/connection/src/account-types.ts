/** Account-context types shared by host and client compilation faces. */
export interface ConnectionAccountScope {
  readonly account: string | null
}

export type ConnectionAccountResolver = (headers: ConnectionAccountHeaders) => string | null | Promise<string | null>

export interface ConnectionAccountHeaders {
  readonly cookie?: string | undefined
  readonly host?: string | undefined
}
