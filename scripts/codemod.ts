/**
 * Anchor IDL v0 → v1 JSSG codemod
 *
 * This script is invoked by the Codemod workflow for each JSON file that
 * matches the include patterns. It parses the file as an Anchor v0 IDL and
 * rewrites it in v1 format in-place.
 *
 * All 12 documented transform rules are applied deterministically.
 * Zero false positives: files that are already v1 (metadata.spec present)
 * or are not Anchor IDLs are skipped silently.
 *
 * Migration logic lives in ../migrate.mjs — single source of truth.
 */

import { readFileSync, writeFileSync } from "fs";
// @ts-ignore — migrate.mjs is plain ESM JS; Rolldown bundles it correctly
import { migrateIdl } from "../migrate.mjs";

// Inline type — avoids dependency on @codemod-utils/codemod-types
type CodemodOptions = { path?: string;[key: string]: unknown };

// ---------------------------------------------------------------------------
// JSSG codemod entry point
// ---------------------------------------------------------------------------

const codemod = async (_root: unknown, options: CodemodOptions) => {
    const filePath = options.path;
    if (!filePath) return;

    let raw: string;
    try {
        raw = readFileSync(filePath, "utf-8");
    } catch {
        return; // unreadable — skip
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let idl: any;
    try {
        idl = JSON.parse(raw);
    } catch {
        return; // not valid JSON — skip silently
    }

    // Skip if already v1 (has metadata.spec)
    if (idl?.metadata?.spec != null) return;

    // Skip if clearly not an Anchor IDL (must have instructions array)
    if (!Array.isArray(idl?.instructions)) return;

    const v1 = migrateIdl(idl);
    writeFileSync(filePath, JSON.stringify(v1, null, 2) + "\n", "utf-8");
};

export default codemod;
