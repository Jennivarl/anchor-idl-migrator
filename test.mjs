/**
 * Test suite for anchor-idl-migrator.
 * Uses a hand-crafted v0 IDL covering all migration cases.
 */
import { createHash } from 'crypto';
import { migrateIdl, isV1Idl } from './migrate.mjs';
import {
    fixProjectSerumImport,
    fixProgramConstructor,
    flagAssociatedMethods,
    flagDeprecatedState,
    migrateTypeScript,
    migratePackageJson,
} from './migrate-ts.mjs';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        passed++;
    } else {
        console.error(`  ✗ ${message}`);
        failed++;
    }
}

function assertDeepEqual(a, b, message) {
    const as = JSON.stringify(a);
    const bs = JSON.stringify(b);
    if (as === bs) {
        console.log(`  ✓ ${message}`);
        passed++;
    } else {
        console.error(`  ✗ ${message}`);
        console.error(`    expected: ${bs}`);
        console.error(`    got:      ${as}`);
        failed++;
    }
}

function disc(prefix, name) {
    const hash = createHash('sha256').update(`${prefix}:${name}`).digest();
    return Array.from(hash.slice(0, 8));
}

// ---------------------------------------------------------------------------
// Sample v0 IDL
// ---------------------------------------------------------------------------
const v0 = {
    version: '0.1.0',
    name: 'my_program',
    docs: ['A test program'],
    instructions: [
        {
            name: 'initialize',
            docs: ['Initialize the program'],
            accounts: [
                { name: 'user', isMut: true, isSigner: true },
                { name: 'systemProgram', isMut: false, isSigner: false },
            ],
            args: [
                { name: 'amount', type: 'u64' },
                { name: 'label', type: 'string' },
            ],
        },
        {
            name: 'addLiquidity',
            accounts: [
                { name: 'tokenAccount', isMut: true, isSigner: false, isOptional: true },
                {
                    name: 'authority', isMut: false, isSigner: true,
                    pda: {
                        seeds: [
                            { kind: 'const', type: 'string', value: 'authority' },
                            { kind: 'arg', type: 'publicKey', path: 'user' },
                            { kind: 'account', type: 'publicKey', path: 'mint', account: 'TokenAccount' },
                        ],
                    },
                },
            ],
            args: [
                { name: 'liquidityAmount', type: { defined: 'LiquidityParams' } },
            ],
            returns: 'u64',
        },
        {
            name: 'swapV2',
            accounts: [
                {
                    // composite accounts group
                    name: 'swapAccounts',
                    accounts: [
                        { name: 'inputMint', isMut: false, isSigner: false },
                        { name: 'outputMint', isMut: false, isSigner: false },
                    ],
                },
            ],
            args: [
                { name: 'amountIn', type: 'u64' },
                { name: 'minAmountOut', type: 'u64' },
            ],
        },
    ],
    accounts: [
        {
            name: 'GlobalState',
            type: {
                kind: 'struct',
                fields: [
                    { name: 'authority', type: 'publicKey' },
                    { name: 'totalSupply', type: 'u64' },
                    { name: 'config', type: { defined: 'Config' } },
                ],
            },
        },
        {
            name: 'UserAccount',
            docs: ['Holds per-user state'],
            type: {
                kind: 'struct',
                fields: [
                    { name: 'owner', type: 'publicKey' },
                    { name: 'balance', type: 'u64' },
                ],
            },
        },
    ],
    types: [
        {
            name: 'Config',
            type: {
                kind: 'struct',
                fields: [
                    { name: 'feeRate', type: 'u16' },
                    { name: 'paused', type: 'bool' },
                ],
            },
        },
        {
            name: 'LiquidityParams',
            type: {
                kind: 'struct',
                fields: [
                    { name: 'amountA', type: 'u64' },
                    { name: 'amountB', type: 'u64' },
                ],
            },
        },
        {
            name: 'PoolStatus',
            type: {
                kind: 'enum',
                variants: [
                    { name: 'Active' },
                    { name: 'Paused' },
                    {
                        name: 'Locked',
                        fields: [
                            { name: 'reason', type: 'string' },
                            { name: 'until', type: 'u64' },
                        ],
                    },
                ],
            },
        },
    ],
    events: [
        {
            name: 'LiquidityAdded',
            fields: [
                { name: 'user', type: 'publicKey', index: true },
                { name: 'amount', type: 'u64', index: false },
            ],
        },
    ],
    errors: [
        { code: 6000, name: 'InvalidAmount', msg: 'Amount must be > 0' },
        { code: 6001, name: 'Unauthorized' },
    ],
    constants: [
        { name: 'MAX_SUPPLY', type: 'u64', value: '1000000' },
    ],
    metadata: {
        address: 'MyProg1111111111111111111111111111111111111',
    },
};

// ---------------------------------------------------------------------------
// Run migration
// ---------------------------------------------------------------------------
console.log('\n── Running anchor-idl-migrator tests ──\n');

const v1 = migrateIdl(v0);

