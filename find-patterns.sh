#!/usr/bin/env bash
URLS=(
  "https://raw.githubusercontent.com/orca-so/whirlpools/main/legacy-sdk/whirlpool/src/idl/whirlpool.json"
  "https://raw.githubusercontent.com/orca-so/whirlpools/main/packages/whirlpools-sdk/src/idl/whirlpool.json"
  "https://raw.githubusercontent.com/coral-xyz/anchor/v0.29.0/tests/idl/tests/programs/idl-test/idl-test.json"
  "https://raw.githubusercontent.com/marinade-finance/liquid-staking-program/main/idl/marinade_finance.json"
  "https://raw.githubusercontent.com/solana-labs/solana-program-library/master/stake-pool/program/target/idl/spl_stake_pool.json"
  "https://raw.githubusercontent.com/solend-protocol/solend-sdk/main/src/idl/solend.json"
  "https://raw.githubusercontent.com/coral-xyz/anchor/v0.28.0/tests/idl/tests/programs/idl-test/idl-test.json"
)
for url in "${URLS[@]}"; do
  name=$(basename "$url")
  curl -sf "$url" -o "/tmp/$name" 2>/dev/null || { echo "FAILED $url"; continue; }
  sz=$(stat -c%s "/tmp/$name" 2>/dev/null || echo 0)
  echo "OK $name (${sz}b)"
  for pat in '"coption"' 'definedWithTypeArgs' 'genericLenArray' '"alias"'; do
    cnt=$(grep -c "$pat" "/tmp/$name" 2>/dev/null || true)
    [ "$cnt" -gt 0 ] && echo "  FOUND $pat ($cnt times)" && grep -m1 "$pat" "/tmp/$name"
  done
done
