# anchor-idl-v0-to-v1 / v0.29 → v0.30

**Automatically migrate Anchor IDL JSON, Rust source, and TypeScript/JS files from Anchor v0.29 to v0.30 format (IDL v0 → v1 schema + Rust API + TypeScript SDK).**

Version: `0.1.16` | Published on the Codemod registry: [app.codemod.com/registry/anchor-idl-v0-to-v1](https://app.codemod.com/registry/anchor-idl-v0-to-v1)

Full write-up: [Built a bot that migrates Solana smart contract files automatically](https://medium.com/@varl99911/built-a-bot-that-migrates-solana-smart-contract-files-automatically-dea9415a83a7)

---

## What problem does this solve?

When Anchor (the Solana smart contract framework) released version 0.30, it changed the format of IDL files completely — and also changed the Rust and TypeScript APIs that go with them. IDL stands for Interface Definition Language. It is a JSON file that describes your smart contract.

The old format is called v0. The new format is called v1. They are not compatible. If you built your program before Anchor 0.30, your IDL files, Rust source, Cargo.toml, Anchor.toml, and TypeScript SDK files are all v0. All new Anchor tooling expects v1.

Doing this by hand for one program is already tedious. For a team managing ten or twenty programs it can take days and it is very easy to make mistakes.

This codemod does it automatically in seconds across all three layers — IDL JSON, Rust source, and TypeScript/JS.

---

## How to run it

You do not need to install anything. Just point it at your project:

```bash
npx codemod anchor-idl-v0-to-v1
```

It will migrate every eligible file in your project and skip files that are already up to date. Nothing gets changed twice.

---

## How it works — 3-node workflow, 26 rules total

The tool runs as a three-node workflow. Each node is a separate JavaScript module and handles a different layer of your codebase.

### Node 1 — IDL JSON migration (`migrate.mjs`, 12 rules)

Reads each IDL JSON file and applies all 12 documented transform rules mechanically. Deterministic — same input always gives same output.

**The 12 rules:**

1. Adds `metadata.spec = "0.1.0"` to mark the file as v1
2. Moves `name` and `version` into the `metadata` block
3. Adds the program `address` at the top level
4. Converts all instruction, account, and field names to `snake_case`
5. Adds 8-byte `discriminator` arrays to every instruction (SHA-256 of `"global:instruction_name"`)
6. Adds 8-byte `discriminator` arrays to every account (SHA-256 of `"account:AccountName"`)
7. Adds 8-byte `discriminator` arrays to every event (SHA-256 of `"event:EventName"`)
8. Rewrites `isMut`/`isSigner` on instruction accounts to `writable`/`signer`
9. Converts `publicKey` type to `pubkey`
10. Converts `{ "defined": "Name" }` to `{ "defined": { "name": "Name" } }`
11. Moves account type definitions and event structs into the top-level `types[]` array
12. Restructures PDA seeds to the new v1 seed format

Also deduplicates `types[]` automatically.

---

### Node 2 — Rust + Cargo.toml + Anchor.toml migration (`migrate-rust.mjs`, 8 rules)

Walks your Rust workspace and updates source files and config files.

**Rust rules (R1–R6):**

- **R1** — Replace `#[account(seeds = [...])]` PDA derivation with `#[account(seeds = [...], bump)]`
- **R2** — Replace `anchor_lang::solana_program::system_program::ID` with `System::id()`
- **R3** — Replace deprecated `declare_id!` macro usage patterns
- **R4** — Replace `emit!(event)` with `emit_cpi!(event)` where applicable
- **R5** — Replace `AnchorDeserialize` with `AnchorSerialize + AnchorDeserialize` on account structs
- **R6** — Add `resolver = "2"` to `[workspace]` in `Cargo.toml` if missing

**Anchor.toml rules (A1–A2):**

- **A1** — Add `idl-build` feature to `anchor-lang` and `anchor-spl` dependencies in `Cargo.toml` (handles inline table, bare string, and `workspace = true` variants)
- **A2** — Bump `anchor_version` in `Anchor.toml` to `"0.30.1"` (only if currently on `0.29.x` — never downgrades future versions)

---

### Node 3 — TypeScript/JS + package.json migration (`migrate-ts.mjs`, 6 rules)

Walks your TypeScript and JavaScript files and updates SDK usage.

**TypeScript rules (T1–T4):**

- **T1** — Replace `Program<Idl>` with the typed `Program<MyProgram>` constructor pattern
- **T2** — Replace `program.rpc.myInstruction(...)` with `program.methods.myInstruction(...).rpc()`
- **T3** — Flag `.associated()` and `.associatedAddress()` calls with a `TODO` comment (these were removed in Anchor 0.30 — requires manual replacement with `getAssociatedTokenAddressSync()`)
- **T4** — Update `program.account.myAccount.fetch(pubkey)` to use the new typed fetch API (skips commented-out lines)

**Package.json rules (P1–P2):**

- **P1** — Bump `@coral-xyz/anchor` (or `@project-serum/anchor`) to `^0.30.1`
- **P2** — Rename `@project-serum/anchor` to `@coral-xyz/anchor` throughout `package.json`

---

## Real-world validation

The codemod has been validated against real production codebases:

| Project | Scope | False positives |
|---|---|---|
| MetaDAO | 9 Anchor programs (Rust + Cargo.toml + Anchor.toml) | 0 |
| Drift v2 | ~250 TypeScript SDK files | 0 |
| Marinade Finance | Full IDL (28 instructions, 25 events, 22 types) | 0 |
| SPL Account Compression | Full IDL (10 instructions, 10 types) | 0 |
| SPL Managed Token | Full IDL (8 instructions) | 0 |

---

## The migration logic in detail

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
migrate.mjs             Node 1: IDL JSON migration library + CLI
migrate-rust.mjs        Node 2: Rust source + Cargo.toml + Anchor.toml migration
migrate-ts.mjs          Node 3: TypeScript/JS + package.json migration
scripts/codemod.ts      Codemod platform entry point (imports migrate.mjs)
scripts/codemod-rust.ts Codemod platform entry point for Rust node
scripts/codemod-ts.ts   Codemod platform entry point for TS node
codemod.yaml            Codemod registry metadata (name, version, description)
workflow.yaml           Three-node workflow definition
package.json            npm package config
test.mjs                200-test unit test suite
fetch-idls.mjs          Downloads real IDL fixtures from GitHub for testing
setup-fixtures.mjs      Script that generated the real-world test fixtures

.github/
  workflows/
    ci.yml              Runs node test.mjs on every push/PR to main
    publish.yml         Publishes to codemod.com on v* tags via CODEMOD_TOKEN secret

tests/
  basic-transform/      Synthetic v0 IDL covering all transform rules
  marinade-finance/     Real Marinade Finance v0 IDL (28 instrs, 25 events, 22 types)
  spl-account-compression/  Real SPL Account Compression v0 IDL
  spl-managed-token/    Real SPL Managed Token v0 IDL
  real-world-codemod-test/  MetaDAO + Drift v2 real-world fixtures (Rust + TS)
  real-world-output/    Pre-generated v1 outputs for reference
```

---

## Test results

```
200 passed, 0 failed
```

The test suite (`test.mjs`) covers all three migration nodes:

**IDL JSON (Node 1):**
- All 12 transform rules individually
- Correct discriminator values (verified against known on-chain values)
- snake_case conversion edge cases (acronyms, already-snake names, camelCase)
- Type conversion for all type shapes including nested generics
- PDA seed conversion for const / arg / account seed kinds
- Composite account groups (nested `accounts[]` arrays)
- Enum variants with named and tuple fields
- Docs preservation through all transform paths
- Event struct conversion with correct field handling
- Account type merging into `types[]` with deduplication
- File round-trip: read → migrate → atomic write → re-read → validate
- Skip guard: files already in v1 are left unchanged
- Address override via CLI flag; invalid base58 rejected
- `isV1Idl()` detection function

**Rust (Node 2):**
- All R1–R6 and A1–A2 rules
- Cargo.toml dep variants: inline table, bare string, `workspace = true`
- Anchor.toml version bump (only 0.29.x → 0.30.1, not future versions)
- Symlink loop prevention; atomic writes

**TypeScript (Node 3):**
- All T1–T4 and P1–P2 rules
- Comment-line skipping in T3/T4
- package.json rename + version bump
- Symlink protection; broken-symlink crash prevention

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

You can also pass a program address override:

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

# Override the program address (validated as base58)
node migrate.mjs old.json new.json --address So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo
```

---

## Security

This project has undergone a full security audit (13 findings, all fixed in v0.1.16):

- **Symlink attack prevention** — `migrateDirectory` and `walkTs` use `lstatSync` + `realpathSync` with a visited-set to detect and skip symlink loops. Writes through symlinks are refused.
- **Atomic file writes** — All writes use a write-to-temp + `renameSync` pattern. No partial writes on crash or interrupt.
- **SSRF protection** — `fetch-idls.mjs` validates that redirect `Location` headers begin with `https://` before following.
- **Input validation** — `--address` CLI flag is validated against a base58 regex before use. Missing program addresses produce a warning with a `PLACEHOLDER_PROGRAM_ADDRESS` marker instead of silently falling back to the system program.
- **Unbounded recursion guard** — `convertType` throws if recursion depth exceeds 100.
- **Comment safety** — `fixProgramConstructor` and `flagAssociatedMethods` skip lines starting with `//` or `*` to avoid transforming comments.
- **Supply chain security** — Publishing is secured via GitHub Actions with pinned action SHAs and a `CODEMOD_TOKEN` repository secret. Never publish from a local machine with live credentials. See `.github/workflows/publish.yml`.

---

## Background — why this was built

This project was built for the [Boring AI hackathon on DoraHacks](https://dorahacks.io/hackathon/boring-ai/buidl).

The hackathon's theme is "boring AI" — practical automation tools that solve real developer pain. Not flashy demos. Not chatbots. Just tools that save developers real time on real work.

Anchor IDL v0 to v1 migration is exactly that kind of problem. It is tedious, mechanical, and error-prone when done by hand. The migration is item #6 on the hackathon's pre-approved codemod list, which confirms it is a known pain point in the Solana ecosystem.

A full write-up of how it was built, including real-world test results, is published here:
[Built a bot that migrates Solana smart contract files automatically](https://medium.com/@varl99911/built-a-bot-that-migrates-solana-smart-contract-files-automatically-dea9415a83a7)

---

## Technical decisions

**Why a separate `migrate.mjs` instead of putting everything in `scripts/codemod.ts`?**

The Codemod platform compiles `scripts/codemod.ts` with Rolldown. During development, the codemod entry point had its own full copy of the migration logic. This led to bugs where the two copies diverged. The fix was to make `scripts/codemod.ts` import from `migrate.mjs` directly. Single source of truth.

**Why not use an npm package for snake_case conversion?**

The Rust `heck` crate has specific behaviour for consecutive uppercase letters (e.g. `HTMLParser → html_parser`) that differs from most JavaScript libraries. Replicating the exact 4-line implementation was safer and simpler.

**Why SHA-256 from Node.js `crypto` instead of a separate library?**

`crypto` is built into Node.js. No install, no supply chain risk, no version conflicts.

**Why three separate migration nodes?**

Each layer (IDL JSON, Rust source, TypeScript/JS) has a completely different file format and transformation logic. Keeping them in separate modules means each can be tested, published, and run independently. The three-node workflow composes them in sequence.

---

## License

MIT
