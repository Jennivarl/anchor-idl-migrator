#!/usr/bin/env node
/**
 * anchor-idl-migrator
 *
 * Converts Anchor IDL files from the legacy v0 format (pre Anchor 0.30)
 * to the new v1 format introduced in Anchor 0.30.
 *
 * Migration spec derived from:
 *   https://github.com/solana-foundation/anchor/blob/master/idl/src/convert.rs
 *
 * Key changes from v0 → v1:
 *   - Top-level `name`/`version` move into `metadata: { name, version, spec }`
 *   - A top-level `address` field is required (program address)
 *   - `instructions[*].accounts[*].isMut`    → `writable`
 *   - `instructions[*].accounts[*].isSigner` → `signer`
 *   - `instructions[*]` gains a `discriminator` (sha256("global:snake_name")[0..8])
 *   - `accounts[*]` loses inline type defs; only `{ name, discriminator }` remains
 *     (discriminator = sha256("account:Name")[0..8])
 *   - `events[*]` gains `discriminator` (sha256("event:Name")[0..8])
 *   - Account type defs and event structs are moved into `types[]`
 *   - Type `"publicKey"` → `"pubkey"`
 *   - Type `{ "defined": "Name" }` → `{ "defined": { "name": "Name" } }`
 *   - All instruction/account/field names are converted to snake_case
 *     (to match Anchor's heck::SnakeCase behaviour)
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Discriminator helpers
// ---------------------------------------------------------------------------

/**
 * Compute an 8-byte discriminator matching Anchor's get_disc().
 * sha256(prefix + ":" + name)[0..8]
 */
function getDisc(prefix, name) {
    const hash = createHash('sha256').update(`${prefix}:${name}`).digest();
    return Array.from(hash.slice(0, 8));
}

// ---------------------------------------------------------------------------
// snake_case conversion (mirrors heck's to_snake_case used by Anchor)
// ---------------------------------------------------------------------------

/**
 * Convert camelCase / PascalCase / SCREAMING_SNAKE to snake_case.
 * Matches the output of Rust's heck crate `to_snake_case()` for the naming
 * patterns found in Anchor programs.
 *
 * Examples:
 *   initialize            → initialize
 *   addLiquidity          → add_liquidity
 *   openPositionWithMetadata → open_position_with_metadata
 *   HTMLParser            → html_parser
 *   already_snake         → already_snake
 */
function toSnakeCase(str) {
    return str
        // "HTMLParser" → "HTML_Parser"  (run of uppercase followed by uppercase+lowercase)
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        // "addLiquidity" → "add_Liquidity"  (lowercase/digit followed by uppercase)
        .replace(/([a-z\d])([A-Z])/g, '$1_$2')
        .toLowerCase();
}

// ---------------------------------------------------------------------------
// IDL type conversion
// ---------------------------------------------------------------------------

/**
 * Convert a v0 IDL type representation to v1.
 *
 * v0 → v1 changes:
 *   "publicKey"                        → "pubkey"
 *   { "defined": "Name" }              → { "defined": { "name": "Name" } }
 *   { "definedWithTypeArgs": { ... } } → { "defined": { "name": "...", "generics": [...] } }
 *   All other primitives stay the same.
 */
function convertType(ty) {
    if (ty === null || ty === undefined) return ty;

    // Primitive string types (bool, u8, u16, u32, u64, u128, i8, i16, i32, i64,
    // i128, f32, f64, bytes, string, pubkey, etc.)
    if (typeof ty === 'string') {
        if (ty === 'publicKey') return 'pubkey';
        return ty;
    }

    // Defined type reference (v0: string value → v1: object with name)
    if ('defined' in ty) {
        if (typeof ty.defined === 'string') {
            return { defined: { name: ty.defined } };
        }
        // Already v1 format or has generics
        if (typeof ty.defined === 'object' && ty.defined !== null) {
            return {
                defined: {
                    name: ty.defined.name,
                    ...(ty.defined.generics?.length
                        ? { generics: ty.defined.generics.map(convertGenericArg) }
                        : {}),
                },
            };
        }
        return ty;
    }

    // Compound types with nested type payloads
    if ('option' in ty) return { option: convertType(ty.option) };
    if ('vec' in ty) return { vec: convertType(ty.vec) };
    if ('array' in ty) return { array: [convertType(ty.array[0]), ty.array[1]] };
    if ('coption' in ty) return { coption: convertType(ty.coption) };

    // Legacy: genericLenArray → v1 array with generic length
    if ('genericLenArray' in ty) {
        return { array: [convertType(ty.genericLenArray[0]), ty.genericLenArray[1]] };
    }

    // Legacy: definedWithTypeArgs → v1 defined with generics
    if ('definedWithTypeArgs' in ty) {
        const { name, args = [] } = ty.definedWithTypeArgs;
        return {
            defined: {
                name,
                ...(args.length ? { generics: args.map(convertGenericArg) } : {}),
            },
        };
    }

    // Generic type parameter (e.g., { "generic": "T" })
    if ('generic' in ty) return { generic: ty.generic };

    // Pass through anything else unchanged
    return ty;
}

