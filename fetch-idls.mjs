/**
 * fetch-idls.mjs — downloads real v0 IDL fixtures from GitHub for testing.
 * Run: node fetch-idls.mjs
 */
import https from 'https';
import { writeFileSync, mkdirSync } from 'fs';

const dir = 'tests/real-world-output';
mkdirSync(dir, { recursive: true });

const idls = [
    {
        name: 'drift_v2',
        url: 'https://raw.githubusercontent.com/drift-labs/protocol-v2/master/sdk/src/idl/drift.json',
    },
    {
        name: 'whirlpool',
        url: 'https://raw.githubusercontent.com/orca-so/whirlpools/main/programs/whirlpool/idl/whirlpool.json',
    },
    {
        name: 'mango_v4',
        url: 'https://raw.githubusercontent.com/blockworks-foundation/mango-v4/main/target/idl/mango_v4.json',
    },
    {
        name: 'marinade_staking',
        url: 'https://raw.githubusercontent.com/marinade-finance/liquid-staking-program/main/target/idl/marinade_finance.json',
    },
];

function get(url, redirects) {
    if (redirects === undefined) redirects = 0;
    return new Promise(function (resolve, reject) {
        if (redirects > 5) { reject(new Error('too many redirects')); return; }
        var req = https.get(url, { timeout: 25000 }, function (res) {
            if (res.statusCode === 301 || res.statusCode === 302) {
                var location = res.headers.location;
                if (typeof location !== 'string' || !location.startsWith('https://')) {
                    reject(new Error('Redirect blocked: location must be an https:// URL, got: ' + location));
                    return;
                }
                get(location, redirects + 1).then(resolve).catch(reject);
                return;
            }
            var chunks = [];
            res.on('data', function (d) { chunks.push(d); });
            res.on('end', function () {
                resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', function () { req.destroy(); reject(new Error('timeout')); });
    });
}

for (var i = 0; i < idls.length; i++) {
    var name = idls[i].name;
    var url = idls[i].url;
    try {
        var result = await get(url);
        if (result.status === 200) {
            var parsed = JSON.parse(result.body);
            var instrs = parsed.instructions ? parsed.instructions.length : '?';
            var isV0 = ('version' in parsed) && !('metadata' in parsed);
            var isV1 = ('metadata' in parsed) && parsed.metadata && ('spec' in parsed.metadata);
            writeFileSync(dir + '/' + name + '_input.json', result.body, 'utf-8');
            console.log('OK  ' + name + ': ' + result.body.length + ' bytes | instructions=' + instrs + ' | v0=' + isV0 + ' | v1=' + isV1);
        } else {
            console.log('404 ' + name + ': HTTP ' + result.status);
        }
    } catch (e) {
        console.log('ERR ' + name + ': ' + e.message);
    }
}
console.log('\nDone. Files written to ' + dir);
