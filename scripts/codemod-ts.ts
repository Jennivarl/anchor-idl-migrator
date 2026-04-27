/**
 * Anchor TypeScript/JavaScript client 0.29 → 0.30 JSSG codemod
 *
 * Handles:
 *   - TypeScript / JavaScript / JSX source files (.ts, .tsx, .js, .jsx, .mjs)
 *   - package.json dependency version updates
 *
 * Called by butterflow as: transform(sgRoot, options)
 */

// @ts-ignore
import { migrateFile } from "../migrate-ts.mjs";

type CodemodOptions = { source?: string; path?: string;[key: string]: unknown };

const codemod = (sgRoot: any, options: CodemodOptions): string | undefined => {
    // Get file source
    let src: string;
    try {
        src = typeof sgRoot?.text === "function"
            ? sgRoot.text()
            : (typeof sgRoot?.root === "function" ? sgRoot.root().text() : "");
    } catch { src = ""; }
    if (!src) src = options?.source ?? "";
    if (!src) return;

    // Get file path for routing
    let filePath = "";
    try {
        filePath = typeof sgRoot?.filename === "function" ? sgRoot.filename() : "";
    } catch { /* ignore */ }
    if (!filePath) filePath = options?.path ?? "";

    const result = migrateFile(filePath, src);
    if (result !== null) return result;
};

export default codemod;
