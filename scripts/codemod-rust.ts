/**
 * Anchor Rust 0.29 -> 0.30 JSSG codemod
 *
 * The butterflow runtime passes the ast-grep root node as the first argument.
 * File content is retrieved via sgRoot.text(). options.path contains the file path.
 */

// @ts-ignore
import { migrateRustSource, migrateCargoToml, migrateAnchorToml } from "../migrate-rust.mjs";

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

    // Try sgRoot.filename() first (ast-grep SgRoot API), fall back to options.path
    let filePath = "";
    try {
        filePath = typeof sgRoot?.filename === "function" ? sgRoot.filename() : "";
    } catch { /* ignore */ }
    if (!filePath) filePath = options?.path ?? "";

    if (filePath.endsWith("Anchor.toml")) {
        const result = migrateAnchorToml(src);
        if (result !== null) return result;
    } else if (filePath.endsWith("Cargo.toml")) {
        const result = migrateCargoToml(src);
        if (result !== null) return result;
    } else if (filePath.endsWith(".rs")) {
        const result = migrateRustSource(src);
        if (result !== null) return result;
    } else {
        // Path unknown — try Anchor.toml first, then Cargo.toml, then .rs
        const r0 = migrateAnchorToml(src);
        if (r0 !== null) return r0;
        const r1 = migrateCargoToml(src);
        if (r1 !== null) return r1;
        const r2 = migrateRustSource(src);
        if (r2 !== null) return r2;
    }
};

export default codemod;
