/**
 * migrate-rust.mjs
 *
 * Migrates Anchor Rust source files from 0.29 patterns to 0.30 patterns.
 *
 * Rules applied (all text-level, no AST required for these changes):
 *
 * R1. ctx.bumps.get("name").unwrap()          →  ctx.bumps.name
 *     ctx.bumps["name"]                       →  ctx.bumps.name
 *     ctx.bumps.get("name").copied().unwrap() →  ctx.bumps.name
 *     ctx.bumps.get("name").copied()          →  ctx.bumps.name  (optional accounts)
 *
 * R2. Cargo.toml — anchor-lang/anchor-spl version bumps:
 *       "0.29.x"  →  "0.30.1"
 *       adds `idl-build` feature to anchor-lang and anchor-spl if missing
 *       renames `seeds` feature to `resolution` in anchor-lang features
 *       adds `overflow-checks = true` to [profile.release] if missing
 *       handles `workspace = true` deps (no version, just adds idl-build feature)
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

import { readFileSync, writeFileSync, renameSync, readdirSync, statSync, lstatSync, realpathSync } from 'fs';
import { join, extname, basename } from 'path';

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
    // ctx.bumps.get("name").copied().unwrap()  — required account, most specific first
    src = src.replace(
        /ctx\.bumps\.get\("([^"]+)"\)\.copied\(\)\.unwrap\(\)/g,
        'ctx.bumps.$1',
    );
    // ctx.bumps.get("name").unwrap()  — required account
    src = src.replace(
        /ctx\.bumps\.get\("([^"]+)"\)\.unwrap\(\)/g,
        'ctx.bumps.$1',
    );
    // ctx.bumps.get("name").copied()  — optional account (returns Option<u8>)
    // In 0.30 optional bumps are ctx.bumps.name which returns Option<u8>
    src = src.replace(
        /ctx\.bumps\.get\("([^"]+)"\)\.copied\(\)/g,
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
    // Bare form: -> ProgramResult
    // Fully-qualified form: -> anchor_lang::solana_program::entrypoint::ProgramResult
    src = src.replace(/-> anchor_lang::solana_program::entrypoint::ProgramResult\b/g, '-> Result<()>');
    src = src.replace(/-> ProgramResult\b/g, '-> Result<()>');
    return src;
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
 *   - Rename `seeds` feature to `resolution` in anchor-lang features
 *   - Add `idl-build` to anchor-lang and anchor-spl features if missing
 *   - Handle `workspace = true` deps — adds `idl-build` feature
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
    // Handles: anchor-lang = "0.29.0", anchor-lang = "^0.29.0", anchor-lang = { version = "0.29.0", ... }
    out = out.replace(
        /(anchor-lang\s*=\s*(?:"|\{\s*version\s*=\s*"))[~^]?0\.29\.\d+/g,
        '$10.30.1',
    );
    // Same for anchor-spl
    out = out.replace(
        /(anchor-spl\s*=\s*(?:"|\{\s*version\s*=\s*"))[~^]?0\.29\.\d+/g,
        '$10.30.1',
    );

    // ── Rename `seeds` feature to `resolution` in anchor-lang deps ──────────
    // Anchor 0.30 renamed the `seeds` feature to `resolution` (enabled by default)
    out = out.replace(
        /(anchor-lang\s*=\s*\{[^}]*features\s*=\s*\[)([^\]]*?)(\])/g,
        (match, pre, feats, close) => {
            const renamed = feats.replace(/"seeds"/g, '"resolution"');
            return renamed !== feats ? `${pre}${renamed}${close}` : match;
        },
    );

    // ── Add idl-build to anchor-lang inline table dep ─────────────────────────
    // e.g.  anchor-lang = { version = "0.30.1", features = ["init_if_needed"] }
    // → anchor-lang = { version = "0.30.1", features = ["init_if_needed", "idl-build"] }
    out = out.replace(
        /(anchor-lang\s*=\s*\{[^}]*features\s*=\s*\[)([^\]]*?)(\])/g,
        (match, pre, feats, close) => {
            if (feats.includes('idl-build')) return match;
            const sep = feats.trim() === '' ? '' : ', ';
            return `${pre}${feats}${sep}"idl-build"${close}`;
        },
    );

    // If anchor-lang is a bare string dep (no features), convert to table and add idl-build
    // e.g.  anchor-lang = "0.30.1"  →  anchor-lang = { version = "0.30.1", features = ["idl-build"] }
    out = out.replace(
        /^(anchor-lang\s*=\s*)"([~^]?0\.30\.\d+)"$/m,
        (_, pre, ver) => `${pre}{ version = "${ver.replace(/^[~^]/, '')}", features = ["idl-build"] }`,
    );

    // If anchor-lang uses workspace = true but has no features key → add idl-build
    // e.g.  anchor-lang = { workspace = true }  →  anchor-lang = { workspace = true, features = ["idl-build"] }
    out = out.replace(
        /^(anchor-lang\s*=\s*\{)([^}]*workspace\s*=\s*true[^}]*)(\s*\})$/gm,
        (match, open, body, close) => {
            if (body.includes('features')) return match; // already has features
            return `${open}${body.trimEnd()}, features = ["idl-build"]${close}`;
        },
    );

    // ── Add idl-build to anchor-spl inline table dep ──────────────────────────
    out = out.replace(
        /(anchor-spl\s*=\s*\{[^}]*features\s*=\s*\[)([^\]]*?)(\])/g,
        (match, pre, feats, close) => {
            if (feats.includes('idl-build')) return match;
            const sep = feats.trim() === '' ? '' : ', ';
            return `${pre}${feats}${sep}"idl-build"${close}`;
        },
    );

    // If anchor-spl is a bare string dep (no features), convert to table and add idl-build
    out = out.replace(
        /^(anchor-spl\s*=\s*)"([~^]?0\.30\.\d+)"$/m,
        (_, pre, ver) => `${pre}{ version = "${ver.replace(/^[~^]/, '')}", features = ["idl-build"] }`,
    );

    // If anchor-spl uses workspace = true but has no features key → add idl-build
    out = out.replace(
        /^(anchor-spl\s*=\s*\{)([^}]*workspace\s*=\s*true[^}]*)(\s*\})$/gm,
        (match, open, body, close) => {
            if (body.includes('features')) return match;
            return `${open}${body.trimEnd()}, features = ["idl-build"]${close}`;
        },
    );

    // ── Add overflow-checks to [profile.release] if missing ───────────────────
    if (out.includes('[profile.release]') && !out.includes('overflow-checks')) {
        out = out.replace(
            /(\[profile\.release\])/,
            '$1\noverflow-checks = true',
        );
    }

    // ── R6: Add resolver = "2" to [workspace] if missing ─────────────────────
    // Anchor 0.30 requires the Cargo resolver v2 for feature unification.
    if (out.includes('[workspace]') && !out.includes('resolver')) {
        // Insert resolver after the opening [workspace] line
        out = out.replace(
            /(\[workspace\]\r?\n)/,
            '$1resolver = "2"\n',
        );
    }

    return out === src ? null : out;
}

// ── Anchor.toml migration ───────────────────────────────────────────────────

/**
 * Migrate an Anchor.toml string:
 *   - A1: Remove `seeds = false` from [features] (feature removed in 0.30)
 *   - A2: Bump `anchor_version` to "0.30.1" if present
 *
 * Returns null if no changes were made.
 *
 * @param {string} src  Raw Anchor.toml content
 * @returns {string|null}
 */
