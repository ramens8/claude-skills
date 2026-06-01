#!/usr/bin/env node
// build-antigravity.mjs
//
// Spike: transform the RampStack claude-skills catalog into an
// Antigravity-compatible distribution under dist/antigravity/.agents/skills/.
//
// Antigravity discovers skills on-demand from .agents/skills/<name>/SKILL.md by
// matching the `description` frontmatter field. It only needs a well-formed
// frontmatter block with `name` and `description`. This build keeps that
// portable core and moves every other Claude/RampStack frontmatter key into a
// per-skill sidecar so the transform is lossless and reversible.
//
// Dependency-free. Built-in fs/path only. Frontmatter is parsed by hand.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_SKILLS = path.join(REPO_ROOT, 'skills');
const OUT_ROOT = path.join(REPO_ROOT, 'dist', 'antigravity');
const OUT_SKILLS = path.join(OUT_ROOT, '.agents', 'skills');

// Frontmatter keys that Antigravity needs. Everything else is sidecar'd.
const PORTABLE_KEYS = ['name', 'description'];

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

function listDirs(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

// Recursively copy a directory tree byte-for-byte. Returns count of files copied.
function copyTree(srcDir, destDir) {
  let count = 0;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += copyTree(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      count += 1;
    }
  }
  return count;
}

// Remove a directory tree if it exists (idempotent rebuilds).
function rmTree(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Strip a single layer of matching surrounding quotes from a YAML scalar.
function unquote(value) {
  const v = value.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1);
    }
  }
  return v;
}

// Split a SKILL.md into { frontmatterLines, body }. Throws if no valid block.
function splitFrontmatter(raw, label) {
  // Normalize to LF for parsing; we only emit our own frontmatter lines.
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') {
    throw new Error(`${label}: missing opening --- frontmatter delimiter`);
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) {
    throw new Error(`${label}: missing closing --- frontmatter delimiter`);
  }
  return {
    frontmatterLines: lines.slice(1, close),
    body: lines.slice(close + 1).join('\n'),
  };
}

// Parse simple `key: value` YAML lines into ordered [key, rawValue] pairs.
// Good enough for this catalog: flat scalars, no nested maps or block lists.
function parseFrontmatter(frontmatterLines, label) {
  const pairs = [];
  for (const line of frontmatterLines) {
    if (line.trim() === '') continue;
    const m = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (!m) {
      throw new Error(`${label}: unparseable frontmatter line: ${line}`);
    }
    pairs.push([m[1], m[2]]);
  }
  return pairs;
}

