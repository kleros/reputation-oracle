# Phase 1000: Upgrade Bot Dependencies to Latest Majors - Research

**Researched:** 2026-03-27
**Domain:** Dependency upgrades (zod v3->v4, Biome v1->v2, vitest v3->v4)
**Confidence:** HIGH

## Summary

Three major dependency upgrades for the bot package. The codebase is small (9 source files, 4 test files) with minimal surface area for each dependency. Zod is used in one file (`config.ts`) with basic `z.object/z.string/z.coerce/z.infer/safeParse`. Biome config is simple (recommended rules, tab indent, 120 line width). Vitest tests use only `describe/it/expect/vi.spyOn/vi.fn` -- no advanced features.

All three upgrades have automated migration tools. The risk is LOW given the small codebase. The main gotcha is Biome v2's glob pattern and organizeImports config restructuring, which `biome migrate --write` handles automatically.

**Primary recommendation:** Upgrade sequentially -- zod first (smallest surface), then vitest (test runner must work for verification), then Biome last (formatter/linter, verify output matches expectations).

## Standard Stack

### Core (Target Versions)
| Library | Current | Target | Purpose | Migration Effort |
|---------|---------|--------|---------|-----------------|
| zod | 3.25.76 | ^4.3.6 | Config validation | LOW -- 1 file, basic APIs |
| @biomejs/biome | 1.9.4 | ^2.4.9 | Lint + format | LOW -- `biome migrate --write` |
| vitest | 3.2.4 | ^4.1.2 | Unit tests | LOW -- basic test APIs only |

### Unchanged (No Upgrade Needed)
| Library | Version | Notes |
|---------|---------|-------|
| viem | ^2.47.0 | Already latest major |
| graphql-request | ^7.4.0 | Already latest major |
| typescript | ^5.7.0 | Installed 5.9.3, fine |
| tsx | ^4.21.0 | Already latest major |
| @types/node | ^22.0.0 | Already latest major |

**Installation:**
```bash
cd bot
npm install zod@^4.3.6
npm install -D @biomejs/biome@^2.4.9 vitest@^4.1.2
```

## Architecture Patterns

### Zod v4 Migration Pattern

**Current usage (config.ts only):**
```typescript
import { z } from "zod";
const hexAddress = z.string().regex(/.../, "Invalid hex address");
export const configSchema = z.object({ ... });
export type Config = z.infer<typeof configSchema>;
configSchema.safeParse(env);
result.error.issues
```

**What changes in v4:**
- `import { z } from "zod"` -- **works as-is** with zod@4.x (the default export IS v4)
- `z.object()` -- **no change** for basic usage
- `z.string().regex()` -- **no change**
- `z.coerce.number()` -- **no change** (input type widens from `string` to `unknown`, but runtime behavior identical)
- `z.infer` -- **no change**
- `safeParse` -- **no change** (returns same `{success, data}` | `{success, error}` shape)
- `result.error.issues` -- **no change** (ZodError shape preserved)

**Verdict:** Zero code changes needed for this project's zod usage. The APIs used are all backward-compatible. The only breaking changes in zod v4 (error customization, `.email()` -> `z.email()`, `.strict()` -> `z.strictObject()`, default behavior in optional fields) do NOT apply here.

### Biome v2 Migration Pattern

