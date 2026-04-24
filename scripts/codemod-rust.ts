/**
 * Anchor Rust 0.29 → 0.30 JSSG codemod
 *
 * Invoked by the Codemod workflow for each .rs and Cargo.toml file that
 * matches the include patterns. Applies all Rust-level breaking-change rules:
 *
 *   R1. ctx.bumps.get("name").unwrap() / ctx.bumps["name"]  →  ctx.bumps.name
 *   R2. Cargo.toml: anchor-lang/anchor-spl 0.29.x → 0.30.1,
 *       adds idl-build feature, adds overflow-checks = true
 *   R3. CLOSED_ACCOUNT_DISCRIMINATOR → TODO comment
 *   R4. #[account(bump = ctx.bumps["name"])]  →  bump = ctx.bumps.name
 *   R5. -> ProgramResult  →  -> Result<()>
 *
 * Migration logic lives in ../migrate-rust.mjs — single source of truth.
 */

import { readFileSync, writeFileSync } from "fs";
// @ts-ignore
import { migrateRustSource, migrateCargoToml } from "../migrate-rust.mjs";

type CodemodOptions = { path?: string;[key: string]: unknown };

const codemod = async (_root: unknown, options: CodemodOptions) => {
    const filePath = options.path;
    if (!filePath) return;

    let src: string;
    try {
        src = readFileSync(filePath, "utf-8");
    } catch {
        return;
    }

    let result: string | null = null;

    if (filePath.endsWith("Cargo.toml")) {
        result = migrateCargoToml(src);
    } else if (filePath.endsWith(".rs")) {
        result = migrateRustSource(src);
    }

    if (result !== null) {
        writeFileSync(filePath, result, "utf-8");
    }
};

export default codemod;
