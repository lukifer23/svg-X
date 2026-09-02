# Recovery branch inventory

Recorded before remote branch cleanup on 2026-09-01.

| Remote branch                              | Recorded head                              | Unique scope relative to pre-recovery `main`                              |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------- |
| `codex/refactor-logging-in-imageprocessor` | `ef77958284fcde35dab4bdbefd107cc0e835ff56` | No unique commits or files                                                |
| `dependabot/npm_and_yarn/electron-35.7.5`  | `429a436620bff85e8eea0a2d3b269f208df32cc8` | Dependency manifest/lockfile only; superseded by Electron 44.1.1          |
| `dependabot/npm_and_yarn/glob-10.5.0`      | `c872909cc6d3e7d4ca9ecf29e205eb28a47248e6` | Lockfile only; superseded by the regenerated audited lockfile             |
| `dependabot/npm_and_yarn/js-yaml-4.1.1`    | `2c6331496edeaa57d5513ff14909a4b44770132b` | Lockfile only; superseded by the regenerated audited lockfile             |
| `dependabot/npm_and_yarn/lodash-4.17.23`   | `d77aabe07977a4d09b9b681113c7c941c9949301` | Lockfile only; superseded by the regenerated audited lockfile             |
| `dependabot/npm_and_yarn/multi-8ed2e89ee2` | `34b7b47784c8e37a7c8dddf3ebf10fb891b75471` | Lockfile only; superseded by the regenerated audited lockfile             |
| `dependabot/npm_and_yarn/multi-a07fd7252a` | `601ecab29e10d64eb9025fc169a68a0873247935` | Dependency manifest/lockfile only; superseded by current supported majors |
| `dependabot/npm_and_yarn/multi-aa3b6995fd` | `56ab51e93d2a9f4b992463a26be6c39cdbdee186` | Dependency manifest/lockfile only; superseded by current supported majors |

No branch contained a product change absent from the recovery work. Historical tags and releases were not modified.