/**
 * Convert a v0 generic type argument to v1.
 */
function convertGenericArg(arg) {
    if ('type' in arg) return { type: convertType(arg.type) };
    if ('value' in arg) return { const: arg.value };
    if ('generic' in arg) return { type: { generic: arg.generic } };
    return arg;
}

// ---------------------------------------------------------------------------
// Field / account conversion
// ---------------------------------------------------------------------------

/**
 * Convert a v0 IDL field to v1.
 * Field name is converted to snake_case (matching Anchor's heck conversion).
 */
function convertField(field) {
    const result = {
        name: toSnakeCase(field.name),
        type: convertType(field.type ?? field.ty),
    };
    if (field.docs?.length) result.docs = field.docs;
    return result;
}

/**
 * Convert a v0 instruction account item to v1.
 * Handles both single accounts and composite account groups.
 */
function convertInstructionAccount(acc) {
    // Composite account group (e.g. nested Accounts struct)
    if (Array.isArray(acc.accounts)) {
        return {
            name: toSnakeCase(acc.name),
            accounts: acc.accounts.map(convertInstructionAccount),
        };
    }

    // Single account
    const result = {
        name: toSnakeCase(acc.name),
        writable: acc.isMut ?? false,
        signer: acc.isSigner ?? false,
    };

    if (acc.isOptional || acc.optional) result.optional = true;
    if (acc.docs?.length) result.docs = acc.docs;
    if (acc.address) result.address = acc.address;
    if (acc.pda) {
        const pda = convertPda(acc.pda);
        if (pda) result.pda = pda;
    }
    if (acc.relations?.length) result.relations = acc.relations;

    return result;
}

/**
 * Convert a v0 PDA definition to v1.
 */
function convertPda(pda) {
    if (!pda) return null;
    const result = {
        seeds: (pda.seeds ?? []).map(convertSeed),
    };
    if (pda.programId) {
        const prog = convertSeed(pda.programId);
        if (prog) result.program = prog;
    }
    return result;
}

/**
 * Convert a v0 seed definition to v1.
 */
function convertSeed(seed) {
    if (!seed) return null;
    switch (seed.kind) {
        case 'const': {
            // v0 const seed: { kind, type, value }
            // v1 const seed: { kind, value: <bytes array> }
            // Only string type is supported in the official Anchor conversion.
            // For string seeds, Anchor stores the raw UTF-8 bytes.
            let bytes;
            if (seed.type === 'string' && typeof seed.value === 'string') {
                bytes = Array.from(Buffer.from(seed.value));
            } else if (Array.isArray(seed.value)) {
                bytes = seed.value;
            } else {
                // Best-effort: pass the value through
                bytes = seed.value;
            }
            return { kind: 'const', value: bytes };
        }
        case 'arg':
            return { kind: 'arg', path: seed.path };
        case 'account': {
            const s = { kind: 'account', path: seed.path };
            if (seed.account) s.account = seed.account;
            return s;
        }
        default:
            return seed;
    }
}

// ---------------------------------------------------------------------------
// Type definition conversion
// ---------------------------------------------------------------------------

/**
 * Detect whether enum variant fields are Named (array of {name, type} objects)
 * or Tuple (array of type values).
 */
