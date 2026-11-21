import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** Userscript imports need local stand-ins under Vitest; production builds are unchanged. */
const stub = (name: string) => fileURLToPath(new URL(`./tests/stubs/${name}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^\$$/, replacement: stub('tampermonkey.ts') },
      { find: 'virtual:tamperina-rina', replacement: stub('rina.ts') },
      { find: 'virtual:tamperina-fonts', replacement: stub('fonts.ts') },
    ],
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
})
