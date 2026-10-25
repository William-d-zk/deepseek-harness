/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * @module @deepseek-ai/dsh-sandbox-local/profiles
 */

import { existsSync } from 'node:fs'
import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-system/landlock-run'
import { workspaceWritableRoots, writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

/**
 * System roots a read-confined execution still needs: the dynamic toolchain
 * (interpreters, loaders, coreutils), system configuration, and package
 * prefixes. Deployments with toolchains elsewhere (e.g. a user-local install)
 * add entries through the provider's `additionalReadOnlyRoots`.
 */
export const DEFAULT_SYSTEM_READONLY_ROOTS: readonly string[] = [
  '/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32',
  '/opt', '/etc', '/usr/local', '/var',
]

/**
 * The effective read allow-list for one policy: the system roots, the
 * provider's configured extras, and the policy's own `readRoots`, minus the
 * writable roots (those are granted read-write separately; binding a path
 * both read-only and read-write would race on mount order).
 * @param policy - the file-effect policy, already carrying the merged readRoots.
 */
export function confinedReadRoots(policy: SandboxPolicy): readonly string[] {
  const writable = new Set(writableRoots(policy))
  // System roots are conveniences, not requirements: a host without 32-bit
  // libraries has no /lib32, and the runners refuse rule paths they cannot
  // open — so a hardcoded absent system root would fail the whole confinement
  // closed. Deployment readRoots, by contrast, must exist (an operator naming
  // a missing root is a configuration error worth failing on).
  const system = DEFAULT_SYSTEM_READONLY_ROOTS.filter(root => existsSync(root))
  return [...new Set([...system, ...(policy.readRoots ?? [])])]
    .filter(root => !writable.has(root))
}

/**
 * Build the bwrap profile arguments for one file-effect policy.
 * @param policy - file-effect policy to express as bwrap mounts.
 * @returns profile arguments before the trailing separator and command argv.
 */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args: string[] = []
  if (policy.readRoots === undefined) {
    // Historical default: the whole root stays readable (write confinement only).
    args.push('--ro-bind', '/', '/')
  } else {
    for (const root of confinedReadRoots(policy)) args.push('--ro-bind', root, root)
  }
  args.push('--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent')
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    for (const root of workspaceWritableRoots(policy)) args.push('--bind', root, root)
  }
  return args
}

/**
 * Build the Landlock launcher grants for one file-effect policy.
 * @param policy - file-effect policy to express as Landlock allow-list grants.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
export function landlockProfileArgs(policy: SandboxPolicy): string[] {
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', ...workspaceWritableRoots(policy))
  }
  // Landlock rulesets are allow-lists: with readRoots the list is the whole
  // grant (everything unlisted is denied); without it the historical whole-root
  // read grant keeps write-only confinement.
  const readOnly = policy.readRoots === undefined ? ['/'] : confinedReadRoots(policy)
  return landlockGrantArgs({ readOnly, readWrite })
}

/** Quote one path as an SBPL string literal. */
function sbplString(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

/**
 * Build the sandbox-exec arguments and SBPL profile for one policy. The
 * workspace-owned writable roots (workspace plus explicit extra directories)
 * come from the shared {@link writableRoots} helper (canonical, deduplicated)
 * so the Seatbelt grant and the in-process fs fence
 * (`@deepseek-ai/dsh-fs-sandbox`) can never drift apart; the helper adds the
 * documented Seatbelt temp areas.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProfileArgs(policy: SandboxPolicy): string[] {
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  const roots = writableRoots(policy)
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  }
  return ['-p', forms.join(' ')]
}
