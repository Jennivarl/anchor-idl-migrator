/**
 * Anchor IDL v0 → v1 JSSG codemod
 *
 * This script is invoked by the Codemod workflow for each JSON file that
 * matches the include patterns. It parses the file as an Anchor v0 IDL and
 * rewrites it in v1 format in-place.
 *
 * All 12 documented transform rules are applied deterministically:
 *   1.  name + version  → metadata: { name, version, spec, description }
 *   2.  isMut: true     → writable: true
 *   3.  isSigner: true  → signer: true
 *   4.  "publicKey"     → "pubkey"
 *   5.  defined: "X"    → defined: { name: "X" }
 *   6.  camelCase names → snake_case (heck crate compatible)
 *   7.  instruction discriminator = sha256("global:" + snake_name)[0..8]
 *   8.  account discriminator   = sha256("account:" + Name)[0..8]
 *   9.  event discriminator     = sha256("event:"   + Name)[0..8]
 *  10.  accounts[].type {}      → moved to types[]
 *  11.  events[].fields []      → moved to types[] as struct
 *  12.  seed string const       → UTF-8 byte array
 *
 * Zero false positives: files that are already v1 (metadata.spec present)
 * or are not Anchor IDLs are skipped silently.
 */

import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";

// Inline type — avoids dependency on @codemod-utils/codemod-types
type CodemodOptions = { path?: string;[key: string]: unknown };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDisc(prefix: string, name: string): number[] {
    const hash = createHash("sha256").update(`${prefix}:${name}`).digest();
    return Array.from(hash.slice(0, 8));
}