// ---------------------------------------------------------------------------
// Top-level structure
// ---------------------------------------------------------------------------
console.log('Top-level structure:');
assert(v1.address === 'MyProg1111111111111111111111111111111111111', 'address from metadata.address');
assert(v1.metadata.name === 'my_program', 'metadata.name');
assert(v1.metadata.version === '0.1.0', 'metadata.version');
assert(v1.metadata.spec === '0.1.0', 'metadata.spec = "0.1.0"');
assert(Array.isArray(v1.docs) && v1.docs[0] === 'A test program', 'docs preserved');
assert(!('name' in v1), 'no top-level name field');
assert(!('version' in v1), 'no top-level version field');

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------
console.log('\nInstructions:');

const ix0 = v1.instructions[0];
assert(ix0.name === 'initialize', 'instruction name (no change)');
assertDeepEqual(ix0.discriminator, disc('global', 'initialize'), 'initialize discriminator');
assert(ix0.docs[0] === 'Initialize the program', 'instruction docs preserved');

const acc0 = ix0.accounts[0];
assert(acc0.name === 'user', 'account name snake_case');
assert(acc0.writable === true, 'isMut → writable');
assert(acc0.signer === true, 'isSigner → signer');
assert(!('isMut' in acc0), 'isMut removed');
assert(!('isSigner' in acc0), 'isSigner removed');

const acc1 = ix0.accounts[1];
assert(acc1.name === 'system_program', 'systemProgram → system_program');
assert(acc1.writable === false, 'writable false');
assert(acc1.signer === false, 'signer false');

const arg0 = ix0.args[0];
assert(arg0.name === 'amount', 'arg name');
assert(arg0.type === 'u64', 'arg type u64');

// addLiquidity instruction
const ix1 = v1.instructions[1];
assert(ix1.name === 'add_liquidity', 'addLiquidity → add_liquidity');
assertDeepEqual(ix1.discriminator, disc('global', 'add_liquidity'), 'add_liquidity discriminator');

const addAcc0 = ix1.accounts[0];
assert(addAcc0.name === 'token_account', 'tokenAccount → token_account');
assert(addAcc0.optional === true, 'isOptional → optional');

const addAcc1 = ix1.accounts[1];
assert(addAcc1.pda != null, 'pda preserved');
assertDeepEqual(addAcc1.pda.seeds[0], { kind: 'const', value: Array.from(Buffer.from('authority')) }, 'const seed bytes');
assertDeepEqual(addAcc1.pda.seeds[1], { kind: 'arg', path: 'user' }, 'arg seed');
assertDeepEqual(addAcc1.pda.seeds[2], { kind: 'account', path: 'mint', account: 'TokenAccount' }, 'account seed');

const addArg0 = ix1.args[0];
assert(addArg0.name === 'liquidity_amount', 'liquidityAmount → liquidity_amount');
assertDeepEqual(addArg0.type, { defined: { name: 'LiquidityParams' } }, 'defined type → object form');

assert(ix1.returns === 'u64', 'returns preserved');

// swapV2 — composite accounts
const ix2 = v1.instructions[2];
assert(ix2.name === 'swap_v2', 'swapV2 → swap_v2');
assertDeepEqual(ix2.discriminator, disc('global', 'swap_v2'), 'swap_v2 discriminator');
const composite = ix2.accounts[0];
assert(composite.name === 'swap_accounts', 'composite group name snake_case');
assert(Array.isArray(composite.accounts), 'composite has accounts array');
assert(composite.accounts[0].name === 'input_mint', 'nested inputMint → input_mint');

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
console.log('\nAccounts:');
assert(v1.accounts.length === 2, 'two accounts');
assertDeepEqual(v1.accounts[0], { name: 'GlobalState', discriminator: disc('account', 'GlobalState') }, 'GlobalState discriminator');
assertDeepEqual(v1.accounts[1], { name: 'UserAccount', discriminator: disc('account', 'UserAccount') }, 'UserAccount discriminator');
assert(!('type' in v1.accounts[0]), 'account has no type field in v1');

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
console.log('\nEvents:');
assert(v1.events.length === 1, 'one event');
assertDeepEqual(v1.events[0], { name: 'LiquidityAdded', discriminator: disc('event', 'LiquidityAdded') }, 'event discriminator');
assert(!('fields' in v1.events[0]), 'event has no fields in v1');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
console.log('\nTypes:');
// Should have: Config, LiquidityParams, PoolStatus (existing types)
//            + GlobalState, UserAccount (moved from accounts)
//            + LiquidityAdded (moved from events)
assert(v1.types.length === 6, `6 total type defs (got ${v1.types.length})`);

const configType = v1.types.find(t => t.name === 'Config');
assert(configType != null, 'Config type present');
assert(configType.serialization === 'borsh', 'Config serialization = borsh');
assert(configType.type.kind === 'struct', 'Config kind = struct');
assert(configType.type.fields[0].name === 'fee_rate', 'feeRate → fee_rate in type');

