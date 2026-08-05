import { defineConfig } from 'tsup'

// Three published subpaths built as ESM + CJS + .d.ts. Peers stay external so
// the bundle never inlines a consumer-controlled runtime dependency.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'pagination/index': 'src/pagination/index.ts',
    'health/index': 'src/health/index.ts',
    'openapi/index': 'src/openapi/index.ts',
    'metrics/index': 'src/metrics/index.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  tsconfig: 'tsconfig.build.json',
  outDir: 'dist',
  outExtension: ({ format }) => ({
    js: format === 'esm' ? '.mjs' : '.cjs'
  }),
  external: [/^@nestjs\//, 'rxjs', 'reflect-metadata', 'prom-client'],
  target: 'node24',
  clean: false,
  splitting: false,
  treeshake: true,
  minify: false,
  sourcemap: false
})
