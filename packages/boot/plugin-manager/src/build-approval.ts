/** Approve pnpm's pending dependency scripts in the current profile's workspace settings. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isAlias, isMap, isNode, isScalar, parseDocument, visit } from 'yaml'
import { ManagementFailure } from './failure.ts'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Value pnpm 11 writes for an undecided entry in allowBuilds. */
const UNDECIDED = 'set this to true or false'

/** Manifest pnpm 12 records the builds it ignored in, relative to the profile directory. */
const IGNORED_BUILDS_FILE = join('node_modules', '.modules.yaml')

/** Read the exact build identifiers pnpm 12 left undecided in the profile's package manifest.
 * @param dir Current profile directory.
 * @returns Identifiers such as `esbuild@0.25.0` or `addon@file:./addon`; empty when pnpm ignored nothing.
 */
async function readIgnoredBuilds(dir: string): Promise<string[]> {
  let text: string
  try { text = await readFile(join(dir, IGNORED_BUILDS_FILE), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return []
  }
  // pnpm writes this file as JSON despite its .yaml extension. A manifest it cannot parse
  // is not a reason to lose the install diagnostic the caller already holds.
  let parsed: unknown
  try { parsed = JSON.parse(text) }
  catch { return [] }
  if (typeof parsed !== 'object' || parsed === null) return []
  const ignored: unknown = Reflect.get(parsed, 'ignoredBuilds')
  return Array.isArray(ignored) ? ignored.filter((entry): entry is string => typeof entry === 'string') : []
}

async function readPolicy(dir: string) {
  let text: string
  try { text = await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    text = '{}\n'
  }
  const document = parseDocument(text)
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isMap(document.contents)) throw new Error('pnpm-workspace.yaml must be a YAML mapping')
  const builds = document.get('allowBuilds')
  if (builds !== undefined && !isMap(builds)) throw new Error('allowBuilds must be a YAML mapping')
  visit(builds ?? null, (_key, node) => {
    if (isAlias(node) || (isNode(node) && 'anchor' in node && node.anchor)) {
      throw new Error('allowBuilds must not contain YAML anchors or aliases')
    }
  })
  // pnpm 11 leaves an undecided package in allowBuilds under its bare name, while pnpm 12
  // writes nothing there and records the identifier it ignored in the package manifest.
  const undecided = isMap(builds) ? builds.items.flatMap(({ key, value }) =>
    isScalar(key) && typeof key.value === 'string' && !/[*?]/.test(key.value)
      && isScalar(value) && value.value === UNDECIDED ? [key.value] : []) : []
  const decided = (identifier: string): boolean => {
    if (!isMap(builds)) return false
    // A decision names either the exact identifier pnpm recorded or — for registry packages
    // only — the bare name, which never identifies a file:, git: or tarball artifact.
    if (builds.has(identifier)) return true
    const separator = identifier.lastIndexOf('@')
    if (separator <= 0) return false
    return /^[\dv^~><=*]/.test(identifier.slice(separator + 1)) && builds.has(identifier.slice(0, separator))
  }
  const ignored = (await readIgnoredBuilds(dir)).filter(identifier => !decided(identifier))
  return { document, pending: [...new Set([...undecided, ...ignored])] }
}

/** Read the build identifiers pnpm left undecided.
 *
 * pnpm 12 records them under `ignoredBuilds` in the profile's own modules manifest, so they are
 * only readable while node_modules exists; the identifiers are exactly what allowBuilds must key
 * on, which makes them specific to the recorded resolution — a moved profile or an updated
 * dependency reports pending again and needs a fresh decision. pnpm 11 instead leaves a
 * placeholder in pnpm-workspace.yaml, which survives installation cleanup.
 * @param dir Current profile directory.
 * @returns Exact identifiers awaiting a build decision; wildcard rules are excluded.
 */
export async function readPendingBuilds(dir: string): Promise<string[]> {
  return (await readPolicy(dir)).pending
}

/** Persist approval without running scripts; the caller holds the profile manifest lock.
 * @param dir Current profile directory.
 * @param names Exact identifiers from the pending build list.
 * @throws If an identifier is no longer pending or allowBuilds contains YAML anchors or aliases; no approvals are written.
 */
export async function approveBuilds(dir: string, names: readonly string[]): Promise<void> {
  const { document, pending } = await readPolicy(dir)
  if (names.some(name => !pending.includes(name))) throw new ManagementFailure('stale-approval')
  if (names.length === 0) return
  for (const name of names) document.setIn(['allowBuilds', name], true)
  await writeFileAtomic(join(dir, 'pnpm-workspace.yaml'), String(document), { mode: 0o600 })
}