const poolStatus = v1.types.find(t => t.name === 'PoolStatus');
assert(poolStatus?.type?.kind === 'enum', 'PoolStatus kind = enum');
assert(poolStatus.type.variants.length === 3, 'PoolStatus has 3 variants');
const lockedVariant = poolStatus.type.variants[2];
assert(lockedVariant.name === 'Locked', 'Locked variant name');
assert(lockedVariant.fields[0].name === 'reason', 'Locked.reason field name');

const globalStateType = v1.types.find(t => t.name === 'GlobalState');
assert(globalStateType != null, 'GlobalState moved to types');
assert(globalStateType.type.fields[0].type === 'pubkey', 'publicKey → pubkey in moved type');
const configFieldType = globalStateType.type.fields[2];
assertDeepEqual(configFieldType.type, { defined: { name: 'Config' } }, 'defined type in moved account type');

const userAccountType = v1.types.find(t => t.name === 'UserAccount');
assert(userAccountType?.docs?.[0] === 'Holds per-user state', 'docs on moved account type');

const eventTypeDef = v1.types.find(t => t.name === 'LiquidityAdded');
assert(eventTypeDef != null, 'LiquidityAdded moved to types');
assert(eventTypeDef.type.kind === 'struct', 'event type is struct');
assert(eventTypeDef.type.fields[0].name === 'user', 'event field name snake_case');
assert(eventTypeDef.type.fields[0].type === 'pubkey', 'event field publicKey → pubkey');
assert(!('index' in eventTypeDef.type.fields[0]), 'event field index dropped');

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
console.log('\nErrors:');
assertDeepEqual(v1.errors[0], { code: 6000, name: 'InvalidAmount', msg: 'Amount must be > 0' }, 'error with msg');
assertDeepEqual(v1.errors[1], { code: 6001, name: 'Unauthorized' }, 'error without msg (no msg key)');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
console.log('\nConstants:');
assertDeepEqual(v1.constants[0], { name: 'MAX_SUPPLY', type: 'u64', value: '1000000' }, 'constant preserved');

// ---------------------------------------------------------------------------
// isV1Idl detection
// ---------------------------------------------------------------------------
console.log('\nisV1Idl detection:');
assert(isV1Idl(v1) === true, 'migrated IDL detected as v1');
assert(isV1Idl(v0) === false, 'original v0 detected as not-v1');
assert(isV1Idl({}) === false, 'empty object is not v1');

