/**
 * Anchor.toml + workspace Cargo.toml 0.29 -> 0.30 JSSG codemod
 *
 * Handles:
 *   A1 — Remove `seeds = false` from Anchor.toml [features] (removed in 0.30)
 *   A2 — Bump anchor_version to "0.30.1" in Anchor.toml if present
 *   R6 — Add `resolver = "2"` to workspace Cargo.toml [workspace] if missing
 */

// @ts-ignore
import { migrateAnchorToml, migrateCargoToml } from "../migrate-rust.mjs";

type CodemodOptions = { source?: string; path?: string;[key: string]: unknown };

const codemod = (sgRoot: any, options: CodemodOptions): string | undefined => {
    let src: string;
    try {
        src = typeof sgRoot?.text === "function"
            ? sgRoot.text()
            : (typeof sgRoot?.root === "function" ? sgRoot.root().text() : "");
    } catch { src = ""; }
    if (!src) src = options?.source ?? "";
    if (!src) return;

    let filePath = "";
    try {
        filePath = typeof sgRoot?.filename === "function" ? sgRoot.filename() : "";
    } catch { /* ignore */ }
    if (!filePath) filePath = options?.path ?? "";

    if (filePath.endsWith("Anchor.toml")) {
        const result = migrateAnchorToml(src);
        if (result !== null) return result;
    } else if (filePath.endsWith("Cargo.toml")) {
        // R6 only — full Cargo.toml migration is handled by codemod-rust.ts
        const result = migrateCargoToml(src);
        if (result !== null) return result;
    } else {
        // Path unknown — try Anchor.toml first, then Cargo.toml
        const r1 = migrateAnchorToml(src);
        if (r1 !== null) return r1;
        const r2 = migrateCargoToml(src);
        if (r2 !== null) return r2;
    }
};

export default codemod;
