# @bymax-one/nest-core

Zero-dependency NestJS 11 application foundation kit: a stable error-envelope
exception filter, a request-timing interceptor with a pluggable sink,
framework-neutral pagination helpers, health endpoints with a pluggable
indicator contract, and an optional Prometheus metrics endpoint. Everything
ships as a peer dependency; the package itself carries `"dependencies": {}`.

[![CI](https://img.shields.io/github/actions/workflow/status/bymaxone/nest-core/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/bymaxone/nest-core/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@bymax-one/nest-core?style=flat-square)](https://www.npmjs.com/package/@bymax-one/nest-core)
[![license](https://img.shields.io/github/license/bymaxone/nest-core?style=flat-square)](./LICENSE)
[![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square)](https://github.com/bymaxone/nest-core/actions/workflows/ci.yml)
[![mutation score](https://img.shields.io/badge/mutation-pending-lightgrey?style=flat-square)](./docs/technical_specification.md)

## Install

```bash
pnpm add @bymax-one/nest-core @nestjs/common @nestjs/core reflect-metadata rxjs
```

Add `prom-client` as well if you enable the metrics endpoint:

```bash
pnpm add prom-client
```

## Quick start

> This package is under active development and is not yet published. The
> module and its options shown below become available as the feature phases
> land; the snippet describes the target API.

```typescript
import { Module } from '@nestjs/common'
import { BymaxCoreModule } from '@bymax-one/nest-core'

@Module({
  imports: [BymaxCoreModule.forRoot({})]
})
export class AppModule {}
```

The full configuration surface, the error-code catalog, and the health
indicator contract are documented as each feature phase lands; see
[`docs/technical_specification.md`](./docs/technical_specification.md) for the
complete design.

## Subpaths

| Subpath        | Content                                                                   |
| -------------- | ------------------------------------------------------------------------- |
| `.`            | Dynamic module, exception filter, timing interceptor, tokens, error codes |
| `./pagination` | Offset and cursor pagination DTOs, result builders, cursor codec          |
| `./health`     | Health indicator contract, aggregation service, response types            |

## Documentation

- [`docs/technical_specification.md`](./docs/technical_specification.md), full design
- [`docs/development_plan.md`](./docs/development_plan.md), phased execution plan and status
- [`CONTRIBUTING.md`](./CONTRIBUTING.md), development workflow and quality gates
- [`SECURITY.md`](./SECURITY.md), vulnerability reporting

## License

MIT, see [`LICENSE`](./LICENSE).
