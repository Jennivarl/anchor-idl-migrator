/**
 * migrate-ts.mjs
 *
 * Migrates Anchor TypeScript/JavaScript client files from 0.29 patterns to 0.30.
 *
 * Breaking changes covered (see Anchor 0.30 CHANGELOG):
 *
 * T1. `@project-serum/anchor` → `@coral-xyz/anchor`
 *     The package was renamed in 0.26; projects still importing the old name must update.
 *
 * T2. `new Program(idl, programId, provider)` → `new Program(idl, provider)`
 *     The `programId` constructor parameter was removed in 0.30 (#2864).
 *     The program address is now always derived from idl.address.
 *
 * T3. `.associated(` / `.associatedAddress(` method calls → TODO comment
 *     `program.associated`, `program.account.associated`, and
 *     `program.account.associatedAddress` were removed in 0.30 (#2749).
 *     Replacement: use `@solana/spl-token`'s `getAssociatedTokenAddressSync`.
 *
 * T4. `anchor-deprecated-state` references → TODO comment
 *     The `anchor-deprecated-state` feature was removed in 0.30 (#2717).
 *
 * For package.json files:
 * P1. `@coral-xyz/anchor` version `0.29.x` → `0.30.1`
 * P2. `@project-serum/anchor` dependency → `@coral-xyz/anchor`
 */

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Given src and the index of an opening '(', extract top-level comma-separated
 * argument strings using balanced-parenthesis / string-literal tracking.
 *
 * Returns { args: string[], closePos: number } or null if parsing fails
 * (e.g. unterminated string or unbalanced parens).
 */
function extractCallArgs(src, openParenIdx) {
    if (src[openParenIdx] !== '(') return null;
    const args = [];
    let depth = 0;
    let argStart = openParenIdx + 1;
    let i = openParenIdx;

    while (i < src.length) {
        const ch = src[i];

        // Skip string literals so inner commas/parens are not counted.
        if (depth > 0 && (ch === '"' || ch === "'" || ch === '`')) {
            const q = ch;
            const isTemplate = q === '`';
            i++;
            while (i < src.length) {
                const c2 = src[i];
                if (c2 === '\\') { i += 2; continue; }
                if (isTemplate && c2 === '$' && src[i + 1] === '{') {
                    // Embedded expression — skip past matching '}'
                    i += 2;
                    let tdepth = 1;
                    while (i < src.length && tdepth > 0) {
                        if (src[i] === '{') tdepth++;
                        else if (src[i] === '}') tdepth--;
                        i++;
                    }
                    continue;
                }
                if (c2 === q) break;
                i++;
            }
        } else if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) {
                const text = src.slice(argStart, i).trim();
                // Only push non-empty trailing text (trailing commas produce empty strings)
                if (text) args.push(text);
                return { args, closePos: i };
            }
        } else if (ch === ',' && depth === 1) {
            args.push(src.slice(argStart, i).trim());
            argStart = i + 1;
        }

        i++;
    }
    return null; // unbalanced — leave untouched
}

// ── T1 ───────────────────────────────────────────────────────────────────────

/**
 * T1: Replace `@project-serum/anchor` with `@coral-xyz/anchor`.
 * Covers import strings, require() calls, and any string that contains the
 * old package name.
 */
export function fixProjectSerumImport(src) {
    return src.replace(/@project-serum\/anchor/g, '@coral-xyz/anchor');
}

// ── T2 ───────────────────────────────────────────────────────────────────────

/**
 * T2: Remove the second `programId` argument from `new Program(...)`.
 *
 * The Anchor 0.30 `Program` constructor signature changed from:
 *   new Program(idl, programId, provider?)
 * to:
 *   new Program(idl, provider?)
 *
 * Strategy: find every `new Program(` (with optional generic), extract the
 * balanced argument list, and remove arg[1] when there are exactly 3 args.
 * Uses the balanced-paren extractor to handle providers with nested `new`
 * expressions (e.g. `new AnchorProvider(connection, wallet, opts)`).
 *
 * Conservative: does NOT transform if arg count ≠ 3, preserving idempotency
 * and avoiding false positives on already-migrated code.
 */
