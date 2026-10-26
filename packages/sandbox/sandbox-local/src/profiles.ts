/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * @module @deepseek-ai/dsh-sandbox-local/profiles
 */

import { existsSync, readdirSync } from 'node:fs'
import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-system/landlock-run'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
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
 * Seatbelt's read-isolation dialect differs from the allow-list runners: a
 * pure deny-default allow-list cannot express a working confinement on this
 * platform (the child aborts at exec — scattered startup reads outside any
 * enumerable root set), while a whole-root read grant with narrow deny
 * subpaths IS enforced (verified on macOS 27: reads under a denied subpath
 * answer EPERM, deeper allows override shallower denies by specificity). The
 * system set therefore lists the roots that stay readable wholesale.
 */
export const SEATBELT_SYSTEM_READONLY_ROOTS: readonly string[] = [
  ...DEFAULT_SYSTEM_READONLY_ROOTS, '/System', '/Applications', '/Library', '/private',
  '/opt', '/etc', '/tmp', '/var',
]

/**
 * The minimal deny-subpath cover of the filesystem outside `granted`: every
 * directory sibling that no granted root covers gets denied; a directory that
 * only PARTIALLY covers granted roots recurses instead (so `/Users` with a
 * granted workspace below denies the other users, not itself). Directory
 * listing is injected so the walk stays pure for tests.
 * @param granted - canonical absolute roots that must stay readable.
 * @param listDir - directory listing (children of one directory, no paths).
 * @returns deny subpaths for the Seatbelt profile, deduplicated, sorted.
 */
export interface SeatbeltDenyEntry {
  /** Child name (no path). */
  readonly name: string
  /** Whether the child is a directory — files are denied directly, only directories recurse. */
  readonly directory: boolean
}

export function seatbeltDenyPaths(
  granted: readonly string[],
  listDir: (dir: string) => readonly SeatbeltDenyEntry[] = dir => readdirSync(dir, { withFileTypes: true })
    .map(entry => ({ name: entry.name, directory: entry.isDirectory() })),
): string[] {
  const wanted = [...new Set(granted)]
  const denies = new Set<string>()
  const walk = (dir: string): void => {
    let children: readonly SeatbeltDenyEntry[]
    try {
      children = listDir(dir)
    } catch {
      denies.add(dir)
      return
    }
    for (const child of children) {
      const full = dir.endsWith('/') ? `${dir}${child.name}` : `${dir}/${child.name}`
      const covers = wanted.some(root => full === root || full.startsWith(`${root}/`))
      if (covers) continue
      if (!child.directory) {
        denies.add(full)
        continue
      }
      const inside = wanted.some(root => root.startsWith(`${full}/`))
      if (inside) walk(full)
      else denies.add(full)
    }
  }
  walk('/')
  return [...denies].sort()
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
    args.push('--bind', policy.workspaceRoot, policy.workspaceRoot)
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
    readWrite.push('/tmp', policy.workspaceRoot)
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
 * writable roots come from the shared {@link writableRoots} helper (canonical,
 * deduplicated) so the Seatbelt grant and the in-process fs fence
 * (`@deepseek-ai/dsh-fs-sandbox`) can never drift apart.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProfileArgs(policy: SandboxPolicy, denyPaths?: readonly string[]): string[] {
  if (policy.readRoots !== undefined) {
    // Read-isolation dialect (see SEATBELT_SYSTEM_READONLY_ROOTS): deny
    // default for every other effect class — exec/fork/sysctl/mach/signal/
    // ipc are the startup set a denied default still needs, network stays
    // open because the allow-list runners (Landlock, bwrap) do not confine
    // it either — then the whole root stays readable minus the caller's
    // computed deny cover. Write grants ride the existing writable form.
    const forms = [
      '(version 1)',
      '(deny default)',
      '(allow process-exec)', '(allow process-fork)', '(allow sysctl-read)',
      '(allow mach-lookup)', '(allow signal)', '(allow ipc-posix-shm)', '(allow network*)',
      '(allow file-read* (subpath "/"))',
    ]
    for (const deny of denyPaths ?? []) forms.push(`(deny file-read* (subpath ${sbplString(deny)}))`)
    const writable = writableRoots(policy)
    if (writable.length > 0) {
      forms.push(`(allow file-write* ${writable.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
    }
    forms.push(`(allow file-write* (literal ${sbplString('/dev/null')}))`)
    return ['-p', forms.join(' ')]
  }
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  const roots = writableRoots(policy)
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  }
  return ['-p', forms.join(' ')]
}