function isNamedFields(fields) {
    if (!Array.isArray(fields) || fields.length === 0) return false;
    return typeof fields[0] === 'object' && fields[0] !== null && 'name' in fields[0];
}

/**
 * Convert a v0 type definition body (the "type" sub-object) to v1 format.
 */
function convertTypeDefBody(ty) {
    if (!ty) return ty;

    switch (ty.kind) {
        case 'struct': {
            const fields = ty.fields ?? [];
            return {
                kind: 'struct',
                fields: fields.length ? fields.map(convertField) : null,
            };
        }

        case 'enum': {
            return {
                kind: 'enum',
                variants: (ty.variants ?? []).map(variant => {
                    const v = { name: variant.name };

                    if (variant.fields?.length) {
                        if (isNamedFields(variant.fields)) {
                            // Named fields
                            v.fields = variant.fields.map(convertField);
                        } else {
                            // Tuple fields (array of types)
                            v.fields = variant.fields.map(f => convertType(typeof f === 'string' || !('name' in (f || {})) ? f : f.type ?? f.ty));
                        }
                    }

                    return v;
                }),
            };
        }

        case 'alias':
            // v0 alias: { kind: "alias", value: <type> }
            // v1 uses "type" kind: { kind: "type", alias: <type> }
            return { kind: 'type', alias: convertType(ty.value) };

        default:
            return ty;
    }
}

/**
 * Convert a v0 IdlTypeDefinition (accounts[] or types[] entry) to a v1 IdlTypeDef.
 */
function convertTypeDef(typeDef) {
    const result = {
        name: typeDef.name,
        serialization: 'borsh',
        type: convertTypeDefBody(typeDef.type ?? typeDef.ty),
    };
    if (typeDef.docs?.length) result.docs = typeDef.docs;
    if (typeDef.generics?.length) result.generics = typeDef.generics;
    return result;
}

/**
 * Convert a v0 legacy event (which has fields[]) to a v1 IdlTypeDef (struct).
 * The event's fields are turned into a struct — field.index is dropped.
 */
function convertEventToTypeDef(event) {
    const result = {
        name: event.name,
        serialization: 'borsh',
        type: {
            kind: 'struct',
            fields: (event.fields ?? []).map(f => ({
                name: toSnakeCase(f.name),
                type: convertType(f.type ?? f.ty),
                // f.index is intentionally dropped — not present in v1
            })),
        },
    };
    if (event.docs?.length) result.docs = event.docs;
    return result;
}

// ---------------------------------------------------------------------------
// Main migration function
// ---------------------------------------------------------------------------

/**
 * Migrate a parsed v0 Anchor IDL object to the v1 format.
 *
 * @param {object} idl           - Parsed v0 IDL JSON object
 * @param {string} [programAddress] - Override for the program address.
 *                                    Reads from idl.metadata.address,
 *                                    idl.metadata.programId, or idl.programId
 *                                    if not provided.
 * @returns {object} v1 IDL object
 */
