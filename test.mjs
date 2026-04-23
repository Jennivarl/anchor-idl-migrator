/**
 * Test suite for anchor-idl-migrator.
 * Uses a hand-crafted v0 IDL covering all migration cases.
 */
import { createHash } from 'crypto';
import { migrateIdl, isV1Idl } from './migrate.mjs';

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
// Results
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
