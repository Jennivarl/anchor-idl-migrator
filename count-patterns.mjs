import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

function walk(dir) {
    const r = [];
    for (const e of readdirSync(dir)) {
        if (e === 'target' || e === '.git') continue;
        const f = join(dir, e);
        try {
            if (statSync(f).isDirectory()) r.push(...walk(f));
            else if (e === 'Cargo.toml' || extname(e) === '.rs') r.push(f);
        } catch { /* skip */ }
    }
    return r;
}

const dir = process.argv[2] || 'C:/Users/USER/protocol-v2/programs/drift';
const files = walk(dir);

const patterns = [
    { name: 'anchor 0.29 dep (Cargo.toml)', re: /anchor-(?:lang|spl)\s*=.*0\.29\./ },
    { name: 'qualified ProgramResult (->)', re: /-> anchor_lang::solana_program::entrypoint::ProgramResult/ },
    { name: 'bare ProgramResult (->)', re: /-> ProgramResult\b/ },
    { name: 'ctx.bumps.get()', re: /ctx\.bumps\.get\(/ },
    { name: 'ctx.bumps["name"]', re: /ctx\.bumps\["/ },
    { name: 'CLOSED_ACCOUNT_DISCRIMINATOR', re: /CLOSED_ACCOUNT_DISCRIMINATOR/ },
    { name: 'seeds feature in Cargo', re: /"seeds"/ },
    { name: 'use.*ProgramResult import', re: /use\s+\S*ProgramResult/ },
    { name: 'anchor-deprecated-state', re: /anchor-deprecated-state/ },
];

const counts = {};
for (const p of patterns) counts[p.name] = 0;

for (const fp of files) {
    const src = readFileSync(fp, 'utf-8');
    for (const p of patterns) {
        const m = src.match(new RegExp(p.re.source, 'g'));
        if (m) counts[p.name] += m.length;
    }
}

console.log(`\nPattern counts across ${files.length} files in: ${dir}\n`);
let total = 0;
for (const [k, v] of Object.entries(counts)) {
    if (v > 0) {
        console.log(`  PRESENT  ${v.toString().padStart(4)}x  ${k}`);
        total += v;
    }
}
console.log('');
for (const [k, v] of Object.entries(counts)) {
    if (v === 0) console.log(`  absent         ${k}`);
}
console.log(`\nTotal migration pattern occurrences: ${total}`);