export function migrateAnchorToml(src) {
    let out = src;

    // A1: Remove `seeds = false` line — the `seeds` resolution feature is
    // enabled unconditionally in 0.30 and the flag was removed entirely.
    // Leaving it causes `anchor build` to fail with an unknown feature error.
    out = out.replace(/^[ \t]*seeds\s*=\s*false[ \t]*\r?\n?/m, '');

    // A2: Bump anchor_version (appears in some Anchor.toml toolchain sections)
    // Only upgrade from 0.29.x — never touch 0.30.x or higher to avoid downgrades.
    out = out.replace(
        /(anchor_version\s*=\s*")0\.29\.\d+"/,
        '$10.30.1"',
    );

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
    } else if (basename(filePath) === 'Anchor.toml') {
        result = migrateAnchorToml(src);
    } else if (extname(filePath) === '.rs') {
        result = migrateRustSource(src);
    }

    if (result !== null) {
        if (lstatSync(filePath).isSymbolicLink()) {
            throw new Error(`Refusing to write to symlink: ${filePath}`);
        }
        const tmp = filePath + '.migrating.tmp';
        try {
            writeFileSync(tmp, result, 'utf-8');
            renameSync(tmp, filePath);
        } catch (err) {
            try { writeFileSync(tmp, '', 'utf-8'); renameSync(tmp, tmp + '.del'); } catch { }
            throw err;
        }
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
export function migrateDirectory(dir, _visited = new Set()) {
    const realDir = realpathSync(dir);
    if (_visited.has(realDir)) return [];
    _visited.add(realDir);

    const changed = [];
    const entries = readdirSync(dir);
    for (const entry of entries) {
        if (entry === 'target' || entry === '.git') continue;
        const full = join(dir, entry);
        const lst = lstatSync(full);
        if (lst.isSymbolicLink()) continue;
        if (lst.isDirectory()) {
            changed.push(...migrateDirectory(full, _visited));
        } else if (entry === 'Cargo.toml' || entry === 'Anchor.toml' || extname(entry) === '.rs') {
            if (migrateFile(full)) changed.push(full);
        }
    }
    return changed;
}

// ── CLI entry point ─────────────────────────────────────────────────────────

const _isCliRust = (() => { try { return import.meta.url ? process.argv[1] === new URL(import.meta.url).pathname : false; } catch { return false; } })();
if (_isCliRust) {
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