export function fixProgramConstructor(src) {
    const re = /new\s+Program\s*(?:<[^>]*>)?\s*\(/g;
    let match;
    const replacements = [];

    while ((match = re.exec(src)) !== null) {
        // Skip matches inside line comments (// ...) or JSDoc/block comment lines (* ...)
        const lineStart = src.lastIndexOf('\n', match.index - 1) + 1;
        const linePrefix = src.slice(lineStart, match.index).trimStart();
        if (linePrefix.startsWith('//') || linePrefix.startsWith('*')) continue;

        const openParen = match.index + match[0].length - 1;
        const parsed = extractCallArgs(src, openParen);
        if (!parsed || parsed.args.length !== 3) continue;

        const { args, closePos } = parsed;
        // Rebuild: drop args[1] (the programId)
        const newCall =
            src.slice(match.index, openParen + 1) +
            args[0] + ', ' + args[2] +
            ')';

        replacements.push({
            start: match.index,
            end: closePos + 1,
            replacement: newCall,
        });
    }

    // Apply replacements in reverse order to maintain string indices
    let result = src;
    for (let i = replacements.length - 1; i >= 0; i--) {
        const { start, end, replacement } = replacements[i];
        result = result.slice(0, start) + replacement + result.slice(end);
    }
    return result;
}

// ── T3 ───────────────────────────────────────────────────────────────────────

/**
 * T3: Flag removed `.associated(` / `.associatedAddress(` method calls.
 *
 * `program.associated(...)`, `program.account.X.associated(...)` and
 * `program.account.X.associatedAddress(...)` were all removed in Anchor 0.30
 * (#2749). Replacement uses `getAssociatedTokenAddressSync` from
 * `@solana/spl-token` which requires knowing the mint and owner addresses.
 * Because the correct replacement depends on context, we insert a TODO comment
 * immediately before the call so developers can finish it manually.
 *
 * Avoids double-annotation on already-flagged lines.
 */
export function flagAssociatedMethods(src) {
    // Process line-by-line: only flag lines that contain an Anchor program/account
    // accessor, avoiding false positives on unrelated libraries that happen to
    // expose a method named `.associated(` or `.associatedAddress(`.
    const lines = src.split('\n');
    const result = lines.map(line => {
        // Skip lines that have no Anchor-specific context
        if (!/\bprogram\b|\baccount\b/i.test(line)) return line;

        // .associatedAddress( — flag first (more specific)
        line = line.replace(
            /(?<!anchor 0\.30[^\n]*)\.associatedAddress\s*\(/g,
            (m) => `/* TODO anchor 0.30: .associatedAddress() removed – use getAssociatedTokenAddressSync() from @solana/spl-token */${m}`,
        );

        // .associated( — skip lines already annotated by the above pass
        line = line.replace(
            /(?<!anchor 0\.30[^\n]*)\.associated\s*\(/g,
            (m) => `/* TODO anchor 0.30: .associated() removed – use getAssociatedTokenAddressSync() from @solana/spl-token */${m}`,
        );

        return line;
    });
    return result.join('\n');
}

// ── T4 ───────────────────────────────────────────────────────────────────────

/**
 * T4: Flag `anchor-deprecated-state` references.
 *
 * The `anchor-deprecated-state` feature and `#[state]` account type were
 * removed in Anchor 0.30 (#2717). Any TypeScript code referencing state
 * account helpers should be rewritten.
 */
export function flagDeprecatedState(src) {
    return src.replace(
        /anchor-deprecated-state/g,
        '/* TODO anchor 0.30: anchor-deprecated-state was removed (#2717) – rewrite using regular accounts */anchor-deprecated-state',
    );
}

// ── P1/P2 (package.json) ─────────────────────────────────────────────────────

/**
 * Migrate a `package.json` source string:
 * P1. `@coral-xyz/anchor` version from `0.29.x` to `0.30.1`
 * P2. `@project-serum/anchor` package key → `@coral-xyz/anchor`
 *
 * Returns null if no changes were needed.
 */
export function migratePackageJson(src) {
    let out = src;

    // P2: rename package key (do before P1 so P1 can catch renamed entry too)
    out = out.replace(/"@project-serum\/anchor"\s*:/g, '"@coral-xyz/anchor":');

    // P1: bump version — handles "0.29.0", "^0.29.0", "~0.29.0", "0.29.x"
    out = out.replace(
        /("@coral-xyz\/anchor"\s*:\s*"[~^]?)0\.29\.[^"]*"/g,
        '$10.30.1"',
    );

    return out === src ? null : out;
}

// ── top-level exports ─────────────────────────────────────────────────────────

/**
 * Migrate a TypeScript or JavaScript source file.
 * Returns null if no changes are needed (idempotent).
 */
export function migrateTypeScript(src) {
    let out = src;
    out = fixProjectSerumImport(out);
    out = fixProgramConstructor(out);
    out = flagAssociatedMethods(out);
    out = flagDeprecatedState(out);
    return out === src ? null : out;
}

/**
 * Route a file to the correct migration function based on its extension.
 * Returns null if no changes are needed.
 */
export function migrateFile(filename, src) {
    if (filename.endsWith('package.json')) return migratePackageJson(src);
    if (
        filename.endsWith('.ts') ||
        filename.endsWith('.tsx') ||
        filename.endsWith('.js') ||
        filename.endsWith('.jsx') ||
        filename.endsWith('.mjs') ||
        filename.endsWith('.cjs')
    ) {
        return migrateTypeScript(src);
    }
    return null;
}

// ── CLI (direct invocation) ──────────────────────────────────────────────────

import { readFileSync, writeFileSync, renameSync, readdirSync, statSync, lstatSync, realpathSync } from 'fs';
import { join, extname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out']);

function walkTs(dir, _visited = new Set()) {
    let realDir;
    try {
        realDir = realpathSync(dir);
    } catch {
        // Inaccessible or broken — skip silently
        return [];
    }
    if (_visited.has(realDir)) return [];
    _visited.add(realDir);

    let entries;
    try {
        entries = readdirSync(dir);
    } catch (err) {
        process.stderr.write(`walkTs: skipping directory (${err.code ?? err.message}): ${dir}\n`);
        return [];
    }

    const results = [];
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        let lst;
        try {
            lst = lstatSync(full);
        } catch {
            // Broken entry — skip
            continue;
        }
        if (lst.isSymbolicLink()) continue;
        if (lst.isDirectory()) {
            results.push(...walkTs(full, _visited));
        } else {
            const b = basename(full);
            if (
                b === 'package.json' ||
                extname(b) === '.ts' || extname(b) === '.tsx' ||
                extname(b) === '.js' || extname(b) === '.jsx' ||
                extname(b) === '.mjs' || extname(b) === '.cjs'
            ) {
                results.push(full);
            }
        }
    }
    return results;
}

// Only run CLI when this file is executed directly (not when imported as a module)
const _thisFile = resolve(fileURLToPath(import.meta.url));
const isDirectRun = process.argv[1] ? resolve(process.argv[1]) === _thisFile : false;

if (isDirectRun && process.argv[2]) {
    const target = process.argv[2];
    const files = lstatSync(target).isDirectory() ? walkTs(target) : [target];
    let changed = 0;
    for (const f of files) {
        const src = readFileSync(f, 'utf-8');
        const out = migrateFile(f, src);
        if (out !== null) {
            if (lstatSync(f).isSymbolicLink()) {
                console.error(`  skipped (symlink): ${f}`);
                continue;
            }
            const tmp = f + '.migrating.tmp';
            writeFileSync(tmp, out, 'utf-8');
            renameSync(tmp, f);
            console.log(`  updated: ${f}`);
            changed++;
        }
    }
    console.log(`\nDone. ${changed} file(s) changed out of ${files.length} scanned.`);
}