export function migrateIdl(idl, programAddress = null) {
    // ── Address ────────────────────────────────────────────────────────────────
    const address =
        programAddress ||
        idl?.metadata?.address ||
        idl?.metadata?.programId ||
        idl?.programId ||
        '11111111111111111111111111111111'; // system program as fallback

    // ── Instructions ──────────────────────────────────────────────────────────
    const instructions = (idl.instructions ?? []).map(ix => {
        const snakeName = toSnakeCase(ix.name);
        const result = {
            name: snakeName,
            discriminator: getDisc('global', snakeName),
            accounts: (ix.accounts ?? []).map(convertInstructionAccount),
            args: (ix.args ?? []).map(convertField),
        };
        if (ix.docs?.length) result.docs = ix.docs;
        if (ix.returns != null) result.returns = convertType(ix.returns);
        return result;
    });

    // ── Accounts ──────────────────────────────────────────────────────────────
    // v1 accounts[] only has { name, discriminator }
    const accounts = (idl.accounts ?? []).map(acc => ({
        name: acc.name,
        discriminator: getDisc('account', acc.name),
    }));

    // ── Events ────────────────────────────────────────────────────────────────
    const events = (idl.events ?? []).map(ev => ({
        name: ev.name,
        discriminator: getDisc('event', ev.name),
    }));

    // ── Types (merge existing types + moved account defs + moved event defs) ──
    const existingTypes = (idl.types ?? []).map(convertTypeDef);
    const accountTypeDefs = (idl.accounts ?? []).map(convertTypeDef);
    const eventTypeDefs = (idl.events ?? []).map(convertEventToTypeDef);
    // Deduplicate by name — first occurrence wins (accounts may duplicate types[])
    const seenNames = new Set();
    const types = [...existingTypes, ...accountTypeDefs, ...eventTypeDefs].filter(t => {
        if (seenNames.has(t.name)) return false;
        seenNames.add(t.name);
        return true;
    });

    // ── Errors ────────────────────────────────────────────────────────────────
    const errors = (idl.errors ?? []).map(e => {
        const err = { code: e.code, name: e.name };
        if (e.msg != null) err.msg = e.msg;
        return err;
    });

    // ── Constants ─────────────────────────────────────────────────────────────
    const constants = (idl.constants ?? []).map(c => ({
        name: c.name,
        type: convertType(c.type ?? c.ty),
        value: c.value,
    }));

    // ── Assemble v1 IDL ───────────────────────────────────────────────────────
    const v1 = {
        address,
        metadata: {
            name: idl.name,
            version: idl.version,
            spec: '0.1.0',
            description: idl.metadata?.description ?? '',
        },
        instructions,
        accounts,
        events,
        errors,
        types,
        constants,
    };

    if (idl.docs?.length) v1.docs = idl.docs;

    return v1;
}

// ---------------------------------------------------------------------------
// Detect whether an IDL is already v1
// ---------------------------------------------------------------------------

/**
 * Returns true if the IDL already has the v1 spec field.
 */
export function isV1Idl(idl) {
    return idl?.metadata?.spec != null;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// Normalise paths for cross-platform comparison (handles Windows backslashes
// and the leading "/" that URL adds on Windows, e.g. /C:/Users/...)
const _argv1Norm = process.argv[1]?.replace(/\\/g, '/').replace(/^\/([A-Za-z]:)/, '$1').toLowerCase();
const _selfNorm = new URL(import.meta.url).pathname.replace(/\\/g, '/').replace(/^\/([A-Za-z]:)/, '$1').toLowerCase();
if (_argv1Norm === _selfNorm) {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.error(`
anchor-idl-migrator — Convert Anchor IDL v0 → v1

Usage:
  node migrate.mjs <input.json> [output.json] [--address <PROGRAM_ADDRESS>]

Options:
  --address <ADDR>   Override the program address written into the v1 IDL.
                     If omitted, reads from idl.metadata.address or idl.programId.
  -h, --help         Show this help.

Examples:
  # Print v1 IDL to stdout
  node migrate.mjs target/idl/my_program.json

  # Write v1 IDL to file
  node migrate.mjs target/idl/my_program.json target/idl/my_program_v1.json

  # With explicit program address
  node migrate.mjs old.json new.json --address So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo
`.trim());
        process.exit(args.length === 0 ? 1 : 0);
    }

    let inputFile = null;
    let outputFile = null;
    let programAddress = null;

    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '--address' || args[i] === '-a') && args[i + 1]) {
            programAddress = args[++i];
        } else if (!inputFile) {
            inputFile = args[i];
        } else if (!outputFile) {
            outputFile = args[i];
        }
    }

    if (!inputFile) {
        console.error('Error: input file required.');
        process.exit(1);
    }

    let input;
    try {
        input = JSON.parse(readFileSync(inputFile, 'utf-8'));
    } catch (err) {
        console.error(`Error reading ${inputFile}: ${err.message}`);
        process.exit(1);
    }

    if (isV1Idl(input)) {
        console.error(`Warning: ${inputFile} already has metadata.spec="${input.metadata.spec}" — may already be v1.`);
    }

    const output = migrateIdl(input, programAddress);
    const outputJson = JSON.stringify(output, null, 2);

    if (outputFile) {
        writeFileSync(outputFile, outputJson, 'utf-8');
        console.error(`✓ Migrated IDL written to ${outputFile}`);
    } else {
        process.stdout.write(outputJson + '\n');
    }
}
