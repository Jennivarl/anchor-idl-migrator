/**
 * Anchor IDL v0 -> v1 JSSG codemod
 *
 * Called by butterflow as: transform(sgRoot, options)
 * where sgRoot is the ast-grep root node for the file.
 * Source text: sgRoot.text() or sgRoot.root().text()
 *
 * Return a string to write new content, or undefined to leave unchanged.
 */

// @ts-ignore
import { migrateIdl } from "../migrate.mjs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const codemod = (sgRoot: any, options: any): string | undefined => {
    // Get the file source text from the ast-grep root node
    let raw: string;
    try {
        raw = typeof sgRoot?.text === "function"
            ? sgRoot.text()
            : (typeof sgRoot?.root === "function" ? sgRoot.root().text() : "");
    } catch {
        raw = "";
    }

    // Fallback to options.source if sgRoot.text() is unavailable
    if (!raw) raw = options?.source ?? "";
    if (!raw) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let idl: any;
    try {
        idl = JSON.parse(raw);
    } catch {
        return;
    }

    if (idl?.metadata?.spec != null) return;
    if (!Array.isArray(idl?.instructions)) return;

    const v1 = migrateIdl(idl);
    return JSON.stringify(v1, null, 2) + "\n";
};

export default codemod;
