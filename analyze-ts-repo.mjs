/**
 * analyze-ts-repo.mjs
 *
 * Dry-runs migrate-ts.mjs on a TypeScript/JavaScript repository (no writes).
 * Reports every file changed, the transformations applied, and any OLD
 * patterns that remain in the output (= migration gaps).
 *
 * Run:
 *   node analyze-ts-repo.mjs <path-to-repo>
 *
 * Example:
 *   node analyze-ts-repo.mjs C:/Users/USER/protocol-v2/sdk/src
 */
import { migrateFile } from './migrate-ts.mjs';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, basename, relative } from 'path';

const repoPath = process.argv[2];
if (!repoPath) {
    console.error('Usage: node analyze-ts-repo.mjs <path-to-repo>');
    process.exit(1);
}

// Directories to skip
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'target', '.cache']);

function walk(dir) {
    const result = [];
    let entries;
    try { entries = readdirSync(dir); } catch { return result; }

    for (const entry of entries) {
        if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        let s;
        try { s = statSync(full); } catch { continue; }
        if (s.isDirectory()) {
            result.push(...walk(full));
        } else {
            const ext = extname(entry);
            const isTs = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
            const isPkg = entry === 'package.json';
            if (isTs || isPkg) result.push(full);
        }
    }
    return result;
}

// Patterns that indicate OLD (un-migrated) Anchor 0.29 code in the OUTPUT
const OLD_PATTERNS = [
    {
        name: '@project-serum/anchor import',
        re: /@project-serum\/anchor/,
    },
    {
        name: 'new Program(idl, programId, provider) [3-arg]',
        // Matches new Program( or new Program<T>( followed by 2 commas before closing )
        // This is approximate — catches obvious 3-arg inline forms
        re: /new\s+(?:\w+\.)?Program\s*(?:<[^>]*>)?\s*\([^)]*,[^)]*,[^)]*\)/,
    },
    {
        // Only flag .associated( that is NOT already prefixed by a T3 TODO comment
        name: '.associated( call (unflagged)',
        re: /(?<!\*\/)\.associated\s*\(/,
    },
    {
        // Only flag .associatedAddress( that is NOT already prefixed by a T3 TODO comment
        name: '.associatedAddress( call (unflagged)',
        re: /(?<!\*\/)\.associatedAddress\s*\(/,
    },
    {
        name: 'anchor-deprecated-state feature (unflagged)',
        re: /(?<!TODO anchor 0\.30[^\n]{0,300})anchor-deprecated-state/,
    },
    {
        name: '@project-serum/anchor in package.json',
        re: /"@project-serum\/anchor"\s*:/,
    },
];

const files = walk(repoPath);
console.log(`\nAnalyzing ${files.length} TS/JS/package.json files in: ${repoPath}\n`);

let totalChanged = 0;
let totalResidual = 0;
let totalFp = 0;
const changedFiles = [];
const residualIssues = [];
const falsePositiveCandidates = [];

for (const fp of files) {
    const rel = relative(repoPath, fp);
    const src = readFileSync(fp, 'utf-8');
    const result = migrateFile(fp, src);

    if (result !== null && result !== src) {
        totalChanged++;
        const srcLines = src.split('\n');
        const outLines = result.split('\n');
        const changes = [];
        const maxLen = Math.max(srcLines.length, outLines.length);
        for (let i = 0; i < maxLen; i++) {
            if (srcLines[i] !== outLines[i]) {
                changes.push({ line: i + 1, before: srcLines[i], after: outLines[i] });
            }
        }
        changedFiles.push({ file: rel, changes });

        // Check residual old patterns in OUTPUT
        // Strip lines that contain TODO-anchor annotations before checking,
        // so that the .associated() inside the TODO comment text itself isn't counted.
        const outputForCheck = result.split('\n')
            .filter(l => !l.includes('TODO anchor 0.30'))
            .join('\n');
        const residuals = [];
        for (const { name, re } of OLD_PATTERNS) {
            const matches = (outputForCheck.match(new RegExp(re.source, 'gm')) || []);
            if (matches.length > 0) residuals.push({ pattern: name, count: matches.length });
        }
        if (residuals.length) {
            totalResidual++;
            residualIssues.push({ file: rel, residuals });
        }
    } else if (result === null || result === src) {
        // No change — check if old patterns exist in original (false negatives = gaps)
        const srcForCheck = src.split('\n')
            .filter(l => !l.includes('TODO anchor 0.30'))
            .join('\n');
        const residuals = [];
        for (const { name, re } of OLD_PATTERNS) {
            const matches = (srcForCheck.match(new RegExp(re.source, 'gm')) || []);
            if (matches.length > 0) residuals.push({ pattern: name, count: matches.length });
        }
        if (residuals.length) {
            totalResidual++;
            residualIssues.push({ file: rel, residuals, unchanged: true });
        }
    }
}

// ── Report ─────────────────────────────────────────────────────────────────

console.log('═'.repeat(70));
console.log(`CHANGED FILES: ${totalChanged} of ${files.length}`);
console.log('─'.repeat(70));

for (const { file, changes } of changedFiles) {
    console.log(`\n  📄 ${file}  (${changes.length} line changes)`);
    for (const { line, before, after } of changes.slice(0, 10)) {
        console.log(`    L${line}  - ${(before || '').trimEnd().slice(0, 110)}`);
        console.log(`    L${line}  + ${(after || '').trimEnd().slice(0, 110)}`);
    }
    if (changes.length > 10) console.log(`    ... and ${changes.length - 10} more changes`);
}

if (totalResidual > 0) {
    console.log('\n' + '═'.repeat(70));
    console.log(`⚠️  RESIDUAL OLD PATTERNS (= GAPS / FALSE NEGATIVES): ${totalResidual} files`);
    console.log('─'.repeat(70));
    for (const { file, residuals, unchanged } of residualIssues) {
        const tag = unchanged ? ' [no migration applied]' : ' [after migration]';
        console.log(`\n  ⚠️  ${file}${tag}`);
        for (const { pattern, count } of residuals) {
            console.log(`       - "${pattern}" appears ${count}×`);
        }
    }
} else {
    console.log('\n✅ No residual old patterns found in output.');
}

console.log('\n' + '═'.repeat(70));
console.log('SUMMARY');
console.log('─'.repeat(70));
console.log(`  Files scanned:    ${files.length}`);
console.log(`  Files changed:    ${totalChanged}`);
console.log(`  Residual issues:  ${totalResidual}`);
console.log('═'.repeat(70) + '\n');
