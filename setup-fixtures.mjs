import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const base = path.dirname(fileURLToPath(import.meta.url));

const fixtures = [
    {
        dir: 'marinade-finance',
        input: 'C:/Users/USER/marinade-ts-sdk/src/programs/idl/json/marinade_finance.json',
        expected: 'tests/real-world-output/marinade_finance_v1.json',
    },
    {
        dir: 'spl-account-compression',
        input: 'C:/Users/USER/solana-real-repos/solana-program-library/account-compression/sdk/idl/spl_account_compression.json',
        expected: 'tests/real-world-output/spl_account_compression_v1.json',
    },
    {
        dir: 'spl-managed-token',
        input: 'C:/Users/USER/solana-real-repos/solana-program-library/managed-token/sdk/idl/spl_managed_token.json',
        expected: 'tests/real-world-output/spl_managed_token_v1.json',
    },
];

for (const f of fixtures) {
    const dir = path.join(base, 'tests', f.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(f.input, path.join(dir, 'input.json'));
    fs.copyFileSync(path.join(base, f.expected), path.join(dir, 'expected.json'));
    console.log('✅', f.dir, '→ input.json + expected.json');
}

// List all test fixtures
console.log('\nAll test fixtures:');
function listDir(d, indent = '') {
    for (const f of fs.readdirSync(d)) {
        const fp = path.join(d, f);
        const stat = fs.statSync(fp);
        if (stat.isDirectory()) { console.log(indent + f + '/'); listDir(fp, indent + '  '); }
        else console.log(indent + f, `(${Math.round(stat.size / 1024)}KB)`);
    }
}
listDir(path.join(base, 'tests'));
