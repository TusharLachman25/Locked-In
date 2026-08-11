/**
 * Dumps a Supabase project's public schema to SQL over the Management API.
 *
 * No Docker, no pg_dump, no local Postgres. Reads a personal access token from
 * a file, runs introspection queries through
 * POST /v1/projects/{ref}/database/query, and assembles the result.
 *
 * Postgres does the hard part: pg_get_constraintdef, pg_get_indexdef,
 * pg_get_triggerdef and pg_get_functiondef emit canonical DDL, so nothing here
 * is reconstructed by hand except CREATE TABLE column lists.
 *
 *   node dump-schema.mjs <token-file> <project-ref> > schema.sql
 */

import { readFileSync } from 'node:fs';

const [tokenFile, projectRef] = process.argv.slice(2);
if (!tokenFile || !projectRef) {
  console.error('usage: node dump-schema.mjs <token-file> <project-ref>');
  process.exit(1);
}

const token = readFileSync(tokenFile, 'utf8').trim();
const out = [];
const say = (s = '') => out.push(s);

async function q(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
}

/** Column list for one table, rendered the way pg_dump renders it. */
function columnLines(cols) {
  return cols.map((c) => {
    let line = `  ${JSON.stringify(c.column_name).replace(/"/g, '"')} ${c.formatted_type}`;
    if (c.identity_generation) {
      line += ` generated ${c.identity_generation.toLowerCase()} as identity`;
    } else if (c.column_default !== null) {
      line += ` default ${c.column_default}`;
    }
    if (c.is_nullable === 'NO') line += ' not null';
    return line;
  });
}

const enums = await q(`
  select t.typname as name,
         array_agg(e.enumlabel order by e.enumsortorder) as labels
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname
  order by t.typname;
`);

const columns = await q(`
  select c.relname as table_name,
         a.attname as column_name,
         format_type(a.atttypid, a.atttypmod) as formatted_type,
         pg_get_expr(d.adbin, d.adrelid) as column_default,
         case when a.attnotnull then 'NO' else 'YES' end as is_nullable,
         nullif(a.attidentity, '') as identity_raw,
         case a.attidentity when 'a' then 'ALWAYS'
                            when 'd' then 'BY DEFAULT' end as identity_generation,
         a.attnum
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
    and a.attnum > 0 and not a.attisdropped
  order by c.relname, a.attnum;
`);

const constraints = await q(`
  select conrelid::regclass::text as table_name,
         conname as name,
         pg_get_constraintdef(oid) as def,
         contype
  from pg_constraint
  where connamespace = 'public'::regnamespace
  order by conrelid::regclass::text, contype desc, conname;
`);

const indexes = await q(`
  select tablename as table_name, indexname as name, indexdef as def
  from pg_indexes
  where schemaname = 'public'
    and indexname not in (
      select conname from pg_constraint where connamespace = 'public'::regnamespace
    )
  order by tablename, indexname;
`);

const rlsTables = await q(`
  select c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  order by c.relname;
`);

const policies = await q(`
  select tablename as table_name, policyname as name, permissive, roles, cmd,
         qual, with_check
  from pg_policies
  where schemaname = 'public'
  order by tablename, policyname;
`);

const functions = await q(`
  select p.proname as name, pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
  order by p.proname;
`);

const triggers = await q(`
  select c.relname as table_name, t.tgname as name,
         pg_get_triggerdef(t.oid) as def
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
  order by c.relname, t.tgname;
`);

const publication = await q(`
  select tablename as table_name
  from pg_publication_tables
  where pubname = 'supabase_realtime'
  order by tablename;
`);

const extensions = await q(`
  select e.extname as name, n.nspname as schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname not in ('plpgsql')
  order by e.extname;
`);

say('-- Schema for Locked In, dumped from the live Supabase project.');
say('-- Generated by scripts/dump-schema.mjs via the Supabase Management API.');
say('-- Run this in the SQL Editor of a fresh project, top to bottom.');
say();

if (extensions.length) {
  say('-- Extensions ------------------------------------------------------------');
  for (const e of extensions) {
    say(`create extension if not exists "${e.name}" with schema "${e.schema}";`);
  }
  say();
}

if (enums.length) {
  say('-- Enum types ------------------------------------------------------------');
  for (const e of enums) {
    const labels = e.labels.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ');
    say(`create type public."${e.name}" as enum (${labels});`);
  }
  say();
}

const byTable = new Map();
for (const c of columns) {
  if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
  byTable.get(c.table_name).push(c);
}

const mine = (k, table) =>
  k.table_name === table || k.table_name === `public.${table}`;

say('-- Tables ----------------------------------------------------------------');
for (const [table, cols] of byTable) {
  say(`create table public."${table}" (`);
  const lines = columnLines(cols);
  // Table-level constraints come from pg_constraint so that composite keys and
  // ON DELETE clauses survive verbatim. Foreign keys are deliberately excluded
  // here: tables are emitted alphabetically, so an inline FK would routinely
  // reference a table that does not exist yet and fail on a fresh database.
  // They are added by ALTER TABLE below, once every table exists.
  const own = constraints.filter((k) => mine(k, table) && k.contype !== 'f');
  for (const k of own) lines.push(`  constraint "${k.name}" ${k.def}`);
  say(lines.join(',\n'));
  say(');');
  say();
}

const foreignKeys = constraints.filter((k) => k.contype === 'f');
if (foreignKeys.length) {
  say('-- Foreign keys ----------------------------------------------------------');
  say('-- Separated from CREATE TABLE so the order tables are created in cannot');
  say('-- matter. Run after every table above exists.');
  for (const k of foreignKeys) {
    const table = k.table_name.replace(/^public\./, '');
    say(
      `alter table public."${table}" add constraint "${k.name}" ${k.def};`,
    );
  }
  say();
}

if (indexes.length) {
  say('-- Indexes ---------------------------------------------------------------');
  for (const i of indexes) say(`${i.def};`);
  say();
}

if (functions.length) {
  say('-- Functions -------------------------------------------------------------');
  for (const f of functions) {
    say(f.def.trimEnd().endsWith(';') ? f.def : `${f.def};`);
    say();
  }
}

if (triggers.length) {
  say('-- Triggers --------------------------------------------------------------');
  for (const t of triggers) say(`${t.def};`);
  say();
}

if (rlsTables.length) {
  say('-- Row-level security ----------------------------------------------------');
  for (const t of rlsTables) {
    say(`alter table public."${t.table_name}" enable row level security;`);
  }
  say();
}

if (policies.length) {
  for (const p of policies) {
    const roles = Array.isArray(p.roles) ? p.roles.join(', ') : p.roles;
    let s = `create policy "${p.name}" on public."${p.table_name}"`;
    s += `\n  as ${p.permissive === 'PERMISSIVE' ? 'permissive' : 'restrictive'}`;
    s += `\n  for ${p.cmd.toLowerCase()}`;
    s += `\n  to ${roles}`;
    if (p.qual) s += `\n  using (${p.qual})`;
    if (p.with_check) s += `\n  with check (${p.with_check})`;
    say(`${s};`);
    say();
  }
}

if (publication.length) {
  say('-- Realtime --------------------------------------------------------------');
  say('-- Realtime is opt-in per table through this publication.');
  for (const t of publication) {
    say(`alter publication supabase_realtime add table public."${t.table_name}";`);
  }
  say();
}

say(`-- ${byTable.size} tables, ${policies.length} policies, ${triggers.length} triggers, ${functions.length} functions.`);

process.stdout.write(out.join('\n') + '\n');
