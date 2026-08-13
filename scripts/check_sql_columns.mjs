#!/usr/bin/env node
// =====================================================================
// check_sql_columns.mjs — catch SELECTs that name columns which do not exist
// =====================================================================
// WHY THIS EXISTS.
//
// D1 throws on an unknown column at execution time, not at deploy time.
// A handler whose FIRST statement names a column that was never in the
// table returns 500 for every request, forever, and nothing anywhere says
// so — no build error, no lint warning, no deploy gate. The only signal is
// a user reporting that a page is blank.
//
// Four endpoints were in exactly that state on 2026-08-13:
//
//   admin/snapshots/[patient_id].js        SELECT ... date_of_birth, sex, gender_identity
//   admin/billing/claims/[id].js           SELECT ... p.date_of_birth
//   sync/transcription/patients.js         SELECT ... p.date_of_birth
//   sync/transcription/patients/[id]/      SELECT ... date_of_birth, sex, gender_identity,
//     context.js                                      address_line1 ... emergency_contact_phone
//
// The column is `dob`. `sex`, `gender_identity`, the address fields and the
// emergency-contact fields have never existed on `patients` at all. The
// admin snapshot dashboard and the entire Transcription-app sync had
// therefore never worked in production.
//
// WHAT IT CHECKS, and what it deliberately does not.
//
// Two cases can be decided without a SQL parser, and only those are
// reported:
//
//   1. QUALIFIED references — `p.foo` where `p` is bound by `FROM patients p`
//      or `JOIN patients AS p`. The table is unambiguous, so an unknown
//      column is a certain error.
//   2. SINGLE-TABLE queries — when a statement touches exactly one table,
//      every bare identifier in it belongs to that table.
//
// Multi-table queries with bare column names are SKIPPED, because deciding
// them needs real name resolution and a false alarm in a deploy gate is
// worse than a missed one — a gate people learn to bypass stops being a
// gate. This is a floor, not a ceiling.
//
// The schema comes from schema/*.sql (CREATE TABLE plus every ALTER TABLE
// ADD COLUMN, applied in filename order), so it runs offline and matches
// what a fresh database would have. Verified against the live D1 schema on
// 2026-08-13.
// =====================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SCHEMA_DIR = join(ROOT, "schema");
const SCAN_DIRS = [join(ROOT, "functions")];

// ---------------------------------------------------------------------
// 1. Build table -> Set(columns) from the migrations
// ---------------------------------------------------------------------
function buildSchema() {
    const tables = new Map();
    const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".sql")).sort();

    for (const f of files) {
        const sql = readFileSync(join(SCHEMA_DIR, f), "utf8")
            .replace(/--[^\n]*/g, "");                      // strip line comments

        // CREATE TABLE [IF NOT EXISTS] name ( ... );
        const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?\s*\(/gi;
        let m;
        while ((m = createRe.exec(sql))) {
            const name = m[1].toLowerCase();
            const body = balanced(sql, createRe.lastIndex - 1);
            if (body == null) continue;
            const cols = tables.get(name) || new Set();
            for (const c of columnsFromBody(body)) cols.add(c);
            tables.set(name, cols);
        }

        // CREATE VIEW name AS ... — record the name so references to it are
        // not reported as unknown tables, but do not try to type its columns.
        for (const v of sql.matchAll(/CREATE\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)/gi)) {
            if (!tables.has(v[1].toLowerCase())) tables.set(v[1].toLowerCase(), null);   // null = unknown shape
        }

        // ALTER TABLE name ADD [COLUMN] col ...
        for (const a of sql.matchAll(/ALTER\s+TABLE\s+[`"[]?(\w+)[`"\]]?\s+ADD\s+(?:COLUMN\s+)?[`"[]?(\w+)/gi)) {
            const t = a[1].toLowerCase();
            if (!tables.has(t)) tables.set(t, new Set());
            const set = tables.get(t);
            if (set) set.add(a[2].toLowerCase());
        }

        // ALTER TABLE name RENAME COLUMN a TO b
        for (const r of sql.matchAll(/ALTER\s+TABLE\s+[`"[]?(\w+)[`"\]]?\s+RENAME\s+COLUMN\s+[`"[]?(\w+)[`"\]]?\s+TO\s+[`"[]?(\w+)/gi)) {
            const set = tables.get(r[1].toLowerCase());
            if (set) { set.delete(r[2].toLowerCase()); set.add(r[3].toLowerCase()); }
        }
    }
    return tables;
}

/** Text inside the parens starting at `open` (index of the "("). */
function balanced(s, open) {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")") { depth--; if (depth === 0) return s.slice(open + 1, i); }
    }
    return null;
}

const TABLE_CONSTRAINT = /^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i;

function columnsFromBody(body) {
    const out = [];
    let depth = 0, start = 0;
    const parts = [];
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === "," && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
    }
    parts.push(body.slice(start));
    for (const p of parts) {
        const t = p.trim();
        if (!t || TABLE_CONSTRAINT.test(t)) continue;
        const m = t.match(/^[`"[]?(\w+)[`"\]]?/);
        if (m) out.push(m[1].toLowerCase());
    }
    return out;
}

// ---------------------------------------------------------------------
// 2. Pull SQL string literals out of the JS
// ---------------------------------------------------------------------
function jsFiles(dir) {
    const out = [];
    for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        const st = statSync(p);
        if (st.isDirectory()) { if (e !== "node_modules") out.push(...jsFiles(p)); }
        else if (e.endsWith(".js") || e.endsWith(".mjs")) out.push(p);
    }
    return out;
}

// A literal is SQL only if it BEGINS with a SQL verb. Matching "contains
// SELECT" swept up prose — a doc-string listing example drug names was read
// as a column list, and the checker reported 200 imaginary problems. A
// checker that cries wolf is worse than no checker, because the next person
// adds `|| true` to the gate.
const SQL_START = /^\s*(?:--[^\n]*\n\s*)*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH)\b/i;