// Emit a YAML scalar value, quoting defensively when needed.
function emitScalar(value) {
  const v = unquote(value);
  // Quote if it contains characters that would confuse a naive YAML reader,
  // or leading/trailing whitespace. Use double quotes, escaping embedded ones.
  const needsQuote = /[:#"']/.test(v) || v !== v.trim() || v === '';
  if (!needsQuote) return v;
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function build() {
  if (!fs.existsSync(SRC_SKILLS)) {
    throw new Error(`source skills dir not found: ${SRC_SKILLS}`);
  }

  // Fresh output tree each run.
  rmTree(OUT_SKILLS);
  fs.mkdirSync(OUT_SKILLS, { recursive: true });

  const skillNames = listDirs(SRC_SKILLS);
  const report = [];
  let totalRefFiles = 0;

  for (const name of skillNames) {
    const srcDir = path.join(SRC_SKILLS, name);
    const srcSkillMd = path.join(srcDir, 'SKILL.md');
    if (!fs.existsSync(srcSkillMd)) {
      throw new Error(`${name}: no SKILL.md found, refusing to emit`);
    }

    const destDir = path.join(OUT_SKILLS, name);
    fs.mkdirSync(destDir, { recursive: true });

    // 1. Copy references/ subtree byte-for-byte (recursive, preserves nesting).
    let refFiles = 0;
    const srcRefs = path.join(srcDir, 'references');
    if (fs.existsSync(srcRefs)) {
      refFiles = copyTree(srcRefs, path.join(destDir, 'references'));
    }
    totalRefFiles += refFiles;

    // 2. Parse + normalize frontmatter.
    const raw = fs.readFileSync(srcSkillMd, 'utf8');
    const { frontmatterLines, body } = splitFrontmatter(raw, name);
    const pairs = parseFrontmatter(frontmatterLines, name);

    const core = new Map();
    const extras = [];
    for (const [key, value] of pairs) {
      if (PORTABLE_KEYS.includes(key)) {
        core.set(key, value);
      } else {
        extras.push([key, value]);
      }
    }

    // Guarantee the fields Antigravity requires are present and non-empty.
    for (const key of PORTABLE_KEYS) {
      const val = core.has(key) ? unquote(core.get(key)) : '';
      if (val === '') {
        throw new Error(`${name}: required frontmatter field '${key}' missing or empty`);
      }
    }

    // 3. Write sidecar of extras (if any) into references/.
    let sidecarKeys = [];
    if (extras.length > 0) {
      const refDir = path.join(destDir, 'references');
      fs.mkdirSync(refDir, { recursive: true });
      const sidecarPath = path.join(refDir, '_claude-frontmatter-extras.yaml');
      const header = [
        '# Frontmatter keys carried over from the source Claude/RampStack',
        '# SKILL.md that Antigravity does not use. Preserved here so the port',
        '# is lossless and reversible. Not read by Antigravity.',
      ].join('\n');
      const lines = extras.map(([k, v]) => `${k}: ${emitScalar(v)}`);
      fs.writeFileSync(sidecarPath, header + '\n' + lines.join('\n') + '\n', 'utf8');
      sidecarKeys = extras.map(([k]) => k);
    }

    // 4. Emit normalized SKILL.md: clean frontmatter + untouched body.
    const fmOut = ['---'];
    for (const key of PORTABLE_KEYS) {
      fmOut.push(`${key}: ${emitScalar(core.get(key))}`);
    }
    fmOut.push('---');
    // Re-attach the body verbatim. `body` is the text starting at the first
    // line AFTER the closing ---, so we add back the newline that terminated
    // the --- line to preserve the original spacing (incl. a leading blank).
    const out = fmOut.join('\n') + '\n' + body;
    fs.writeFileSync(path.join(destDir, 'SKILL.md'), out, 'utf8');

    report.push({ name, refFiles, sidecarKeys });
  }

  // Taxonomy: every entry is on-demand procedural knowledge -> Antigravity Skill.
  const taxonomy = {
    Skills: skillNames.length,
    Rules: 0,
    Workflows: 0,
  };

  // -------------------------------------------------------------------------
  // Transform log
  // -------------------------------------------------------------------------
  console.log('Antigravity build');
  console.log('=================');
  console.log(`source:      ${path.relative(REPO_ROOT, SRC_SKILLS)}`);
  console.log(`destination: ${path.relative(REPO_ROOT, OUT_SKILLS)}`);
  console.log('');
  console.log(`skills copied:        ${report.length}`);
  console.log(`reference files copied: ${totalRefFiles}`);
  console.log('');
  console.log('Per-skill frontmatter keys moved to sidecar:');
  for (const r of report) {
    const keys = r.sidecarKeys.length ? r.sidecarKeys.join(', ') : '(none)';
    console.log(`  ${r.name.padEnd(40)} refs=${String(r.refFiles).padStart(3)}  sidecar: ${keys}`);
  }
  console.log('');
  console.log('Taxonomy classification (Antigravity):');
  console.log(`  Skills:    ${taxonomy.Skills}  (on-demand, matched by description)`);
  console.log(`  Rules:     ${taxonomy.Rules}  (always-on guardrails)`);
  console.log(`  Workflows: ${taxonomy.Workflows}  (slash-triggered macros)`);

  return { report, totalRefFiles, taxonomy };
}

build();