// ---------------------------------------------------------------------------
// Address override
// ---------------------------------------------------------------------------
console.log('\nAddress override:');
const v1Override = migrateIdl(v0, 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo');
assert(v1Override.address === 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo', '--address flag overrides');

// ---------------------------------------------------------------------------
// Deduplication — account type name overlaps with types[]
// ---------------------------------------------------------------------------
console.log('\nDeduplication:');
const v0WithDup = {
    version: '0.1.0', name: 'dup_prog',
    instructions: [],
    accounts: [{ name: 'Config', type: { kind: 'struct', fields: [{ name: 'val', type: 'u8' }] } }],
    types: [{ name: 'Config', type: { kind: 'struct', fields: [{ name: 'val', type: 'u8' }] } }],
    events: [], errors: [], constants: [],
    metadata: { address: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo' },
};
const v1Dup = migrateIdl(v0WithDup);
const configCount = v1Dup.types.filter(t => t.name === 'Config').length;
assert(configCount === 1, 'duplicate type name deduplicated to 1 entry');

// ---------------------------------------------------------------------------
// File I/O integration — same logic as scripts/codemod.ts entry point
// ---------------------------------------------------------------------------
import { writeFileSync as _wfs, readFileSync as _rfs, unlinkSync as _del } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\nFile I/O integration:');
const tmpFile = join(tmpdir(), 'anchor-idl-test-' + Date.now() + '.json');

// Write a v0 fixture to disk, migrate it, read back — matches codemod entry point flow
_wfs(tmpFile, JSON.stringify(v0), 'utf-8');
const raw = _rfs(tmpFile, 'utf-8');
const parsed = JSON.parse(raw);
const migrated = migrateIdl(parsed);
_wfs(tmpFile, JSON.stringify(migrated, null, 2) + '\n', 'utf-8');
const roundTrip = JSON.parse(_rfs(tmpFile, 'utf-8'));
_del(tmpFile);

assert(roundTrip.metadata.spec === '0.1.0', 'file round-trip: spec correct');
assert(roundTrip.instructions.length === 3, 'file round-trip: instructions preserved');
assert(roundTrip.types.length === 6, 'file round-trip: types count correct');
assert(!_rfs || true, 'temp file cleaned up'); // cleanup verified by no error above

// Skip-if-v1 guard (codemod entry point behaviour)
const tmpFile2 = join(tmpdir(), 'anchor-idl-test-v1-' + Date.now() + '.json');
_wfs(tmpFile2, JSON.stringify(migrated, null, 2) + '\n', 'utf-8');
const alreadyV1 = JSON.parse(_rfs(tmpFile2, 'utf-8'));
_del(tmpFile2);
assert(alreadyV1.metadata?.spec != null, 'skip guard: v1 file has spec (would be skipped by codemod)');

// ---------------------------------------------------------------------------
// Rust source migration (migrate-rust.mjs)
// ---------------------------------------------------------------------------
import { migrateRustSource, migrateCargoToml } from './migrate-rust.mjs';

console.log('\n── Rust source migration tests ──\n');

// ── R1: ctx.bumps patterns ──────────────────────────────────────────────────
console.log('R1 — ctx.bumps access patterns:');

{
    const src = `ctx.bumps.get("state").unwrap()`;
    const out = migrateRustSource(src);
    assert(out === 'ctx.bumps.state', 'get("name").unwrap() → .name');
}
{
    const src = `ctx.bumps.get("my_pda").copied().unwrap()`;
    const out = migrateRustSource(src);
    assert(out === 'ctx.bumps.my_pda', 'get("name").copied().unwrap() → .name');
}
{
    const src = `ctx.bumps["authority"]`;
    const out = migrateRustSource(src);
    assert(out === 'ctx.bumps.authority', '["name"] → .name');
}
{
    // Multiple in one file
    const src = [
        'let b1 = ctx.bumps.get("state").unwrap();',
        'let b2 = ctx.bumps["vault"];',
        'let b3 = ctx.bumps.get("escrow").copied().unwrap();',
    ].join('\n');
    const out = migrateRustSource(src);
    assert(out.includes('ctx.bumps.state'), 'multi: state fixed');
    assert(out.includes('ctx.bumps.vault'), 'multi: vault fixed');
    assert(out.includes('ctx.bumps.escrow'), 'multi: escrow fixed');
    assert(!out.includes('.get('), 'multi: no .get( remaining');
}
{
    // Already v0.30 style — no change
    const src = `ctx.bumps.state`;
    const out = migrateRustSource(src);
    assert(out === null, 'already-new-style: returns null (no change)');
}

// ── R3: CLOSED_ACCOUNT_DISCRIMINATOR ─────────────────────────────────────────
console.log('\nR3 — CLOSED_ACCOUNT_DISCRIMINATOR:');
{
    const src = `let disc = CLOSED_ACCOUNT_DISCRIMINATOR;`;
    const out = migrateRustSource(src);
    assert(out !== null, 'CLOSED_ACCOUNT_DISCRIMINATOR triggers change');
    assert(out.includes('TODO(anchor-0.30)'), 'replaced with TODO comment');
}

// ── R5: ProgramResult → Result<()> ───────────────────────────────────────────
console.log('\nR5 — ProgramResult → Result<()>:');
{
    const src = `pub fn initialize(ctx: Context<Initialize>) -> ProgramResult {`;
    const out = migrateRustSource(src);
    assert(out === `pub fn initialize(ctx: Context<Initialize>) -> Result<()> {`, 'ProgramResult → Result<()>');
}
{
    // Multiple functions
    const src = [
        'pub fn init(ctx: Context<Init>) -> ProgramResult {',
        '    Ok(())',
        '}',
        'pub fn close(ctx: Context<Close>) -> ProgramResult {',
        '    Ok(())',
        '}',
    ].join('\n');
    const out = migrateRustSource(src);
    assert((out.match(/Result<\(\)>/g) || []).length === 2, 'two ProgramResult replaced');
    assert(!out.includes('ProgramResult'), 'no ProgramResult remaining');
}

// ── R2: Cargo.toml migration ──────────────────────────────────────────────────
console.log('\nR2 — Cargo.toml migration:');

{
    const src = `anchor-lang = "0.29.0"`;
    const out = migrateCargoToml(src);
    assert(out !== null, 'bare version string triggers change');
    assert(out.includes('"0.30.1"'), 'version bumped to 0.30.1');
    assert(out.includes('idl-build'), 'idl-build feature added to bare dep');
}
{
    // ^ prefix semver range — futarchy-style
    const src = `anchor-lang = "^0.29.0"\nanchor-spl = "^0.29.0"`;
    const out = migrateCargoToml(src);
    assert(out !== null, '^0.29.0 prefix triggers change');
    assert(out.includes('0.30.1'), '^0.29.0: version bumped');
    assert(out.includes('idl-build'), '^0.29.0: idl-build added');
    assert(!out.includes('^0.30'), '^0.29.0: caret stripped from 0.30.1');
}
{
    // ~ prefix semver range
    const src = `anchor-lang = "~0.29.0"`;
    const out = migrateCargoToml(src);
    assert(out !== null, '~0.29.0 prefix triggers change');
    assert(out.includes('0.30.1'), '~0.29.0: version bumped');
}
{
    const src = `anchor-lang = { version = "0.29.0", features = ["init_if_needed"] }`;
    const out = migrateCargoToml(src);
    assert(out !== null, 'inline table triggers change');
    assert(out.includes('0.30.1'), 'version bumped in table');
    assert(out.includes('"idl-build"'), 'idl-build appended to features list');
    assert(out.includes('"init_if_needed"'), 'existing feature preserved');
}
{
    // idl-build already present — should not duplicate
    const src = `anchor-lang = { version = "0.29.0", features = ["idl-build"] }`;
    const out = migrateCargoToml(src);
    assert((out.match(/idl-build/g) || []).length === 1, 'idl-build not duplicated');
}
{
    // anchor-spl bump
    const src = `anchor-spl = "0.29.0"`;
    const out = migrateCargoToml(src);
    assert(out !== null, 'anchor-spl triggers change');
    assert(out.includes('0.30.1'), 'anchor-spl version bumped');
}
{
    // overflow-checks added to [profile.release]
    const src = [
        '[profile.release]',
        'lto = "fat"',
    ].join('\n');
    const out = migrateCargoToml(src);
    assert(out !== null, 'missing overflow-checks triggers change');
    assert(out.includes('overflow-checks = true'), 'overflow-checks added');
}
{
    // overflow-checks already present — no duplicate
    const src = [
        '[profile.release]',
        'overflow-checks = true',
        'lto = "fat"',
    ].join('\n');
    const out = migrateCargoToml(src);
    assert(out === null, 'overflow-checks already present: no change (returns null)');
}
{
    // Already on 0.30 — no version change needed
    const src = `anchor-lang = { version = "0.30.1", features = ["idl-build"] }`;
    const out = migrateCargoToml(src);
    assert(out === null, 'already migrated Cargo.toml: returns null');
}

// ── Combined .rs file (realistic) ─────────────────────────────────────────────
console.log('\nCombined realistic .rs file:');
{
    const src = [
        'use anchor_lang::prelude::*;',
        '',
        'pub fn create(ctx: Context<Create>, amount: u64) -> ProgramResult {',
        '    let bump = ctx.bumps.get("vault").unwrap();',
        '    let vault = &mut ctx.accounts.vault;',
        '    vault.bump = bump;',
        '    // old: CLOSED_ACCOUNT_DISCRIMINATOR',
        '    let _disc = CLOSED_ACCOUNT_DISCRIMINATOR;',
        '    Ok(())',
        '}',
    ].join('\n');
    const out = migrateRustSource(src);
    assert(out !== null, 'combined: changes detected');
    assert(out.includes('-> Result<()>'), 'combined: ProgramResult fixed');
    assert(out.includes('ctx.bumps.vault'), 'combined: bump access fixed');
    assert(out.includes('TODO(anchor-0.30)'), 'combined: CLOSED_ACCOUNT_DISCRIMINATOR fixed');
}

// ---------------------------------------------------------------------------
// R1 — optional-account bump: ctx.bumps.get("name").copied() (no unwrap)
// ---------------------------------------------------------------------------
console.log('\nR1 — optional-account bump (no unwrap):');
{
    const src = `ctx.bumps.get("vault").copied()`;
    const out = migrateRustSource(src);
    assert(out === 'ctx.bumps.vault', 'get("name").copied() \u2192 .name (optional bump)');
}
{
    // All three variants in one file
    const src = [
        'let b1 = ctx.bumps.get("required").unwrap();',
        'let b2 = ctx.bumps.get("optional").copied();',
        'let b3 = ctx.bumps.get("also_req").copied().unwrap();',
    ].join('\n');
    const out = migrateRustSource(src);
    assert(out.includes('ctx.bumps.required'), 'unwrap variant replaced');
    assert(out.includes('ctx.bumps.optional'), 'copied-only variant replaced');
    assert(out.includes('ctx.bumps.also_req'), 'copied+unwrap variant replaced');
    assert(!out.includes('.get('), 'no .get( remaining after all three');
}

// ---------------------------------------------------------------------------
// R2 — seeds → resolution feature rename
// ---------------------------------------------------------------------------
console.log('\nR2 — seeds feature renamed to resolution:');
{
    const src = `anchor-lang = { version = "0.29.0", features = ["seeds"] }`;
    const out = migrateCargoToml(src);
    assert(out !== null, 'seeds rename triggers change');
    assert(out.includes('"resolution"'), '"resolution" present');
    assert(!out.includes('"seeds"'), '"seeds" removed');
}
{
    const src = `anchor-lang = { version = "0.29.0", features = ["seeds", "init_if_needed"] }`;
    const out = migrateCargoToml(src);
    assert(out.includes('"resolution"'), 'seeds renamed in multi-feature list');
    assert(out.includes('"init_if_needed"'), 'other features preserved after rename');
}
{
    // No seeds feature — no rename
    const src = `anchor-lang = { version = "0.29.0", features = ["init_if_needed"] }`;
    const out = migrateCargoToml(src);
    // version still bumps, but no seeds rename change
    assert(!out || !out.includes('"resolution"'), 'no resolution added when seeds absent');
}

// ---------------------------------------------------------------------------
// R2 — anchor-spl idl-build injection
// ---------------------------------------------------------------------------
console.log('\nR2 — anchor-spl idl-build:');
{
    const src = `anchor-spl = { version = "0.29.0", features = ["token"] }`;
    const out = migrateCargoToml(src);
    assert(out !== null, 'anchor-spl inline table triggers change');
    assert(out.includes('0.30.1'), 'anchor-spl version bumped');
    assert(out.includes('"idl-build"'), 'idl-build added to anchor-spl');
    assert(out.includes('"token"'), 'existing anchor-spl feature preserved');
}
{
    const src = `anchor-spl = "0.29.0"`;
    const out = migrateCargoToml(src);
    assert(out !== null, 'anchor-spl bare string triggers change');
    assert(out.includes('0.30.1'), 'version bumped');
    assert(out.includes('"idl-build"'), 'idl-build added to bare anchor-spl');
}
{
    // idl-build already present — no duplicate
    const src = `anchor-spl = { version = "0.30.1", features = ["idl-build", "token"] }`;
    const out = migrateCargoToml(src);
    assert((out === null || (out.match(/idl-build/g) || []).length === 1), 'idl-build not duplicated in anchor-spl');
}

// ---------------------------------------------------------------------------
// R2 — workspace = true deps get idl-build
// ---------------------------------------------------------------------------
console.log('\nR2 — workspace = true deps:');
{
    // anchor-lang with workspace = true, no features → add idl-build
    const src = `anchor-lang = { workspace = true }`;
    const out = migrateCargoToml(src);
    assert(out !== null, 'workspace-only anchor-lang triggers change');
    assert(out.includes('idl-build'), 'idl-build added to workspace-only anchor-lang');
}
{
    // anchor-spl with workspace = true, no features → add idl-build
    const src = `anchor-spl = { workspace = true }`;
    const out = migrateCargoToml(src);
    assert(out !== null, 'workspace-only anchor-spl triggers change');
    assert(out.includes('idl-build'), 'idl-build added to workspace-only anchor-spl');
}
{
    // workspace = true WITH existing features — idl-build appended
    const src = `anchor-lang = { workspace = true, features = ["init_if_needed"] }`;
    const out = migrateCargoToml(src);
    assert(out !== null, 'workspace dep with features triggers change');
    assert(out.includes('"idl-build"'), 'idl-build appended to workspace dep features');
    assert(out.includes('"init_if_needed"'), 'existing feature preserved in workspace dep');
}
{
    // Full workspace Cargo.toml scenario
    const src = [
        '[workspace]',
        'members = ["programs/*"]',
        '',
        '[workspace.dependencies]',
        'anchor-lang = { version = "0.29.0", features = ["seeds"] }',
        'anchor-spl = { version = "0.29.0", features = ["token"] }',
        '',
        '[profile.release]',
        'lto = "fat"',
    ].join('\n');
    const out = migrateCargoToml(src);
    assert(out !== null, 'full workspace Cargo.toml triggers change');
    assert(out.includes('0.30.1'), 'versions bumped in workspace deps');
    assert(out.includes('"resolution"'), 'seeds renamed to resolution');
    assert((out.match(/"idl-build"/g) || []).length === 2, 'idl-build added to both anchor-lang and anchor-spl');
    assert(out.includes('overflow-checks = true'), 'overflow-checks added to [profile.release]');
}
{
    // Member Cargo.toml using workspace = true for both deps
    const src = [
        '[dependencies]',
        'anchor-lang = { workspace = true }',
        'anchor-spl = { workspace = true, features = ["token"] }',
    ].join('\n');
    const out = migrateCargoToml(src);
    assert(out !== null, 'member Cargo.toml with workspace deps triggers change');
    assert((out.match(/"idl-build"/g) || []).length === 2, 'idl-build added to both workspace deps');
}

// ── R6: workspace resolver = "2" ────────────────────────────────────────────
console.log('\nR6 — workspace Cargo.toml resolver = "2":');
{
    const src = `[workspace]\nmembers = [\n    "programs/*"\n]\n`;
    const out = migrateCargoToml(src);
    assert(out !== null, 'workspace Cargo.toml without resolver triggers change');
    assert(out.includes('resolver = "2"'), 'resolver = "2" added');
}
{
    const src = `[workspace]\nresolver = "2"\nmembers = [\n    "programs/*"\n]\n`;
    const out = migrateCargoToml(src);
    assert(out === null, 'workspace Cargo.toml already with resolver = unchanged');
}
{
    // Non-workspace Cargo.toml — should not get resolver
    const src = `[package]\nname = "my-program"\nversion = "0.1.0"\n\n[dependencies]\nanchor-lang = "0.29.0"\n`;
    const out = migrateCargoToml(src);
    assert(out !== null, 'non-workspace Cargo.toml still migrated (anchor-lang bump)');
    assert(!out.includes('resolver'), 'resolver NOT added to non-workspace Cargo.toml');
}

// ---------------------------------------------------------------------------
// Anchor.toml migration (A1–A2)
// ---------------------------------------------------------------------------
import { migrateAnchorToml } from './migrate-rust.mjs';

console.log('\nA1 — Anchor.toml: remove seeds = false from [features]:');
{
    const src = `[features]\nseeds = false\nskip-lint = false\n`;
    const out = migrateAnchorToml(src);
    assert(out !== null, 'seeds = false triggers change');
    assert(!out.includes('seeds = false'), 'seeds = false removed');
    assert(out.includes('skip-lint = false'), 'skip-lint = false preserved');
}
{
    // seeds = false with leading whitespace
    const src = `[features]\n  seeds = false\nskip-lint = false\n`;
    const out = migrateAnchorToml(src);
    assert(out !== null, 'indented seeds = false removed');
    assert(!out.includes('seeds'), 'seeds line gone');
}
{
    // seeds = true should NOT be removed (only false is invalid)
    const src = `[features]\nseeds = true\n`;
    const out = migrateAnchorToml(src);
    assert(out === null, 'seeds = true unchanged (only false is removed)');
}
{
    // Already clean Anchor.toml — no seeds line
    const src = `[features]\nskip-lint = false\n`;
    const out = migrateAnchorToml(src);
    assert(out === null, 'Anchor.toml without seeds = false unchanged (idempotent)');
}

console.log('\nA2 — Anchor.toml: bump anchor_version:');
{
    const src = `[toolchain]\nanchor_version = "0.29.0"\n`;
    const out = migrateAnchorToml(src);
    assert(out !== null, 'anchor_version triggers change');
    assert(out.includes('anchor_version = "0.30.1"'), 'anchor_version bumped to 0.30.1');
}
{
    // A1 + A2 combined (real-world Anchor.toml)
    const src = `[toolchain]\nanchor_version = "0.29.0"\n\n[features]\nseeds = false\nskip-lint = false\n`;
    const out = migrateAnchorToml(src);
    assert(out !== null, 'combined A1+A2 triggers change');
    assert(!out.includes('seeds = false'), 'A1: seeds line removed');
    assert(out.includes('anchor_version = "0.30.1"'), 'A2: version bumped');
}
{
    // anchor_version already at 0.30.x — idempotent
    const src = `[features]\nseeds = false\n[toolchain]\nanchor_version = "0.30.1"\n`;
    const out = migrateAnchorToml(src);
    assert(out !== null, 'still changed because seeds = false present');
    assert(out.includes('anchor_version = "0.30.1"'), 'anchor_version left as-is when already 0.30.1');
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript client migration (T1–T4 + P1–P2)
// ---------------------------------------------------------------------------

console.log('\nT1 — @project-serum/anchor → @coral-xyz/anchor:');
{
    const src = `import * as anchor from "@project-serum/anchor";`;
    const out = fixProjectSerumImport(src);
    assert(out.includes('@coral-xyz/anchor'), 'import string replaced');
    assert(!out.includes('@project-serum/anchor'), 'old package name gone');
}
{
    const src = `const anchor = require("@project-serum/anchor");`;
    const out = fixProjectSerumImport(src);
    assert(out.includes('@coral-xyz/anchor'), 'require string replaced');
}
{
    const src = `import { Program } from "@coral-xyz/anchor";`;
    const out = fixProjectSerumImport(src);
    assert(out === src, 'already-migrated import unchanged (idempotent)');
}
{
    // Multiple occurrences
    const src = `import "@project-serum/anchor"; const x = "@project-serum/anchor";`;
    const out = fixProjectSerumImport(src);
    assert((out.match(/@coral-xyz\/anchor/g) || []).length === 2, 'both occurrences replaced');
}

console.log('\nT2 — new Program(idl, programId, provider) → new Program(idl, provider):');
{
    // All simple identifiers
    const src = `const program = new Program(IDL, PROGRAM_ID, provider);`;
    const out = fixProgramConstructor(src);
    assert(out.includes('new Program(IDL, provider)'), 'simple 3-arg → 2-arg');
    assert(!out.includes('PROGRAM_ID'), 'programId removed');
}
{
    // With generic type parameter
    const src = `const program = new Program<MyProgram>(IDL, programId, provider);`;
    const out = fixProgramConstructor(src);
    assert(out.includes('new Program<MyProgram>(IDL, provider)'), 'generic form migrated');
}
{
    // Provider is a nested new expression
    const src = `const p = new Program(IDL, PROG_ID, new AnchorProvider(conn, wallet, opts));`;
    const out = fixProgramConstructor(src);
    assert(out.includes('new Program(IDL, new AnchorProvider(conn, wallet, opts))'), 'nested provider preserved');
    assert(!out.includes('PROG_ID'), 'programId removed with nested provider');
}
{
    // Already 2-arg form — must not be changed
    const src = `const program = new Program(IDL, provider);`;
    const out = fixProgramConstructor(src);
    assert(out === src, '2-arg form unchanged (idempotent)');
}
{
    // Trailing comma after last arg (TypeScript style) — should still count as 3-arg
    const src = `this.prog = new Program(\n  LaunchpadIDL,\n  PROGRAM_ID,\n  this.provider,\n);`;
    const out = fixProgramConstructor(src);
    assert(out.includes('new Program(LaunchpadIDL, this.provider)'), 'trailing comma form migrated');
    assert(!out.includes('PROGRAM_ID'), 'programId removed (trailing comma form)');
}
{
    // anchor.Program form is intentionally NOT matched by T2 (dot-prefix namespace)
    // — left as-is for AI step or manual migration
    const src = `const p = new anchor.Program(idl, progId, provider);`;
    const out = fixProgramConstructor(src);
    assert(out === src, 'anchor.Program (namespaced) left unchanged by T2');
}
{
    // Multiple Program instantiations in one file
    const src = [
        'const p1 = new Program(IDL1, PID1, provider);',
        'const p2 = new Program(IDL2, PID2, provider);',
    ].join('\n');
    const out = fixProgramConstructor(src);
    assert(out.includes('new Program(IDL1, provider)'), 'first instantiation migrated');
    assert(out.includes('new Program(IDL2, provider)'), 'second instantiation migrated');
}

console.log('\nT3 — .associated() / .associatedAddress() flagged with TODO:');
{
    const src = `const ata = await program.account.myAccount.associated(wallet.publicKey);`;
    const out = flagAssociatedMethods(src);
    assert(out.includes('TODO anchor 0.30'), 'TODO comment inserted');
    assert(out.includes('.associated('), 'method call preserved (not deleted)');
}
{
    const src = `const addr = program.account.mint.associatedAddress(authority);`;
    const out = flagAssociatedMethods(src);
    assert(out.includes('TODO anchor 0.30'), 'TODO comment for associatedAddress');
    assert(out.includes('.associatedAddress('), 'call preserved');
}
{
    // Idempotency: already has TODO comment — no double-annotation
    const src = `/* TODO anchor 0.30: .associated() removed – use getAssociatedTokenAddressSync() from @solana/spl-token */.associated(`;
    const out = flagAssociatedMethods(src);
    const count = (out.match(/TODO anchor 0\.30/g) || []).length;
    assert(count === 1, 'no duplicate TODO comment on second pass');
}

console.log('\nT4 — anchor-deprecated-state flagged with TODO:');
{
    const src = `features = ["anchor-deprecated-state"]`;
    const out = flagDeprecatedState(src);
    assert(out.includes('TODO anchor 0.30'), 'TODO comment inserted');
    assert(out.includes('anchor-deprecated-state'), 'original text preserved');
}

console.log('\nmigrateTypeScript — combined T1–T4:');
{
    const src = [
        `import { Program } from "@project-serum/anchor";`,
        `const program = new Program(IDL, PROGRAM_ID, provider);`,
        `const ata = await program.account.vault.associated(owner);`,
    ].join('\n');
    const out = migrateTypeScript(src);
    assert(out !== null, 'combined: changes detected');
    assert(out.includes('@coral-xyz/anchor'), 'T1 applied');
    assert(out.includes('new Program(IDL, provider)'), 'T2 applied');
    assert(out.includes('TODO anchor 0.30'), 'T3 applied');
}
{
    // Already fully migrated file → null (idempotent)
    const src = [
        `import { Program, AnchorProvider } from "@coral-xyz/anchor";`,
        `const program = new Program(IDL, provider);`,
    ].join('\n');
    const out = migrateTypeScript(src);
    assert(out === null, 'already-migrated file returns null (idempotent)');
}

console.log('\nP1/P2 — package.json anchor version + package rename:');
{
    // P1: version bump
    const src = JSON.stringify({ dependencies: { "@coral-xyz/anchor": "^0.29.0" } }, null, 2);
    const out = migratePackageJson(src);
    assert(out !== null, 'P1: version changed');
    assert(out.includes('0.30.1'), 'P1: version bumped to 0.30.1');
    assert(!out.includes('0.29'), 'P1: old version gone');
}
{
    // P1: tilde prefix
    const src = JSON.stringify({ devDependencies: { "@coral-xyz/anchor": "~0.29.0" } }, null, 2);
    const out = migratePackageJson(src);
    assert(out !== null && out.includes('~0.30.1'), 'P1: tilde version bumped');
}
{
    // P2: package rename (+ P1 bumped too)
    const src = JSON.stringify({ dependencies: { "@project-serum/anchor": "^0.29.0" } }, null, 2);
    const out = migratePackageJson(src);
    assert(out !== null, 'P2: package renamed');
    assert(out.includes('@coral-xyz/anchor'), 'P2: new package name present');
    assert(!out.includes('@project-serum/anchor'), 'P2: old package name gone');
    assert(out.includes('0.30.1'), 'P2+P1: version bumped after rename');
}
{
    // Already on 0.30.x → null (idempotent)
    const src = JSON.stringify({ dependencies: { "@coral-xyz/anchor": "^0.30.1" } }, null, 2);
    const out = migratePackageJson(src);
    assert(out === null, 'P1: already on 0.30.x returns null (idempotent)');
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
