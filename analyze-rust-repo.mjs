/**
 * analyze-rust-repo.mjs
 *
 * Dry-runs migrate-rust.mjs on a real Anchor repository (no writes).
 * Reports every pattern found, every transformation applied, and any
 * OLD patterns that remain in the output (= gaps to fix).
 *
 * Run:
 *   node analyze-rust-repo.mjs <path-to-repo>
 *
 * Example:
 *   node analyze-rust-repo.mjs C:/Users/USER/liquid-staking-program
 */
import { migrateRustSource, migrateCargoToml, migrateAnchorToml } from './migrate-rust.mjs';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';

const repoPath = process.argv[2];
if (!repoPath) {
    console.error('Usage: node analyze-rust-repo.mjs <path-to-repo>');
    process.exit(1);
}

function walk(dir) {
    const result = [];
    for (const entry of readdirSync(dir)) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'target') continue;
        const full = join(dir, entry);
        try {
            const s = statSync(full);
            if (s.isDirectory()) result.push(...walk(full));
            else if (entry === 'Cargo.toml' || entry === 'Anchor.toml' || extname(entry) === '.rs') result.push(full);
        } catch { /* skip permission errors */ }
    }
    return result;
}

// Patterns that indicate OLD (un-migrated) Anchor 0.29 code in the OUTPUT
const OLD_PATTERNS = [
    { name: 'bumps.get()', re: /ctx\.bumps\.get\(/ },
    { name: 'bumps["name"]', re: /ctx\.bumps\["/ },
    // Only flag bare `-> ProgramResult`, NOT qualified paths like `::ProgramResult`
    { name: 'ProgramResult (bare)', re: /-> ProgramResult\b/ },
    { name: 'CLOSED_ACCOUNT_DISCRIMINATOR', re: /CLOSED_ACCOUNT_DISCRIMINATOR/ },
    { name: 'anchor 0.29 version', re: /anchor-(?:lang|spl)\s*=.*0\.29\./ },
    { name: 'seeds feature', re: /"seeds"/ },
    { name: 'seeds = false (Anchor.toml)', re: /seeds\s*=\s*false/ },
];

const files = walk(repoPath);
console.log(`\nAnalyzing ${files.length} files in: ${repoPath}\n`);

let totalChanged = 0;
let totalResidual = 0;
const changedFiles = [];
const residualIssues = [];

for (const fp of files) {
    const rel = relative(repoPath, fp);
    const src = readFileSync(fp, 'utf-8');
    const isAnchorToml = fp.endsWith('Anchor.toml');
    const isCargo = !isAnchorToml && fp.endsWith('Cargo.toml');
    const result = isAnchorToml ? migrateAnchorToml(src)
        : isCargo ? migrateCargoToml(src)
            : migrateRustSource(src);

    if (result !== null) {
        // Something was changed
        totalChanged++;
        const output = result;
        // Compute what changed (line-by-line diff summary)
        const srcLines = src.split('\n');
        const outLines = output.split('\n');
        const changes = [];
        const maxLen = Math.max(srcLines.length, outLines.length);
        for (let i = 0; i < maxLen; i++) {
            if (srcLines[i] !== outLines[i]) {
                changes.push({ line: i + 1, before: srcLines[i], after: outLines[i] });
            }
        }
        changedFiles.push({ file: rel, changes });

        // Check for residual old patterns in output
        const residuals = [];
        for (const { name, re } of OLD_PATTERNS) {
            const matches = (output.match(new RegExp(re.source, 'gm')) || []);
            if (matches.length > 0) residuals.push({ pattern: name, count: matches.length });
        }
        if (residuals.length) {
            totalResidual++;
            residualIssues.push({ file: rel, residuals });
        }
    } else {
        // No changes — check if old patterns are present in original
        const residuals = [];
        for (const { name, re } of OLD_PATTERNS) {
            const matches = (src.match(new RegExp(re.source, 'gm')) || []);
            if (matches.length > 0) residuals.push({ pattern: name, count: matches.length });
        }
        if (residuals.length) {
            totalResidual++;
            residualIssues.push({ file: rel, residuals, unchanged: true });
        }
    }
}

// ── Report ─────────────────────────────────────────────────────────────────

console.log('═'.repeat(64));
console.log(`CHANGED FILES: ${totalChanged} of ${files.length}`);
console.log('─'.repeat(64));

for (const { file, changes } of changedFiles) {
    console.log(`\n  📄 ${file}  (${changes.length} line changes)`);
    for (const { line, before, after } of changes.slice(0, 8)) {
        console.log(`    L${line}  - ${(before || '').trimEnd().slice(0, 100)}`);
        console.log(`    L${line}  + ${(after || '').trimEnd().slice(0, 100)}`);
    }
    if (changes.length > 8) console.log(`    ... and ${changes.length - 8} more changes`);
}

if (totalResidual > 0) {
    console.log('\n' + '═'.repeat(64));
    console.log(`⚠️  RESIDUAL OLD PATTERNS (= GAPS TO FIX): ${totalResidual} files`);
    console.log('─'.repeat(64));
    for (const { file, residuals, unchanged } of residualIssues) {
        const tag = unchanged ? '  [not changed by migrator]' : '  [still present after migration]';
        console.log(`\n  ⚠  ${file}${tag}`);
        for (const { pattern, count } of residuals) {
            console.log(`       ${count}x  ${pattern}`);
        }
    }
} else {
    console.log('\n✅  No residual old patterns found in migrated output!');
}

console.log('\n' + '═'.repeat(64));
console.log(`SUMMARY: ${totalChanged} files transformed, ${totalResidual} files with residual issues`);
process.exit(totalResidual > 0 ? 1 : 0);
