/**
 * real-world-migrate.mjs
 *
 * Reads every *_input.json from tests/real-world-output/, runs migrateIdl()
 * on each, writes *_migrated.json, then asserts V1 correctness.
 *
 * Run: node tests/real-world-migrate.mjs
 */
import { migrateIdl, isV1Idl } from '../migrate.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'real-world-output');

const inputFiles = fs.readdirSync(outDir).filter(f => f.endsWith('_input.json'));

if (inputFiles.length === 0) {
    console.log('No *_input.json files found in', outDir);
    console.log('Run node fetch-idls.mjs first to download fixtures.');
    process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];

for (const filename of inputFiles) {
    const fp = path.join(outDir, filename);
    const raw = fs.readFileSync(fp, 'utf8');
    const idl = JSON.parse(raw);
    const baseName = filename.replace('_input.json', '');

    // Skip if already v1
    if (isV1Idl(idl)) {
        console.log(`\nSKIP ${filename} — already v1`);
        continue;
    }

    const addr = idl.metadata?.address || idl.programId || '11111111111111111111111111111111';
    const t0 = Date.now();
    let result;
    try {
        result = migrateIdl(idl, addr);
    } catch (e) {
        console.log(`\n❌ CRASH ${filename}: ${e.message}`);
        failed++;
        failures.push({ file: filename, reason: 'crashed: ' + e.message });
        continue;
    }
    const elapsed = Date.now() - t0;

    const v1 = result.idl ?? result;
    const notices = result.notices ?? [];
    const serialized = JSON.stringify(v1);

    // Save migrated output
    const outPath = path.join(outDir, baseName + '_migrated.json');
    fs.writeFileSync(outPath, JSON.stringify(v1, null, 2) + '\n');

    // Assertions
    const checks = [];

    // 1. Required top-level keys
    const REQUIRED = ['address', 'metadata', 'instructions'];
    for (const k of REQUIRED) {
        checks.push({ name: `has '${k}'`, pass: k in v1 });
    }

    // 2. metadata.spec
    checks.push({ name: 'metadata.spec === "0.1.0"', pass: v1.metadata?.spec === '0.1.0' });

    // 3. All instructions have 8-byte discriminators
    const allHaveDisc = Array.isArray(v1.instructions) && v1.instructions.length > 0
        && v1.instructions.every(i => Array.isArray(i.discriminator) && i.discriminator.length === 8);
    checks.push({ name: 'all instructions have 8-byte discriminator', pass: allHaveDisc });

    // 4. No v0 field names leaked
    checks.push({ name: 'no "isMut" in output', pass: !serialized.includes('"isMut"') });
    checks.push({ name: 'no "isSigner" in output', pass: !serialized.includes('"isSigner"') });
    checks.push({ name: 'no "publicKey" type in output', pass: !serialized.includes('"publicKey"') });

    // 5. Types deduplication (no duplicate type names)
    const typeNames = (v1.types || []).map(t => t.name);
    const uniqueTypeNames = new Set(typeNames);
    checks.push({ name: 'no duplicate type names', pass: typeNames.length === uniqueTypeNames.size });

    // 6. address is a non-empty string
    checks.push({ name: 'address is non-empty string', pass: typeof v1.address === 'string' && v1.address.length > 0 });

    // 7. isV1Idl() recognises the output as v1
    checks.push({ name: 'isV1Idl(output) === true', pass: isV1Idl(v1) });

    const filePassed = checks.every(c => c.pass);
    if (filePassed) passed++;
    else {
        failed++;
        failures.push({ file: filename, checks: checks.filter(c => !c.pass) });
    }

    const badge = filePassed ? '✅ PASS' : '❌ FAIL';
    console.log(`\n${'─'.repeat(64)}`);
    console.log(`${badge}  ${filename}  [${elapsed}ms]`);
    console.log(`  instructions : ${(v1.instructions || []).length}`);
    console.log(`  accounts     : ${(v1.accounts || []).length}`);
    console.log(`  types        : ${(v1.types || []).length}`);
    console.log(`  events       : ${(v1.events || []).length}`);
    if (v1.instructions && v1.instructions[0]) {
        const ix = v1.instructions[0];
        console.log(`  sample instr : ${ix.name}  disc=[${ix.discriminator.join(',')}]`);
    }
    if (!filePassed) {
        for (const c of checks.filter(c => !c.pass)) {
            console.log(`  FAIL  ${c.name}`);
        }
    }
    if (notices.length) {
        console.log(`  notices:`);
        notices.slice(0, 5).forEach(n => console.log(`    > ${n}`));
        if (notices.length > 5) console.log(`    ...and ${notices.length - 5} more`);
    }
}

console.log(`\n${'═'.repeat(64)}`);
console.log(`REAL-WORLD MIGRATION: ${passed} passed, ${failed} failed`);
if (failures.length) {
    console.log('\nFailed files:');
    for (const f of failures) {
        console.log(`  ${f.file}`);
        if (f.reason) console.log(`    ${f.reason}`);
        if (f.checks) f.checks.forEach(c => console.log(`    - ${c.name}`));
    }
}
process.exit(failed > 0 ? 1 : 0);
