/**
 * migrate-rust.mjs
 *
 * Migrates Anchor Rust source files from 0.29 patterns to 0.30 patterns.
 *
 * Rules applied (all text-level, no AST required for these changes):
 *
 * R1. ctx.bumps.get("name").unwrap()  →  ctx.bumps.name
 *     ctx.bumps["name"]               →  ctx.bumps.name
 *     ctx.bumps.get("name").copied().unwrap() → ctx.bumps.name   (variant)
 *
 * R2. Cargo.toml — anchor-lang/anchor-spl version bumps:
 *       "0.29.x"  →  "0.30.1"
 *       adds `idl-build` feature to anchor-lang dep if missing
 *       adds `overflow-checks = true` to [profile.release] if missing
 *
 * R3. `CLOSED_ACCOUNT_DISCRIMINATOR`  →  removed (Anchor 0.30 drops it);
 *     usage replaced with a compile-time TODO comment.
 *
 * R4. `#[account(bump = ctx.bumps["name"])]`  →  `#[account(bump = ctx.bumps.name)]`
 *
 * R5. `ProgramResult`  →  `Result<()>`   (Anchor 0.30 enforces this)
 *
 * CLI usage:
 *   node migrate-rust.mjs path/to/file.rs
 *   node migrate-rust.mjs path/to/Cargo.toml
 *   node migrate-rust.mjs src/           (walks all .rs + Cargo.toml files)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// ── R1 helpers ──────────────────────────────────────────────────────────────

/**
 * Transform all bump-access patterns in a Rust source string.
 *
 * Patterns handled:
 *   ctx.bumps.get("name").unwrap()          → ctx.bumps.name
 *   ctx.bumps.get("name").copied().unwrap() → ctx.bumps.name
 *   ctx.bumps["name"]                       → ctx.bumps.name
 *   #[account(bump = ctx.bumps["name"])]    → #[account(bump = ctx.bumps.name)]
 */
function fixBumps(src) {
    // ctx.bumps.get("name").copied().unwrap()
    src = src.replace(
        /ctx\.bumps\.get\("([^"]+)"\)\.copied\(\)\.unwrap\(\)/g,
        'ctx.bumps.$1',
    );
    // ctx.bumps.get("name").unwrap()
    src = src.replace(
        /ctx\.bumps\.get\("([^"]+)"\)\.unwrap\(\)/g,
        'ctx.bumps.$1',
    );
    // ctx.bumps["name"]
    src = src.replace(/ctx\.bumps\["([^"]+)"\]/g, 'ctx.bumps.$1');
    return src;
}

// ── R3 helper ───────────────────────────────────────────────────────────────

/**
 * Replace CLOSED_ACCOUNT_DISCRIMINATOR usages with a TODO comment.
 * The constant was removed in Anchor 0.30.
 */
function fixClosedAccountDiscriminator(src) {
    return src.replace(
        /CLOSED_ACCOUNT_DISCRIMINATOR/g,
        '/* TODO(anchor-0.30): CLOSED_ACCOUNT_DISCRIMINATOR removed — use [255;8] or close constraint */',
    );
}

// ── R5 helper ───────────────────────────────────────────────────────────────

/**
 * Replace bare ProgramResult return types with Result<()>.
 * Only replaces `-> ProgramResult` (function return position).
 */
function fixProgramResult(src) {
    return src.replace(/-> ProgramResult\b/g, '-> Result<()>');
}

// ── .rs migration ───────────────────────────────────────────────────────────

/**
 * Apply all Rust-source rules to a string and return the transformed string.
 * Returns null if no changes were made.
 *
 * @param {string} src  Raw file content
 * @returns {string|null}
 */
export function migrateRustSource(src) {
    let out = src;
    out = fixBumps(out);
    out = fixClosedAccountDiscriminator(out);
    out = fixProgramResult(out);
    return out === src ? null : out;
}

// ── Cargo.toml migration ────────────────────────────────────────────────────

