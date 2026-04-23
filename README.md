# anchor-idl-v0-to-v1

**Automatically migrate Anchor IDL JSON files from v0 format to v1 format.**

Published on the Codemod registry: [app.codemod.com/registry/anchor-idl-v0-to-v1](https://app.codemod.com/registry/anchor-idl-v0-to-v1)

---

## What problem does this solve?

When Anchor (the Solana smart contract framework) released version 0.30, it changed the format of IDL files completely. IDL stands for Interface Definition Language. It is a JSON file that describes your smart contract — what instructions it has, what accounts it uses, what types it defines.

The old format is called v0. The new format is called v1. They are not compatible. If you built your program before Anchor 0.30, your IDL files are v0. All the new Anchor tooling expects v1.

The difference is not just a few renamed fields. The entire schema changed:

- Instruction and account names must be in `snake_case` (Anchor v1 uses Rust's naming rules)
- Every instruction now needs an 8-byte `discriminator` (a hash that identifies it on-chain)
- Every account and event also needs its own `discriminator`
- The top-level `name` and `version` fields move inside a `metadata` block
- The program address must be at the top level as `address`
- The `accounts[]` array inside instructions changed structure
- Type references like `{ "defined": "MyType" }` became `{ "defined": { "name": "MyType" } }`
- `publicKey` as a type becomes `pubkey`
- The `events[]` array no longer holds struct definitions — events now live in `types[]`
- PDA seeds have a new structure
- `isMut` and `isSigner` on accounts become `writable` and `signer`

Doing all of this by hand for one program is already tedious. For a team managing ten or twenty programs it can take days and it is very easy to make mistakes.

This codemod does it automatically in seconds.

---

## How to run it

You do not need to install anything. Just point it at your project:

```bash
npx codemod anchor-idl-v0-to-v1
```

It will find every IDL JSON file in your project (in `target/idl/`, `idl/`, `src/idl/`, `src/artifacts/`, and `artifacts/` folders), check if it is a v0 file, and rewrite it in place as v1.

Files that are already v1 are skipped automatically. Nothing gets changed twice.

---

## How it works

The tool is built on the [Codemod platform](https://codemod.com). It runs as a two-step workflow:

### Step 1 — Deterministic migration

A JavaScript module (`migrate.mjs`) reads each JSON file and applies all 12 documented transform rules mechanically. This step handles everything that has a known, fixed answer. It is deterministic — same input always gives same output, with no guessing.

The 12 rules it applies:

1. Adds `metadata.spec = "0.1.0"` to mark the file as v1
2. Moves `name` and `version` into the `metadata` block
3. Adds the program `address` at the top level
4. Converts all instruction, account, and field names to `snake_case`
5. Adds 8-byte `discriminator` arrays to every instruction (via SHA-256 of `"global:instruction_name"`)
6. Adds 8-byte `discriminator` arrays to every account (via SHA-256 of `"account:AccountName"`)
7. Adds 8-byte `discriminator` arrays to every event (via SHA-256 of `"event:EventName"`)
8. Rewrites `isMut`/`isSigner` on instruction accounts to `writable`/`signer`
9. Converts `publicKey` type to `pubkey`
10. Converts `{ "defined": "Name" }` to `{ "defined": { "name": "Name" } }`
11. Moves account type definitions and event structs into the top-level `types[]` array
12. Restructures PDA seeds to the new v1 seed format

It also deduplicates `types[]` — if an account name already exists in `types[]`, the duplicate is dropped automatically.

### Step 2 — AI cleanup (optional)

An AI step using GPT-4o reviews the output and handles the remaining ~10% of edge cases that require judgment. Things like unusual type combinations, programs built before Anchor 0.26 where discriminator hashing may differ, or custom metadata fields that need preserving.

The AI step is skipped if no `LLM_API_KEY` is set, which is fine for the vast majority of programs.

---

## The migration logic in detail

The core logic lives entirely in `migrate.mjs`. This file is both a CLI tool and an importable library.

### Discriminator generation

Anchor generates discriminators using SHA-256:

```
instruction discriminator = sha256("global:" + snake_case_name)[0..8]
account discriminator     = sha256("account:" + AccountName)[0..8]
event discriminator       = sha256("event:"   + EventName)[0..8]
```

The first 8 bytes of the hash become the discriminator array. This codemod replicates that exact calculation using Node.js's built-in `crypto` module.

### snake_case conversion

Anchor uses the Rust `heck` crate's `to_snake_case()` function internally. This codemod mirrors that exact behaviour:

```
addLiquidity             → add_liquidity
openPositionWithMetadata → open_position_with_metadata
HTMLParser               → html_parser
systemProgram            → system_program
already_snake            → already_snake  (unchanged)
```

### Type conversion

Every type reference in args, fields, and return values is recursively converted:

| v0 | v1 |
|---|---|
| `"publicKey"` | `"pubkey"` |
| `{ "defined": "Foo" }` | `{ "defined": { "name": "Foo" } }` |
| `{ "option": "publicKey" }` | `{ "option": "pubkey" }` |
| `{ "vec": { "defined": "Foo" } }` | `{ "vec": { "defined": { "name": "Foo" } } }` |
| `{ "definedWithTypeArgs": { "name": "Foo", "args": [...] } }` | `{ "defined": { "name": "Foo", "generics": [...] } }` |
| `{ "alias": <type> }` (kind=alias) | `{ "kind": "type", "alias": <type> }` |

---

## Files in this repo

```
migrate.mjs            Core migration library + CLI entry point
scripts/codemod.ts     Codemod platform entry point (imports migrate.mjs)
codemod.yaml           Codemod registry metadata (name, version, description)
workflow.yaml          Two-step workflow definition (JSSG + AI)
package.json           npm package config
test.mjs               74-test unit test suite
setup-fixtures.mjs     Script that generated the real-world test fixtures

tests/
  basic-transform/
    input.json         Synthetic v0 IDL covering all transform rules
    expected.json      Expected v1 output (byte-exact match)

  marinade-finance/
    input.json         Real Marinade Finance v0 IDL (28 instrs, 25 events, 22 types, 2 accounts)
    expected.json      Expected v1 output (49 types after merging)

  spl-account-compression/
    input.json         Real SPL Account Compression v0 IDL (10 instrs, 10 types)
    expected.json      Expected v1 output

  spl-managed-token/
    input.json         Real SPL Managed Token v0 IDL (8 instrs)
    expected.json      Expected v1 output

  real-world-output/   Pre-generated v1 outputs for reference
  validate-real-world.mjs  Validation script that checks all v1 outputs
```

---

## Test results

```
74 passed, 0 failed
```

The test suite (`test.mjs`) covers:

- All 12 transform rules individually
- Correct discriminator values (verified against known on-chain values)
- snake_case conversion edge cases (acronyms, already-snake names, camelCase)
- Type conversion for all type shapes including nested generics
- PDA seed conversion for const / arg / account seed kinds
- Composite account groups (nested `accounts[]` arrays)
- Enum variants with named and tuple fields
- Docs preservation through all transform paths
- Event struct conversion with correct field handling
- Account type merging into `types[]`
- Deduplication when account names overlap with `types[]`
- File round-trip (read file → migrate → write file → re-read → validate)
- Skip guard: files already in v1 format are left unchanged
- Address override via CLI flag
- `isV1Idl()` detection function

All four real-world fixtures produce byte-exact matches against their expected output.

---

## Running the tests locally

```bash
git clone https://github.com/Jennivarl/anchor-idl-migrator
cd anchor-idl-migrator
node test.mjs
```

No dependencies to install. Everything runs on plain Node.js (v18+).

---

## Using it as a library

`migrate.mjs` exports two functions you can use directly in your own scripts:

```js
import { migrateIdl, isV1Idl } from './migrate.mjs'

const v0 = JSON.parse(fs.readFileSync('my_program.json', 'utf-8'))

if (!isV1Idl(v0)) {
  const v1 = migrateIdl(v0)
  fs.writeFileSync('my_program.json', JSON.stringify(v1, null, 2) + '\n')
}
```

You can also pass a program address override as the second argument:

```js
const v1 = migrateIdl(v0, 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo')
```

---

## Using it as a CLI tool

```bash
# Print v1 IDL to stdout
node migrate.mjs target/idl/my_program.json

# Write v1 IDL to a new file
node migrate.mjs target/idl/my_program.json target/idl/my_program_v1.json

# Override the program address
node migrate.mjs old.json new.json --address So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo
```

---

## Background — why this was built

This project was built for the [Boring AI hackathon on DoraHacks](https://dorahacks.io/hackathon/boring-ai/buidl).

The hackathon's theme is "boring AI" — practical automation tools that solve real developer pain. Not flashy demos. Not chatbots. Just tools that save developers real time on real work.

Anchor IDL v0 to v1 migration is exactly that kind of problem. It is tedious, mechanical, and error-prone when done by hand. It is the kind of work that a codemod should do.

The migration is item #6 on the hackathon's pre-approved codemod list, which confirms it is a known pain point in the Solana ecosystem.

A full write-up of how it was built, including real-world test results, is published here:
[Built a bot that migrates Solana smart contract files automatically](https://medium.com/@varl99911/built-a-bot-that-migrates-solana-smart-contract-files-automatically-dea9415a83a7)

---

## Technical decisions

**Why a separate `migrate.mjs` instead of putting everything in `scripts/codemod.ts`?**

The Codemod platform compiles `scripts/codemod.ts` with Rolldown, a bundler. During development, the codemod entry point had its own full copy of the migration logic. This led to two bugs: the codemod version was deduplicating types but the standalone library was not, and the codemod version was preserving event `docs` but the library was dropping them.

The fix was to make `scripts/codemod.ts` import from `migrate.mjs` directly. Single source of truth. Now both paths are identical.

**Why not use an npm package for snake_case conversion?**

The Rust `heck` crate has specific behaviour for consecutive uppercase letters (e.g. `HTMLParser → html_parser`) that differs from most JavaScript libraries. Replicating the exact 4-line implementation was safer and simpler than finding and auditing a third-party package.

**Why SHA-256 from Node.js `crypto` instead of a separate library?**

`crypto` is built into Node.js. No install, no supply chain risk, no version conflicts.

---

## License

MIT
