import { clientBundle } from '../tsdown.client.ts'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const bundle = clientBundle('@deepseek-ai/dsh-client-ui-settings-account', ['lib/types/index.js'])

/** Source-tree assets this plugin inlines; resolve from the importing module. */
const ASSET_SOURCE = /^\.{1,2}\/.*\.(?:svg|png)(\?raw)?$/
/** The file this plugin inlines, once resolved (still inside the package's client sources). */
const ASSET_ID = /\/ui-settings-account\/src\/client\/.*\.(?:svg|png)(\?raw)?$/

export default ((options) => bundle(options).map(config => ({
  ...config,
  plugins: [...(config.plugins ?? []), {
    name: 'account-onboarding-assets',
    resolveId(source: string, importer: string | undefined) {
      // The import appears in the EMITTED module (lib/types/client/…), because the
      // client bundle's entries are the tsc outputs; the asset itself lives in the
      // source tree. Map the importer back to src/client and resolve there, so a
      // moved assets directory needs no edit here.
      if (importer === undefined || !ASSET_SOURCE.test(source)) return null
      const emitted = importer.replaceAll('\\', '/')
      const sourceImporter = emitted.replace('/lib/types/client/', '/src/client/')
      if (sourceImporter === emitted || !sourceImporter.includes('/src/client/')) return null
      const url = new URL(source, pathToFileURL(sourceImporter))
      return decodeURIComponent(url.pathname) + url.search
    },
    async load(id: string) {
      if (!ASSET_ID.test(id.replaceAll('\\', '/'))) return null
      const path = id.replace(/\?raw$/, '')
      this.addWatchFile(path)
      const data = await readFile(path)
      if (id.endsWith('?raw')) return `export default ${JSON.stringify(data.toString('utf8'))}`
      return `export default ${JSON.stringify(`data:${path.endsWith('.png') ? 'image/png' : 'image/svg+xml'};base64,${data.toString('base64')}`)}`
    },
  }],
}))) satisfies typeof bundle