/** Template literals and quoted strings that ARE SQL statements. */
function sqlLiterals(src) {
    const found = [];
    // Template literals (the repo's prepare(`...`) style).
    const re = /`([^`\\]*(?:\\.[^`\\]*)*)`/g;
    let m;
    while ((m = re.exec(src))) {
        if (SQL_START.test(m[1])) found.push({ text: m[1], index: m.index });
    }
    // Single/double-quoted one-liners.
    const re2 = /(['"])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
    while ((m = re2.exec(src))) {
        if (SQL_START.test(m[2]) && /\bFROM\b|\bINTO\b|\bUPDATE\b/i.test(m[2])) {
            found.push({ text: m[2], index: m.index });
        }
    }
    return found;
}

function lineOf(src, index) {
    return src.slice(0, index).split("\n").length;
}

// ---------------------------------------------------------------------
// 3. Resolve aliases and check references
// ---------------------------------------------------------------------
const RESERVED = new Set([
    "select", "from", "where", "and", "or", "not", "null", "as", "on", "join", "left", "right",
    "inner", "outer", "cross", "group", "by", "order", "having", "limit", "offset", "union", "all",
    "distinct", "case", "when", "then", "else", "end", "in", "is", "like", "between", "asc", "desc",
    "insert", "into", "values", "update", "set", "delete", "count", "sum", "avg", "min", "max",
    "coalesce", "cast", "exists", "with", "returning", "conflict", "do", "nothing", "excluded",
    "json_extract", "json_each", "json_array", "json_object", "group_concat", "ifnull", "nullif",
    "substr", "length", "lower", "upper", "trim", "replace", "abs", "round", "random", "strftime",
    "date", "datetime", "julianday", "printf", "instr", "iif", "row_number", "over", "partition",
    "collate", "nocase", "true", "false", "default", "primary", "key", "unique", "references",
]);

function stripStrings(sql) {
    return sql
        .replace(/--[^\n]*/g, " ")                        // SQL comments — prose in them read as columns
        .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
        .replace(/\$\{[^}]*\}/g, " ? ");
}

/** table aliases bound in this statement, plus the set of tables touched. */
function bindings(sql, schema) {
    const aliases = new Map();
    const tables = new Set();
    const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+[`"[]?(\w+)[`"\]]?(?:\s+(?:AS\s+)?[`"[]?(\w+)[`"\]]?)?/gi;
    let m;
    while ((m = re.exec(sql))) {
        const table = m[1].toLowerCase();
        if (!schema.has(table)) continue;                 // unknown table: not our business here
        tables.add(table);
        const alias = m[2] && !RESERVED.has(m[2].toLowerCase()) ? m[2].toLowerCase() : null;
        if (alias) aliases.set(alias, table);
        aliases.set(table, table);                        // `patients.id` also resolves
    }
    return { aliases, tables };
}

function checkStatement(sql, schema) {
    const problems = [];
    const clean = stripStrings(sql);
    const { aliases, tables } = bindings(clean, schema);
    if (!tables.size) return problems;

    // Subqueries can bind their own aliases; if any alias is bound to more
    // than one table across the statement, skip qualified checking for it.
    // (bindings() already collapses to last-wins, so be conservative.)
    const aliasCount = new Map();
    for (const m of clean.matchAll(/\b(?:FROM|JOIN)\s+[`"[]?(\w+)[`"\]]?(?:\s+(?:AS\s+)?[`"[]?(\w+)[`"\]]?)?/gi)) {
        const a = (m[2] && !RESERVED.has(m[2].toLowerCase()) ? m[2] : m[1]).toLowerCase();
        aliasCount.set(a, (aliasCount.get(a) || 0) + 1);
    }

    // 1. Qualified refs: alias.column
    for (const m of clean.matchAll(/\b(\w+)\.(\w+)\b/g)) {
        const a = m[1].toLowerCase(), col = m[2].toLowerCase();
        const table = aliases.get(a);
        if (!table) continue;
        if ((aliasCount.get(a) || 0) > 1) continue;       // ambiguous binding — skip
        const cols = schema.get(table);
        if (!cols) continue;                              // view, unknown shape
        if (col === "*" || col === "rowid" || col === "oid") continue;
        if (!cols.has(col)) {
            problems.push(`${table}.${m[2]} — no such column (has: ${sample(cols, m[2])})`);
        }
    }

    // 2. The SELECT LIST of a single-table statement.
    //
    // Only bare identifiers are judged — `first_name`, not `COUNT(*)`, not
    // `x AS y`, not any expression. That is narrow on purpose: it is
    // exactly the shape all four real bugs had (`SELECT id, first_name,
    // ..., date_of_birth, sex, gender_identity FROM patients`) and it
    // cannot be confused with anything else.
    if (tables.size === 1 && !/\bJOIN\b/i.test(clean) && !/\(\s*SELECT\b/i.test(clean)) {
        const table = [...tables][0];
        const cols = schema.get(table);
        const list = selectList(clean);
        if (cols && list) {
            for (const item of list) {
                const t = item.trim();
                if (!/^[`"[]?[A-Za-z_]\w*[`"\]]?$/.test(t)) continue;  // expression, alias, function, `SELECT 1` → skip
                const id = t.replace(/[`"[\]]/g, "").toLowerCase();
                if (id === "*" || RESERVED.has(id) || cols.has(id)) continue;
                problems.push(`${table}.${t} — no such column (has: ${sample(cols, id)})`);
            }
        }

        // Identifiers being COMPARED are columns too. This is the half the
        // SELECT-list rule misses, and it is the more dangerous half:
        // `WHERE intake_response_id = ?` against a table whose FK column is
        // `intake_id` throws exactly like a bad SELECT, but reads as
        // plausible. Only bare identifiers immediately followed by a
        // comparison operator are judged, so a bound `?` or an expression
        // is never mistaken for one.
        const aliasNames = new Set();
        for (const a of clean.matchAll(/\bAS\s+[`"[]?(\w+)[`"\]]?/gi)) aliasNames.add(a[1].toLowerCase());
        if (cols) {
            const cmp = /(?:^|[\s(,])(?<!\.)([A-Za-z_]\w*)\s*(?:=|!=|<>|>=|<=|>|<|\bIS\b|\bIN\b|\bLIKE\b|\bBETWEEN\b)/gi;
            for (const m of clean.matchAll(cmp)) {
                const id = m[1].toLowerCase();
                if (RESERVED.has(id) || cols.has(id) || aliasNames.has(id) || schema.has(id)) continue;
                problems.push(`${table}.${m[1]} — no such column, compared in the WHERE clause (has: ${sample(cols, id)})`);
            }
        }
    }
    return [...new Set(problems)];
}

/** The comma-separated items between SELECT and its matching FROM. */
function selectList(sql) {
    const m = sql.match(/\bSELECT\b(?:\s+DISTINCT\b)?([\s\S]*?)\bFROM\b/i);
    if (!m) return null;
    const body = m[1];
    const items = [];
    let depth = 0, start = 0;
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === "," && depth === 0) { items.push(body.slice(start, i)); start = i + 1; }
    }
    items.push(body.slice(start));
    return items;
}

/** Suggest the closest real column, so the message is actionable. */
function sample(cols, wrong) {
    const w = wrong.toLowerCase();
    const near = [...cols].filter((c) => c.includes(w.slice(0, 4)) || w.includes(c.slice(0, 4)));
    if (near.length) return near.slice(0, 3).join(", ") + " …";
    return [...cols].slice(0, 4).join(", ") + " …";
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------
const schema = buildSchema();

// A checker nobody has tested is a checker that reports "no problems"
// because its regex stopped matching. These are the four real statements
// from 2026-08-13 plus the false positives that had to be tuned out.
if (process.argv.includes("--self-test")) {
    const cases = [
        ["SELECT id, first_name, dob AS date_of_birth FROM patients WHERE id = ?", 0, "the fixed patients query"],
        ["SELECT id, first_name, date_of_birth, sex FROM patients WHERE id = ?", 2, "the original snapshots query"],
        ["SELECT p.dob FROM patients p WHERE p.id = ?", 0, "qualified, correct"],
        ["SELECT p.date_of_birth FROM patients p WHERE p.id = ?", 1, "qualified, wrong"],
        ["SELECT section_key FROM intake_section_data WHERE intake_response_id = ?", 1, "wrong FK in WHERE"],
        ["SELECT section_key FROM intake_section_data WHERE intake_id = ?", 0, "right FK in WHERE"],
        ["SELECT entry_date, values_json, note FROM symptom_diary_entries WHERE patient_id = ?", 0, "fixed diary"],
        ["SELECT entry_date, symptoms_json, notes FROM symptom_diary_entries WHERE patient_id = ?", 2, "broken diary"],
        ["SELECT 1 FROM appointments WHERE patient_id = ?", 0, "SELECT 1 is not a column"],
        ["SELECT COUNT(*) AS n, AVG(x) AS avg_score FROM billing_claims WHERE patient_id = ?", 0, "aliases are not columns"],
        ["SELECT id FROM patients WHERE id = ? -- he approved it\n", 0, "prose in a SQL comment"],
        ["SELECT starts_at FROM appointments WHERE starts_at >= ?", 0, "correct appointments column"],
        ["SELECT start_at FROM appointments WHERE start_at >= ?", 2, "the original appointments bug"],
    ];
    let bad = 0;
    for (const [sql, want, label] of cases) {
        const got = checkStatement(sql, schema).length;
        if (got !== want) { bad++; console.log(`  FAIL  ${label}: expected ${want} problem(s), got ${got}`); }
    }
    console.log(bad ? `\nself-test: ${bad} case(s) failed` : `self-test: all ${cases.length} cases pass`);
    process.exit(bad ? 1 : 0);
}
let files = 0, statements = 0;
const findings = [];

for (const dir of SCAN_DIRS) {
    for (const f of jsFiles(dir)) {
        files++;
        const src = readFileSync(f, "utf8");
        for (const lit of sqlLiterals(src)) {
            statements++;
            const problems = checkStatement(lit.text, schema);
            for (const p of problems) {
                findings.push({ file: relative(ROOT, f), line: lineOf(src, lit.index), problem: p });
            }
        }
    }
}

console.log(`sql column check: ${statements} statements in ${files} files, ${schema.size} tables known`);
if (findings.length) {
    console.log(`\n${findings.length} reference${findings.length === 1 ? "" : "s"} to columns that do not exist:\n`);
    for (const f of findings) console.log(`  ${f.file}:${f.line}\n    ${f.problem}`);
    console.log("\nD1 throws on these at runtime, so the handler returns 500 for every request.");
    process.exit(1);
}
console.log("no references to non-existent columns");
