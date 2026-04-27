// Test what the bundled codemod function actually does when invoked
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CACHE = '/home/varl/.local/share/codemod/cache/packages/global/anchor-idl-v0-to-v1/0.1.7';
const TEST_FILE = CACHE + '/tests/real-world-codemod-test/sdk/src/idl/token_faucet.json';
// Use v0.1.6 bundled script (v0.1.7 crashes due to appendFileSync)
const SCRIPT_CACHE = '/home/varl/.local/share/codemod/cache/packages/global/anchor-idl-v0-to-v1/0.1.6';
const SCRIPT = SCRIPT_CACHE + '/scripts/codemod.ts';

const source = readFileSync(TEST_FILE, 'utf-8');
console.log('source length:', source.length, '| first key:', Object.keys(JSON.parse(source))[0]);

// Load and eval the bundled script
let code = readFileSync(SCRIPT, 'utf-8');
// Remove the export line
code = code.replace('var codemod_default = codemod;', '');
// Remove the CLI invocation guard (it references process.argv)
const AsyncFunction = (async function () { }).constructor;
const fn = new AsyncFunction('require', 'process', code + '\n return codemod;');
const require = createRequire(import.meta.url);

let codemod;
try {
    codemod = await fn(require, process);
} catch (e) {
    console.error('eval error:', e.message);
    process.exit(1);
}

console.log('codemod type:', typeof codemod);

// Test 1: path + source
const r1 = codemod({}, { path: TEST_FILE, source });
console.log('Test 1 (path+source):', r1 === undefined ? 'UNDEFINED' : `string[${r1.length}]`);

// Test 2: path only  
const r2 = codemod({}, { path: TEST_FILE });
console.log('Test 2 (path only):', r2 === undefined ? 'UNDEFINED' : `string[${r2.length}]`);

// Test 3: check the first few steps manually
const parsed = JSON.parse(source);
console.log('parsed.metadata?.spec:', parsed?.metadata?.spec);
console.log('Array.isArray(parsed.instructions):', Array.isArray(parsed.instructions));
console.log('instructions count:', parsed.instructions?.length);
