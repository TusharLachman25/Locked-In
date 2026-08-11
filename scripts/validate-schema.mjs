/**
 * Replays a Supabase schema dump into a throwaway in-process Postgres (PGlite)
 * and reports the first statement that fails.
 *
 * The point is to catch the things that only show up on a real run: statement
 * ordering, forward references, invalid syntax, type mismatches. It cannot
 * catch anything that depends on Supabase's own managed extensions, so those
 * are stubbed below rather than installed — a stub that satisfies a reference
 * is enough to prove the *schema* is well formed, which is what is in question.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node validate.mjs <schema.sql>');
  process.exit(1);
}

/** Split on semicolons that are not inside a string or a $tag$ body. */
function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  let inSingle = false;
  let dollarTag = null;

  while (i < sql.length) {
    const ch = sql[i];

    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
    } else if (inSingle) {
      if (ch === "'") inSingle = false;
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        buf += dollarTag;
        i += dollarTag.length;
        continue;
      }
    } else if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    } else if (ch === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const db = new PGlite();

// Everything Supabase provides that a bare Postgres does not. None of this is
// part of the schema under test; it is the platform the schema assumes.
const platform = `
  create schema if not exists extensions;
  create schema if not exists vault;
  create schema if not exists auth;
  create schema if not exists net;

  create role anon;
  create role authenticated;
  create role service_role;

  create table auth.users (
    id uuid primary key,
    email text
  );

  create function auth.uid() returns uuid language sql stable
    as $fn$ select null::uuid $fn$;

  create function auth.role() returns text language sql stable
    as $fn$ select null::text $fn$;

  create function net.http_post(
    url text,
    body jsonb default '{}'::jsonb,
    params jsonb default '{}'::jsonb,
    headers jsonb default '{}'::jsonb,
    timeout_milliseconds integer default 5000
  ) returns bigint language sql
    as $fn$ select 1::bigint $fn$;

  create function extensions.uuid_generate_v4() returns uuid language sql
    as $fn$ select gen_random_uuid() $fn$;

  create publication supabase_realtime;
`;

await db.exec(platform);

const raw = readFileSync(file, 'utf8');
const statements = splitStatements(raw).filter((s) => {
  // Managed extensions cannot be installed here; their absence is an artefact
  // of the harness, not a defect in the dump.
  return !/^create extension/i.test(s);
});

let ok = 0;
const failures = [];

for (const stmt of statements) {
  try {
    await db.exec(stmt + ';');
    ok += 1;
  } catch (err) {
    failures.push({ stmt, message: err.message });
  }
}

console.log(`statements run : ${statements.length}`);
console.log(`succeeded      : ${ok}`);
console.log(`failed         : ${failures.length}`);

if (failures.length) {
  console.log('\n--- failures ---');
  for (const f of failures.slice(0, 10)) {
    console.log(`\n${f.message}`);
    console.log(`  in: ${f.stmt.split('\n')[0].slice(0, 110)}`);
  }
} else {
  const counts = await db.query(`
    select
      (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind='r') as tables,
      (select count(*) from pg_constraint where connamespace='public'::regnamespace
        and contype='f') as foreign_keys,
      (select count(*) from pg_policies where schemaname='public') as policies,
      (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
        join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and not t.tgisinternal) as triggers,
      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public') as functions,
      (select count(*) from pg_publication_tables where pubname='supabase_realtime')
        as realtime_tables
  `);
  console.log('\n--- rebuilt database ---');
  console.log(counts.rows[0]);
}

process.exit(failures.length ? 1 : 0);
