/**
 * Method-level access control contracts: actions, roles, bindings, policies,
 * decision requests, and the access snapshot stream.
 * @module @deepseek-ai/dsh-api-remote-access/types
 */

import type {
  Principal,
  RemoteAccessResource,
  RemoteAccessResourceKind,
  RemoteAccessResourceOf,
} from '@deepseek-ai/dsh-typert-protocol'

export type {
  RemoteAccessResource,
  RemoteAccessResourceKind,
  RemoteAccessResourceOf,
  TypertResourceKind,
  TypertResourceMap,
} from '@deepseek-ai/dsh-typert-protocol'

/** Canonical `<namespace>/<method>` Remote endpoint; its segments never contain `:`. */
export type RemoteAccessEndpoint = `${string}/${string}`

/** A Remote endpoint, or `event:<name>` for one forwarded event. */
export type RemoteAccessAction = RemoteAccessEndpoint | `event:${string}`

/** A named action set over one resource kind; a plain value the business package owns. */
export interface RemoteAccessRole<K extends RemoteAccessResourceKind> {
  /** Name for diagnostics; decisions read only `resource` and `actions`. */
  readonly name: string
  /** The resource kind every binding of this role names. */
  readonly resource: K
  /** Actions the role allows on its binding's resource. */
  readonly actions: readonly RemoteAccessAction[]
}

/** Answer of `decide()` and of a condition. */
export type RemoteAccessDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly reason: string }

/**
 * Refines one binding for one action on its resource. Called synchronously,
 * only for a binding whose resource matches and whose role lists the action.
 * @param request - the action, the binding's resource, and the named
 *   arguments of a concrete call, validated against their Typert-compiled
 *   types with lookup parameters as wire identities; `args` is absent for
 *   events, snapshots, and list filtering, where the condition answers for
 *   the action alone.
 * @returns allow, or deny with the reason a refused call reports.
 */
export type RemoteAccessCondition<K extends RemoteAccessResourceKind> = (request: {
  readonly action: RemoteAccessAction
  readonly resource: RemoteAccessResourceOf<K>
  readonly args?: Readonly<Record<string, unknown>>
}) => RemoteAccessDecision

/** One role on one resource of the role's kind; the resource type follows from the role. */
export type RemoteAccessBinding = {
  [K in RemoteAccessResourceKind]: {
    readonly role: RemoteAccessRole<K>
    readonly resource: RemoteAccessResourceOf<K>
    /** Without a condition, the binding allows every action its role lists. */
    readonly condition?: RemoteAccessCondition<K>
  }
}[RemoteAccessResourceKind]

/** One access question: may `principal` take `action` on `resources`. */
export interface RemoteAccessRequest<P extends Principal> {
  readonly principal: P
  readonly action: RemoteAccessAction
  /**
   * Every resource the action touches, the global resource alone when it
   * names none; allowed only when the action is allowed on every listed resource.
   */
  readonly resources: readonly RemoteAccessResource[]
  /**
   * Named arguments of a concrete call, validated against their Typert-compiled types
   * with lookup parameters as wire identities; absent for events, snapshots, and list filtering.
   */
  readonly args?: Readonly<Record<string, unknown>>
}

/**
 * Business rules for one non-owner principal kind. Every member answers
 * synchronously from state the business package holds in memory.
 */
export interface RemoteAccessPolicy<P extends Principal> {
  /**
   * List the principal's bindings. Called once per `decide()`, once per
   * `allows()`, and once per snapshot computation; never cached.
   * @param principal - non-owner caller of this policy's kind.
   * @returns every binding the principal holds now.
   */
  bindings(principal: P): readonly RemoteAccessBinding[]
  /**
   * Name the reason for a request no binding allows; called only after the
   * decision is already a deny, so it never changes the decision.
   * @param request - the refused request.
   * @returns the reason a refused call reports, or `undefined` for `no-allow`.
   */
  explain?(request: RemoteAccessRequest<P>): string | undefined
}

/** Details of a refused non-owner call. */
export interface RemoteAccessDeniedDetails {
  /** Canonical `<namespace>/<method>` endpoint of the refused call. */
  readonly action: string
  /**
   * A condition's or `explain()`'s reason, `no-allow`, or `policy-failed`;
   * the Gateway refuses a call whose resources are invalid with
   * `resource-invalid` before `decide()` is asked.
   */
  readonly reason: string
}

/**
 * Deployment-owned scoping policy for logged-in browser callers. A host with
 * its own login (every connected browser is an owner Peer with no finer
 * principal) registers one through `remoteAccess.registerAccountPolicy`; the
 * service then consults it for Session and Workspace questions, keyed by the
 * dispatch's resolved login account. Headless dispatches (no account) and
 * deployments without a policy stay unscoped.
 */
/** Caller-supplied facts about one Session that a policy may fall back to. */
export interface RemoteSessionHints {
  /** The Workspace directory the Session is accounted to, when known. */
  readonly workspacePath?: string
}

export interface RemoteAccountPolicy {
  /**
   * Whether the account may see and operate one Session. Answers
   * synchronously from in-process state, so a guard cannot reorder the
   * microtasks a Remote answer's own scheduling depends on; deployments back
   * it with an in-memory mirror they keep coherent themselves. The hints let
   * a policy derive ownership for Sessions its mirror does not know (a
   * Session accounted to a Workspace inside the caller's own tree).
   * @param account - the dispatch's resolved login account.
   * @param sessionId - the Session the call reads or operates.
   * @param hints - caller-known Session facts; absent when nothing is known.
   */
  readonly sessionAccessible: (account: string, sessionId: string, hints?: RemoteSessionHints) => boolean
  /**
   * Whether the account may register (and thus keep) a Workspace over one
   * directory, with the same synchronous contract.
   * @param account - the dispatch's resolved login account.
   * @param path - fully qualified Workspace directory.
   */
  readonly workspaceAdmissible: (account: string, path: string) => boolean
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'remote-access/denied': RemoteAccessDeniedDetails
  }
}

/** The endpoint actions one principal may call on one resource. */
export interface RemoteAccessGrant {
  readonly resource: RemoteAccessResource
  /**
   * Endpoint actions allowed on this resource without call arguments, sorted;
   * plain strings because Typert generates no codec for template literal types.
   */
  readonly actions: readonly string[]
}

/**
 * One frame of `remoteAccess/follow`. A generation opens with one baseline;
 * an owner baseline is the only frame of its generation.
 */
export type RemoteAccessFrame =
  | { readonly type: 'baseline'; readonly owner: true }
  | { readonly type: 'baseline'; readonly owner: false; readonly grants: readonly RemoteAccessGrant[] }
  | { readonly type: 'upsert'; readonly grant: RemoteAccessGrant }
  | { readonly type: 'remove'; readonly resource: RemoteAccessResource }