**Current config (biome.json):**
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "formatter": { "enabled": true, "indentStyle": "tab", "lineWidth": 120 },
  "linter": { "enabled": true, "rules": { "recommended": true } }
}
```

**What changes in v2:**
1. `$schema` URL updates to v2 schema
2. `organizeImports` moves to `assist.actions.source.organizeImports`
3. Glob patterns are now relative to config file (not CWD) -- no globs in current config, so no impact
4. New linter rules may flag new issues

**Migration command:** `npx @biomejs/biome migrate --write` handles all config changes automatically.

**Post-migration:** Run `biome check .` and fix any new lint errors from v2 rules.

### Vitest v4 Migration Pattern

**Current usage (4 test files):**
- `import { describe, expect, it, vi } from "vitest"` -- **no change**
- `vi.spyOn(console, "warn").mockImplementation(() => {})` -- **no change**
- `vi.spyOn(console, "error").mockImplementation(() => {})` -- **no change**
- No vitest config file (uses defaults)
- No coverage config
- No pool config
- No browser tests
- No custom reporters

**Breaking changes that DO NOT affect this project:**
- Pool config flattening (no pool config exists)
- Coverage.all removal (no coverage config)
- Browser provider changes (no browser tests)
- `vi.fn().mock.invocationCallOrder` starts at 1 (not used)
- Reporter changes (using defaults)
- Workspace -> projects rename (no workspace config)
- Test options third argument (not used)

**Breaking change that MAY affect:**
- `exclude` defaults changed: v4 only excludes `node_modules` and `.git` by default. Previous defaults also excluded `dist`, `cypress`, config files, etc. Since the bot has no vitest config file, the default `exclude` applies. The bot has no `dist` folder and no config files in test patterns, so this is likely a non-issue. But verify by running tests after upgrade.

**Verdict:** Zero code changes expected. May need a minimal `vitest.config.ts` if default exclude changes cause test discovery issues (unlikely).

**Prerequisite:** Vitest v4 requires Vite >= 6.0.0 and Node.js >= 20.0.0. Node 22 LTS is used (satisfies). Vite is a transitive dependency of vitest (not directly installed), so the vitest upgrade will pull in the correct Vite version.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Biome config migration | Manual JSON editing | `biome migrate --write` | Handles schema, organizeImports relocation, glob changes |
| Zod codemod | Manual find-and-replace | Verify manually (codebase too small for codemod overhead) | Only 1 file uses zod |
| Vitest config | Preemptive config file | Run tests first, add config only if needed | Current zero-config works |

## Common Pitfalls

### Pitfall 1: Zod v4 Default Behavior in Optional Fields
**What goes wrong:** `z.string().default("x").optional()` now returns the default even when field is absent from input.
**Why it happens:** v4 always applies defaults, even in optional fields.
**How to avoid:** This project uses NO `.default()` or `.optional()` in the config schema. Non-issue.
**Warning signs:** Tests failing with unexpected default values.

### Pitfall 2: Biome v2 Glob Pattern Changes
**What goes wrong:** `biome check .` may match different files after upgrade if globs were configured.
**Why it happens:** v2 no longer prepends `**/` to globs; globs are relative to config file.
**How to avoid:** Current config has NO custom glob patterns. The `biome migrate --write` command handles migration.
**Warning signs:** Biome checking unexpected files or missing expected files.

### Pitfall 3: Biome v2 New Lint Rules
**What goes wrong:** `biome check .` may report new errors from rules that didn't exist in v1.
**Why it happens:** v2 adds 50+ new rules to the recommended set.
**How to avoid:** Run `biome check .` after migration, fix any new violations.
**Warning signs:** CI lint failures after upgrade.

### Pitfall 4: Vitest v4 Exclude Defaults
**What goes wrong:** Test discovery picks up unwanted files or misses expected files.
**Why it happens:** v4 default excludes only `node_modules` and `.git`, not `dist`, `cypress`, etc.
**How to avoid:** Verify test count matches before/after upgrade. Add explicit exclude if needed.
**Warning signs:** Different number of test files discovered.

### Pitfall 5: npm Peer Dependency Conflicts
**What goes wrong:** `npm install` fails with peer dependency conflicts between the three packages.
**Why it happens:** Intermediate state where one package is upgraded but not others.
**How to avoid:** Upgrade one at a time, verify each works before proceeding.
**Warning signs:** `ERESOLVE` errors during install.

## Code Examples

### Zod v4 -- No Changes Needed
```typescript
// config.ts stays exactly as-is
import { z } from "zod"; // works with zod@4.x
const configSchema = z.object({
  CHAIN_ID: z.coerce.number().int().positive(), // unchanged API
  RPC_URL: z.string().url(), // unchanged API
  // ...
});
export type Config = z.infer<typeof configSchema>; // unchanged API
```

### Biome v2 -- Expected Config After Migration
```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.9/schema.json",
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "lineWidth": 120
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  }
}
```

### Verification Commands
```bash
# After each upgrade, verify:
cd bot

# Zod: type-check + tests
npm run typecheck && npm test

# Vitest: run tests
npm test

# Biome: lint + format check
npm run lint
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `zod@3.x` default import | `zod@4.x` default import | 2025-06 (zod 4.0.0) | `import { z } from "zod"` now gives v4 API |
| `zod/v3` subpath for v3 | `zod@3.25.x` ships both v3 and v4 subpaths | 2025-05 | Incremental migration possible via subpaths |
| Biome `organizeImports` top-level | Biome `assist.actions.source.organizeImports` | 2025-Q1 (Biome 2.0) | Config restructuring |
| Vitest `poolOptions` nested | Vitest pool options at top level | 2025-Q2 (Vitest 4.0) | Config flattening (not relevant here) |

## Open Questions

1. **Biome v2 new lint violations**
   - What we know: v2 adds new recommended rules
   - What's unclear: How many new violations in this codebase
   - Recommendation: Run `biome check .` after migration, fix inline. Likely 0-3 issues given small codebase.

2. **zod@4.x package size**
   - What we know: v4 is a full rewrite, may affect bundle size
   - What's unclear: Exact size change
   - Recommendation: Not important for a Node.js bot (not browser-bundled). Ignore.

## Project Constraints (from CLAUDE.md)

- Git: Use `-c commit.gpgsign=false`, append `Co-Authored-By: Claude <noreply@anthropic.com>`
- Tooling: Foundry, viem, Biome.js, vitest (all confirmed in scope)
- No ethers.js, no dotenv, no hardhat, no axios
- Bot is stateless, one-shot -- dependency upgrade must not introduce persistent state

## Sources

### Primary (HIGH confidence)
- [zod v4 migration guide](https://zod.dev/v4/changelog) - Breaking changes, API differences
- [zod v4 versioning](https://zod.dev/v4/versioning) - Subpath export strategy
- [Biome v2 upgrade guide](https://biomejs.dev/guides/upgrade-to-biome-v2/) - Config migration, glob changes
- [Vitest v4 migration guide](https://vitest.dev/guide/migration.html) - Breaking changes, config changes

### Secondary (MEDIUM confidence)
- npm registry: verified current versions (zod 4.3.6, @biomejs/biome 2.4.9, vitest 4.1.2)
- Installed package inspection: confirmed zod 3.25.76 already ships v4 subpath

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Versions verified against npm registry
- Architecture: HIGH - All source files read, API surface fully catalogued
- Pitfalls: HIGH - Small codebase, all usage patterns verified against migration guides

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable libraries, 30 days)