/**
 * Migrate a Cargo.toml string:
 *   - Bump anchor-lang / anchor-spl versions 0.29.x → 0.30.1
 *   - Add `idl-build` to anchor-lang features if missing
 *   - Add `overflow-checks = true` to [profile.release] if missing
 *
 * Returns null if no changes were made.
 *
 * @param {string} src  Raw Cargo.toml content
 * @returns {string|null}
 */
export function migrateCargoToml(src) {
    let out = src;

    // Bump anchor-lang version  "0.29.x" → "0.30.1"
    // Handles: anchor-lang = "0.29.0", anchor-lang = { version = "0.29.0", ... }
    out = out.replace(
        /(anchor-lang\s*=\s*(?:"|\{\s*version\s*=\s*"))0\.29\.\d+/g,
        '$10.30.1',
    );
    // Same for anchor-spl
    out = out.replace(
        /(anchor-spl\s*=\s*(?:"|\{\s*version\s*=\s*"))0\.29\.\d+/g,
        '$10.30.1',
    );

    // Add idl-build feature to anchor-lang if it's an inline table dep
    // e.g.  anchor-lang = { version = "0.30.1", features = ["init_if_needed"] }
    // → anchor-lang = { version = "0.30.1", features = ["init_if_needed", "idl-build"] }
    out = out.replace(
        /(anchor-lang\s*=\s*\{[^}]*features\s*=\s*\[)([^\]]*?)(\])/g,
        (match, pre, feats, close) => {
            if (feats.includes('idl-build')) return match; // already there
            const sep = feats.trim() === '' ? '' : ', ';
            return `${pre}${feats}${sep}"idl-build"${close}`;
        },
    );

    // If anchor-lang is a bare string dep (no features), convert to table and add idl-build
    // e.g.  anchor-lang = "0.30.1"  →  anchor-lang = { version = "0.30.1", features = ["idl-build"] }
    out = out.replace(
        /^(anchor-lang\s*=\s*)"(0\.30\.\d+)"$/m,
        '$1{ version = "$2", features = ["idl-build"] }',
    );

    // Add overflow-checks to [profile.release] if missing
    if (out.includes('[profile.release]') && !out.includes('overflow-checks')) {
        out = out.replace(
            /(\[profile\.release\])/,
            '$1\noverflow-checks = true',
        );
    }

    return out === src ? null : out;
}

// ── File router ─────────────────────────────────────────────────────────────

/**
 * Migrate a single file in-place.
 * Returns true if the file was changed.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function migrateFile(filePath) {
    const src = readFileSync(filePath, 'utf-8');
    let result = null;

    if (filePath.endsWith('Cargo.toml')) {
        result = migrateCargoToml(src);
    } else if (extname(filePath) === '.rs') {
        result = migrateRustSource(src);
    }

    if (result !== null) {
        writeFileSync(filePath, result, 'utf-8');
        return true;
    }
    return false;
}

/**
 * Walk a directory and migrate all .rs and Cargo.toml files.
 * Skips target/ directories.
 *
 * @param {string} dir
 * @returns {string[]} list of changed file paths
 */
export function migrateDirectory(dir) {
    const changed = [];
    const entries = readdirSync(dir);
    for (const entry of entries) {
        if (entry === 'target' || entry === '.git') continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            changed.push(...migrateDirectory(full));
        } else if (entry === 'Cargo.toml' || extname(entry) === '.rs') {
            if (migrateFile(full)) changed.push(full);
        }
    }
    return changed;
}

// ── CLI entry point ─────────────────────────────────────────────────────────

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const target = process.argv[2];
    if (!target) {
        console.error('Usage: node migrate-rust.mjs <file.rs|Cargo.toml|directory>');
        process.exit(1);
    }

    const st = statSync(target);
    let changed;
    if (st.isDirectory()) {
        changed = migrateDirectory(target);
    } else {
        changed = migrateFile(target) ? [target] : [];
    }

    if (changed.length === 0) {
        console.log('No changes needed.');
    } else {
        console.log(`Migrated ${changed.length} file(s):`);
        changed.forEach(f => console.log(`  ${f}`));
    }
}
