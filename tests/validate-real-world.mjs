import { migrateIdl, isV1Idl } from '../migrate.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const targets = [
    'C:/Users/USER/marinade-ts-sdk/src/programs/idl/json/marinade_finance.json',
    'C:/Users/USER/marinade-ts-sdk/src/programs/idl/json/marinade_referral.json',
    'C:/Users/USER/solana-real-repos/solana-program-library/account-compression/sdk/idl/spl_account_compression.json',
    'C:/Users/USER/solana-real-repos/solana-program-library/managed-token/sdk/idl/spl_managed_token.json',
];

const REQUIRED_KEYS = ['address', 'metadata', 'instructions', 'accounts', 'events', 'errors', 'types', 'constants'];
const outDir = path.join(__dirname, 'real-world-output');
fs.mkdirSync(outDir, { recursive: true });

let allPassed = true;

for (const fp of targets) {
    const raw = fs.readFileSync(fp, 'utf8');
    const idl = JSON.parse(raw);
    const basename = path.basename(fp);

    if (isV1Idl(idl)) {
        console.log('SKIP (already v1):', basename);
        continue;
    }

    const addr = idl.metadata?.address || idl.programId || '11111111111111111111111111111111';
    const start = Date.now();
    const result = migrateIdl(idl, addr);
    const elapsed = Date.now() - start;
    const v1 = result.idl ?? result;
    const notices = result.notices ?? [];
    const serialized = JSON.stringify(v1);

    // Write output
    const outName = path.basename(fp, '.json') + '_v1.json';
    fs.writeFileSync(path.join(outDir, outName), JSON.stringify(v1, null, 2) + '\n');

    // Validate
    const missing = REQUIRED_KEYS.filter(k => !(k in v1));
    const seenNames = new Set();
    const hasDupTypes = v1.types.some(t => { if (seenNames.has(t.name)) return true; seenNames.add(t.name); return false; });
    const allHaveDisc = v1.instructions.every(i => Array.isArray(i.discriminator) && i.discriminator.length === 8);
    const isMutLeaked = serialized.includes('"isMut"');
    const pubkeyLeaked = serialized.includes('"publicKey"');
    const hasSpec = v1.metadata?.spec === '0.1.0';

    const pass = missing.length === 0 && !hasDupTypes && allHaveDisc && !isMutLeaked && !pubkeyLeaked && hasSpec;
    if (!pass) allPassed = false;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`FILE    : ${basename}  [${elapsed}ms]`);
    console.log(`STATUS  : ${pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`spec    : ${v1.metadata?.spec ?? 'MISSING'}`);
    console.log(`address : ${v1.address?.slice(0, 44)}`);
    console.log(`missing : ${missing.length ? missing.join(', ') : 'none'}`);
    console.log(`8b discs: ${allHaveDisc ? 'ALL OK' : 'FAIL'}`);
    console.log(`dup type: ${hasDupTypes ? 'YES BUG' : 'none'}`);
    console.log(`isMut   : ${isMutLeaked ? 'LEAKED BUG' : 'clean'}`);
    console.log(`pubkey  : ${pubkeyLeaked ? 'LEAKED BUG' : 'clean'}`);
    console.log(`instrs  : ${v1.instructions.length} | accounts: ${v1.accounts.length} | types: ${v1.types.length} | events: ${v1.events.length}`);
    if (notices.length) {
        console.log(`notices :`);
        notices.forEach(n => console.log(`  > ${n}`));
    }

    // Sample first instruction discriminator for spot-check
    if (v1.instructions[0]) {
        const ix = v1.instructions[0];
        console.log(`sample  : ${ix.name} disc=[${ix.discriminator.join(',')}]`);
    }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`\nOVERALL: ${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
process.exit(allPassed ? 0 : 1);