function toSnakeCase(str: string): string {
    return str
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
        .replace(/([a-z\d])([A-Z])/g, "$1_$2")
        .toLowerCase();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertType(ty: any): any {
    if (ty === null || ty === undefined) return ty;
    if (typeof ty === "string") return ty === "publicKey" ? "pubkey" : ty;
    if ("defined" in ty) {
        if (typeof ty.defined === "string") return { defined: { name: ty.defined } };
        if (typeof ty.defined === "object" && ty.defined !== null) {
            return {
                defined: {
                    name: ty.defined.name,
                    ...(ty.defined.generics?.length ? { generics: ty.defined.generics.map(convertGenericArg) } : {}),
                },
            };
        }
        return ty;
    }
    if ("option" in ty) return { option: convertType(ty.option) };
    if ("vec" in ty) return { vec: convertType(ty.vec) };
    if ("array" in ty) return { array: [convertType(ty.array[0]), ty.array[1]] };
    if ("coption" in ty) return { coption: convertType(ty.coption) };
    if ("genericLenArray" in ty) return { array: [convertType(ty.genericLenArray[0]), ty.genericLenArray[1]] };
    if ("definedWithTypeArgs" in ty) {
        const { name, args = [] } = ty.definedWithTypeArgs;
        return { defined: { name, ...(args.length ? { generics: args.map(convertGenericArg) } : {}) } };
    }
    if ("generic" in ty) return { generic: ty.generic };
    return ty;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertGenericArg(arg: any): any {
    if ("type" in arg) return { type: convertType(arg.type) };
    if ("value" in arg) return { const: arg.value };
    if ("generic" in arg) return { type: { generic: arg.generic } };
    return arg;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertField(field: any): any {
    const result: Record<string, unknown> = {
        name: toSnakeCase(field.name),
        type: convertType(field.type ?? field.ty),
    };
    if (field.docs?.length) result.docs = field.docs;
    return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertInstructionAccount(acc: any): any {
    if (Array.isArray(acc.accounts)) {
        return { name: toSnakeCase(acc.name), accounts: acc.accounts.map(convertInstructionAccount) };
    }
    const result: Record<string, unknown> = {
        name: toSnakeCase(acc.name),
        writable: acc.isMut ?? false,
        signer: acc.isSigner ?? false,
    };
    if (acc.isOptional || acc.optional) result.optional = true;
    if (acc.docs?.length) result.docs = acc.docs;
    if (acc.address) result.address = acc.address;
    if (acc.pda) {
        const pda = convertPda(acc.pda);
        if (pda) result.pda = pda;
    }
    if (acc.relations?.length) result.relations = acc.relations;
    return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertPda(pda: any): any {
    if (!pda) return null;
    const result: Record<string, unknown> = { seeds: (pda.seeds ?? []).map(convertSeed) };
    if (pda.programId) {
        const prog = convertSeed(pda.programId);
        if (prog) result.program = prog;
    }
    return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertSeed(seed: any): any {
    if (!seed) return null;
    switch (seed.kind) {
        case "const": {
            let bytes: number[];
            if (seed.type === "string" && typeof seed.value === "string") {
                bytes = Array.from(Buffer.from(seed.value, "utf-8"));
            } else if (Array.isArray(seed.value)) {
                bytes = seed.value;
            } else {
                bytes = seed.value;
            }
            return { kind: "const", value: bytes };
        }
        case "arg": return { kind: "arg", path: seed.path };
        case "account": {
            const s: Record<string, unknown> = { kind: "account", path: seed.path };
            if (seed.account) s.account = seed.account;
            return s;
        }
        default: return seed;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isNamedFields(fields: any[]): boolean {
    if (!Array.isArray(fields) || fields.length === 0) return false;
    return typeof fields[0] === "object" && fields[0] !== null && "name" in fields[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertTypeDefBody(ty: any): any {
    if (!ty) return ty;
    switch (ty.kind) {
        case "struct": {
            const fields = ty.fields ?? [];
            return { kind: "struct", fields: fields.length ? fields.map(convertField) : null };
        }
        case "enum":
            return {
                kind: "enum",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                variants: (ty.variants ?? []).map((variant: any) => {
                    const v: Record<string, unknown> = { name: variant.name };
                    if (variant.fields?.length) {
                        if (isNamedFields(variant.fields)) {
                            v.fields = variant.fields.map(convertField);
                        } else {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            v.fields = variant.fields.map((f: any) =>
                                convertType(typeof f === "string" || !("name" in (f || {})) ? f : f.type ?? f.ty)
                            );
                        }
                    }
                    return v;
                }),
            };
        case "alias":
            return { kind: "type", alias: convertType(ty.value) };
        default:
            return ty;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertTypeDef(typeDef: any): any {
    const result: Record<string, unknown> = {
        name: typeDef.name,
        serialization: "borsh",
        type: convertTypeDefBody(typeDef.type ?? typeDef.ty),
    };
    if (typeDef.docs?.length) result.docs = typeDef.docs;
    if (typeDef.generics?.length) result.generics = typeDef.generics;
    return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertEventToTypeDef(event: any): any {
    const result: Record<string, unknown> = {
        name: event.name,
        serialization: "borsh",
        type: {
            kind: "struct",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fields: (event.fields ?? []).map((f: any) => ({
                name: toSnakeCase(f.name),
                type: convertType(f.type ?? f.ty),
            })),
        },
    };
    if (event.docs?.length) result.docs = event.docs;
    return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateIdl(idl: any, programAddress?: string): any {
    const addr =
        programAddress ||
        idl?.metadata?.address ||
        idl?.metadata?.programId ||
        idl?.programId ||
        "11111111111111111111111111111111";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instructions = (idl.instructions ?? []).map((ix: any) => {
        const snakeName = toSnakeCase(ix.name);
        const result: Record<string, unknown> = {
            name: snakeName,
            discriminator: getDisc("global", snakeName),
            accounts: (ix.accounts ?? []).map(convertInstructionAccount),
            args: (ix.args ?? []).map(convertField),
        };
        if (ix.docs?.length) result.docs = ix.docs;
        if (ix.returns != null) result.returns = convertType(ix.returns);
        return result;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = (idl.accounts ?? []).map((acc: any) => ({
        name: acc.name,
        discriminator: getDisc("account", acc.name),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (idl.events ?? []).map((ev: any) => ({
        name: ev.name,
        discriminator: getDisc("event", ev.name),
    }));

    const existingTypes = (idl.types ?? []).map(convertTypeDef);
    const accountTypeDefs = (idl.accounts ?? []).map(convertTypeDef);
    const eventTypeDefs = (idl.events ?? []).map(convertEventToTypeDef);
    const allTypes = [...existingTypes, ...accountTypeDefs, ...eventTypeDefs];

    // Deduplicate types by name — first occurrence wins
    const seenNames = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const types = allTypes.filter((t: any) => {
        if (seenNames.has(t.name)) return false;
        seenNames.add(t.name);
        return true;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errors = (idl.errors ?? []).map((e: any) => {
        const err: Record<string, unknown> = { code: e.code, name: e.name };
        if (e.msg != null) err.msg = e.msg;
        return err;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const constants = (idl.constants ?? []).map((c: any) => ({
        name: c.name,
        type: convertType(c.type ?? c.ty),
        value: c.value,
    }));

    const v1: Record<string, unknown> = {
        address: addr,
        metadata: {
            name: idl.name,
            version: idl.version,
            spec: "0.1.0",
            description: idl.metadata?.description ?? "",
        },
        instructions,
        accounts,
        events,
        errors,
        types,
        constants,
    };
    if (idl.docs?.length) v1.docs = idl.docs;
    return v1;
}

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
