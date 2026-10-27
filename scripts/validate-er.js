#!/usr/bin/env node
/**
 * scripts/validate-er.js
 *
 * Schedula ER Contract Validator
 *
 * Reads docs/erd-contract.json and validates that all required tables,
 * columns, enum mappings, relationships, and critical named constraints
 * are present in the corresponding Mermaid, Prisma, SQL, and documentation files.
 *
 * Exits with code 0 on success, non-zero on any failure.
 *
 * Usage:
 *   node scripts/validate-er.js
 *   npm run validate:er
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ─── Paths ──────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');

const CONTRACT_PATH = path.join(ROOT, 'docs', 'erd-contract.json');
const MERMAID_PATH  = path.join(ROOT, 'docs', 'ER-Diagram.mmd');
const REVIEW_PATH   = path.join(ROOT, 'docs', 'ER-Diagram-Review.md');
const PRISMA_PATH   = path.join(ROOT, 'backend', 'prisma', 'schema.prisma');
const MIGRATION_PATH = path.join(
  ROOT,
  'backend', 'prisma', 'migrations',
  '20261026000000_init_schedula_schema', 'migration.sql'
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

let failures = 0;
let checks = 0;

function pass(msg) {
  checks++;
  console.log(`  ✔  ${msg}`);
}

function fail(msg) {
  checks++;
  failures++;
  console.error(`  ✘  ${msg}`);
}

function section(title) {
  console.log(`\n── ${title} ──────────────────────────────────────────────────`);
}

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Required file not found: ${path.relative(ROOT, filePath)}`);
    return null;
  }
  return fs.readFileSync(filePath, 'utf8');
}

function containsWord(text, word) {
  // Match word as a standalone token (allowing underscores as part of identifiers)
  return new RegExp(`(?<![a-zA-Z0-9_])${escapeRegex(word)}(?![a-zA-Z0-9_])`).test(text);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Load Contract ────────────────────────────────────────────────────────────

section('Loading Contract');

if (!fs.existsSync(CONTRACT_PATH)) {
  console.error(`FATAL: Contract file not found: ${CONTRACT_PATH}`);
  process.exit(1);
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
pass(`Contract loaded: ${contract.tables.length} tables, ${contract.enums.length} enums`);

// ─── Load Artifacts ───────────────────────────────────────────────────────────

section('Checking Required Artifact Files Exist');

const mermaidSrc   = readFile(MERMAID_PATH);
const reviewSrc    = readFile(REVIEW_PATH);
const prismaSrc    = readFile(PRISMA_PATH);
const migrationSrc = readFile(MIGRATION_PATH);

if (mermaidSrc)   pass(`docs/ER-Diagram.mmd exists`);
if (reviewSrc)    pass(`docs/ER-Diagram-Review.md exists`);
if (prismaSrc)    pass(`backend/prisma/schema.prisma exists`);
if (migrationSrc) pass(`migration.sql exists`);

for (const artifact of (contract.required_artifacts || [])) {
  const absPath = path.join(ROOT, artifact.path);
  if (fs.existsSync(absPath)) {
    pass(`Required artifact exists: ${artifact.path}`);
  } else {
    fail(`Required artifact missing: ${artifact.path} (${artifact.description})`);
  }
}

// ─── Table Presence ────────────────────────────────────────────────────────────

section('Checking All 17 Tables');

const EXPECTED_COUNT = 17;
let tablesPresentInAll = 0;

for (const table of contract.tables) {
  const name = table.name;
  const inMermaid   = mermaidSrc   ? mermaidSrc.includes(name)   : false;
  const inPrisma    = prismaSrc    ? prismaSrc.includes(`@@map("${name}")`) : false;
  const inMigration = migrationSrc ? migrationSrc.includes(`CREATE TABLE ${name}`) : false;

  if (!inMermaid)   fail(`Table '${name}' not found in ER-Diagram.mmd`);
  if (!inPrisma)    fail(`Table '${name}' not found in Prisma schema (@@map)`);
  if (!inMigration) fail(`Table '${name}' not found in migration.sql (CREATE TABLE)`);

  if (inMermaid && inPrisma && inMigration) {
    tablesPresentInAll++;
    pass(`Table '${name}' present in Mermaid, Prisma, and migration SQL`);
  }
}

if (tablesPresentInAll === EXPECTED_COUNT) {
  pass(`All ${EXPECTED_COUNT} required tables accounted for`);
} else {
  fail(`Only ${tablesPresentInAll}/${EXPECTED_COUNT} tables fully present across all artifacts`);
}

// ─── Required Columns ─────────────────────────────────────────────────────────

section('Checking Required Columns Per Table');

for (const table of contract.tables) {
  for (const col of (table.required_columns || [])) {
    const inMigration = migrationSrc
      ? migrationSrc.includes(col) || migrationSrc.includes(col.replace(/_/g, '_'))
      : false;
    const inPrisma = prismaSrc
      ? prismaSrc.includes(`@map("${col}")`) || prismaSrc.includes(` ${col} `) || prismaSrc.includes(`\n  ${col} `)
      : false;

    if (!inMigration) {
      fail(`Column '${col}' of table '${table.name}' not found in migration.sql`);
    } else {
      pass(`Column '${table.name}.${col}' found in migration.sql`);
    }
    if (!inPrisma) {
      fail(`Column '${col}' of table '${table.name}' not found in Prisma schema`);
    } else {
      pass(`Column '${table.name}.${col}' found in Prisma schema`);
    }
  }
}

// ─── Enum Mappings ────────────────────────────────────────────────────────────

section('Checking Enum Mappings (Prisma ↔ PostgreSQL)');

for (const e of contract.enums) {
  const prismaHasEnum = prismaSrc
    ? prismaSrc.includes(`enum ${e.prisma_name}`) : false;
  const prismaHasMap = prismaSrc
    ? prismaSrc.includes(`@@map("${e.pg_name}")`) : false;
  const migrationHasEnum = migrationSrc
    ? migrationSrc.includes(`CREATE TYPE ${e.pg_name}`) : false;

  if (!prismaHasEnum)  fail(`Prisma enum '${e.prisma_name}' not found in schema.prisma`);
  else                 pass(`Prisma enum '${e.prisma_name}' found`);

  if (!prismaHasMap)   fail(`Enum map '@@map("${e.pg_name}")' not found in schema.prisma for ${e.prisma_name}`);
  else                 pass(`Enum map '${e.pg_name}' found in Prisma schema`);

  if (!migrationHasEnum) fail(`PostgreSQL enum 'CREATE TYPE ${e.pg_name}' not found in migration.sql`);
  else                   pass(`PostgreSQL enum '${e.pg_name}' found in migration.sql`);
}

// ─── Relationships ────────────────────────────────────────────────────────────

section('Checking Relationships in Mermaid and Prisma');

for (const rel of (contract.relationships || [])) {
  const { from, to, via } = rel;

  // Check Mermaid has a relationship between these tables
  const mermaidHasRel = mermaidSrc
    ? (mermaidSrc.includes(`${from} ||`) || mermaidSrc.includes(`${from} }o`) || mermaidSrc.includes(`${from} o|`))
    : false;

  if (!mermaidHasRel) {
    fail(`Relationship from '${from}' not represented in ER-Diagram.mmd`);
  } else {
    pass(`Relationship '${from}' → '${to}' found in Mermaid`);
  }

  // Check Prisma has the FK field
  const prismaHasFK = prismaSrc
    ? prismaSrc.includes(`@map("${via}")`) || prismaSrc.includes(` ${via} `)
    : false;

  if (!prismaHasFK) {
    fail(`FK column '${via}' for relationship '${from}' → '${to}' not found in Prisma schema`);
  } else {
    pass(`FK column '${via}' for '${from}' → '${to}' found in Prisma`);
  }
}

// ─── Critical Named Constraints ───────────────────────────────────────────────

section('Checking Critical Named Constraints in Migration SQL');

for (const c of (contract.critical_named_constraints || [])) {
  const name = c.name;
  const inMigration = migrationSrc ? migrationSrc.includes(name) : false;

  if (!inMigration) {
    fail(`Constraint/index '${name}' (type: ${c.type}) not found in migration.sql`);
  } else {
    pass(`Constraint/index '${name}' (type: ${c.type}) found in migration.sql`);
  }
}

// ─── Key Documentation Phrases in Review ─────────────────────────────────────

section('Checking Key Documentation in ER-Diagram-Review.md');

const requiredPhrases = [
  'booked_count',
  'slot_allocations',
  'SELECT ... FOR UPDATE',
  'OVERRIDE_OVERFLOW',
  'reschedule_histories',
  'immutable',
  'TOKEN_SESSION',
  'TIMED_SESSION',
  'trg_appointments_mode_check',
  'trg_reschedule_histories_immutable',
  'excl_es_no_overlap_active',
  'excl_sts_no_overlap',
  '12-Scenario',
  'Stage 2',
];

for (const phrase of requiredPhrases) {
  if (reviewSrc && reviewSrc.includes(phrase)) {
    pass(`Review doc contains required phrase: '${phrase}'`);
  } else {
    fail(`Review doc missing required phrase: '${phrase}'`);
  }
}

// ─── Prisma Generator Config ──────────────────────────────────────────────────

section('Checking Prisma 7 Generator Config');

if (prismaSrc) {
  if (prismaSrc.includes('provider = "prisma-client"')) {
    pass('Prisma generator uses provider = "prisma-client" (Prisma 7)');
  } else {
    fail('Prisma generator does not use provider = "prisma-client" — expected Prisma 7 config');
  }

  if (prismaSrc.includes('../src/generated/prisma')) {
    pass('Prisma generator output path set to ../src/generated/prisma');
  } else {
    fail('Prisma generator output path is not ../src/generated/prisma');
  }

  // Prisma 7: datasource should NOT have url = env(...)
  if (!prismaSrc.includes('url = env(')) {
    pass('Prisma datasource does not use url = env(...) — correct for Prisma 7 config pattern');
  } else {
    fail('Prisma datasource uses url = env(...) — Prisma 7 pattern requires url in prisma.config.ts instead');
  }
}

// ─── Migration Extensions ─────────────────────────────────────────────────────

section('Checking Migration SQL Extensions');

if (migrationSrc) {
  if (migrationSrc.includes('pgcrypto') || migrationSrc.includes('gen_random_uuid')) {
    pass('Migration creates or uses pgcrypto / gen_random_uuid');
  } else {
    fail('Migration does not reference pgcrypto or gen_random_uuid');
  }

  if (migrationSrc.includes('btree_gist')) {
    pass('Migration creates btree_gist extension for exclusion constraints');
  } else {
    fail('Migration does not create btree_gist extension');
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════════');
console.log(`  ER Contract Validation Complete`);
console.log(`  Checks run:   ${checks}`);
console.log(`  Passed:       ${checks - failures}`);
console.log(`  Failed:       ${failures}`);
console.log('════════════════════════════════════════════════════════════════\n');

if (failures > 0) {
  console.error(`VALIDATION FAILED: ${failures} check(s) failed. See above for details.\n`);
  process.exit(1);
} else {
  console.log('VALIDATION PASSED: All ER contract checks passed.\n');
  process.exit(0);
}
