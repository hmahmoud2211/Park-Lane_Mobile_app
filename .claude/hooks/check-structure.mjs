#!/usr/bin/env node
/**
 * Park-Lane structure guard for Claude Code (see .claude/README.md).
 *
 * As a PreToolUse hook (the tool call arrives as JSON on stdin):
 *   Write / Edit / MultiEdit  blocks a change that breaks the project structure
 *   Bash                      blocks package installs that skip `expo install`, and shell edits of
 *                             source files (they would skip this check)
 *
 * By hand, or before saying a task is done:
 *   node .claude/hooks/check-structure.mjs --changed [git-ref]
 *   checks every file changed since <git-ref> (default HEAD), whatever tool changed it.
 *
 * Only NEW problems count: whatever already broke a rule before the change is left alone, so the
 * few old exceptions keep working. A line with `structure-ok: <reason>` is skipped; add one only when
 * the user has agreed to that exception.
 *
 * Exit 2 with a message on stderr blocks the call, and Claude Code shows the message to Claude.
 * The rules here mirror docs/PROJECT_STRUCTURE.md, AGENTS.md and .claude/rules/: change them together.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const ALLOW = 'structure-ok:';

// ---------------------------------------------------------------------------------------------
// Where things are

const toRel = (abs) => path.relative(ROOT, path.resolve(abs)).split(path.sep).join('/');
const inside = (rel) => rel !== '' && !rel.startsWith('../') && rel !== '..' && !path.isAbsolute(rel);
const under = (rel, ...dirs) => dirs.some((dir) => rel.startsWith(dir));

const isFrontendCode = (rel) =>
  CODE.test(rel) && (rel.startsWith('frontend/src/') || rel === 'frontend/App.tsx' || rel === 'frontend/index.ts');
const isBackendCode = (rel) => CODE.test(rel) && under(rel, 'backend/src/', 'backend/test/', 'backend/scripts/');
const isContract = (rel) => CODE.test(rel) && rel.startsWith('shared/contracts/');
const isCheckScript = (rel) => /checks\.ts$/.test(rel);

/** Source files only Edit / Write may change, so this check sees every change to them. */
const isGuardedSource = (rel) => isFrontendCode(rel) || isBackendCode(rel) || isContract(rel);

const SRC_DIRS = ['assets', 'components', 'config', 'constants', 'context', 'data', 'features', 'hooks', 'lib', 'navigation', 'screens', 'theme', 'types', 'utils'];
const COMPONENT_DIRS = ['common', 'ui', 'layout', 'feedback', 'forms'];
const FEATURE_DIRS = ['services', 'hooks', 'context', 'components'];
const BACKEND_ROOT_FILES = ['index.ts', 'app.ts', 'config.ts', 'errors.ts', 'log.ts'];

// ---------------------------------------------------------------------------------------------
// Reading code

/** The text without comment lines and without lines marked `structure-ok:`. */
function codeOnly(text) {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || line.includes(ALLOW));
    })
    .join('\n');
}

/** Every module a file imports or requires. */
function specifiers(text) {
  const found = [];
  const patterns = [
    /^\s*(?:import|export|\})[^\n]*?\bfrom\s*(['"])([^'"\n]+)\1/gm, // import … from 'x', export … from 'x', } from 'x'
    /^\s*import\s+(['"])([^'"\n]+)\1/gm, // import 'x'
    /(?<![\w.$])(?:import|require)\s*\(\s*(['"])([^'"\n]+)\1/g, // import('x'), require('x')
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) found.push(m[2]);
  return found;
}

const all = (text, re, pick = (m) => m[0]) => [...text.matchAll(re)].map(pick);
/** A match (or string) with its whitespace collapsed, so the same code always gives the same token. */
const squash = (m) => (typeof m === 'string' ? m : m[0]).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------
// Content rules: each returns one token per problem; a change is blocked when a token appears
// more often after it than before it.

const RULES = [
  {
    id: 'raw colour',
    applies: (rel) => isFrontendCode(rel) && !rel.startsWith('frontend/src/theme/'),
    find: (text) => [
      ...all(text, /(['"`])(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4}))\1/g, (m) => m[2]),
      ...all(text, /['"`]\s*((?:rgba?|hsla?)\s*\()/g, (m) => m[1].replace(/\s/g, '')),
    ],
    why: 'Colours come from src/theme: theme.colors.* (useAppTheme()) or the glass tokens. If no token fits, add one in src/theme/colors.ts, never a literal in a screen or component.',
  },
  {
    id: 'raw font size',
    applies: (rel) => isFrontendCode(rel) && !rel.startsWith('frontend/src/theme/'),
    find: (text) => all(text, /\bfontSize\s*:\s*-?\d[\d.]*/g, squash),
    why: 'Type sizes come from src/theme/typography.ts: use <AppText variant="..."> or theme.typography.<variant>.',
  },
  {
    id: 'fetch outside src/lib/http',
    applies: (rel) => isFrontendCode(rel) && !rel.startsWith('frontend/src/lib/http/'),
    find: (text) => [
      ...all(text, /(?<![\w.$])fetch\s*\(/g, () => 'fetch('),
      ...specifiers(text).filter((s) => s === 'axios' || s.startsWith('axios/')),
    ],
    why: 'Network calls go through src/lib/http (timedFetch, timedUpload), from a feature service in features/<domain>/services (most use call() from features/ems/services/emsHttp.ts). Screens and hooks never call fetch.',
  },
  {
    id: 'raw WebSocket',
    applies: (rel) => isFrontendCode(rel) && !rel.startsWith('frontend/src/lib/realtime/'),
    find: (text) => all(text, /\bnew\s+WebSocket\s*\(/g, () => 'new WebSocket('),
    why: 'Live channels extend src/lib/realtime/ReconnectingSocket.ts.',
  },
  {
    id: 'process.env outside src/config/env.ts',
    applies: (rel) => isFrontendCode(rel) && rel !== 'frontend/src/config/env.ts' && !isCheckScript(rel),
    find: (text, rel) =>
      all(text, /process\.env(?:\.(\w+))?/g, (m) => m)
        .filter((m) => !envException(m[1], rel))
        .map((m) => m[0]),
    why: 'Settings are read only in src/config/env.ts, written out in full (process.env.EXPO_PUBLIC_X) so Expo inlines them. Everything else imports them from src/config.',
  },
  {
    id: 'screen imports another screen',
    applies: (rel) => isFrontendCode(rel) && rel.startsWith('frontend/src/screens/'),
    find: (text) => specifiers(text).filter((s) => /^\.\.\/(?!\.\.)/.test(s) || /(^|\/)screens\//.test(s)),
    why: "A screen never imports another screen's files. Shared UI goes to src/components (or features/<domain>/components), shared logic to a feature hook or service.",
  },
  {
    id: 'screen imported outside navigation',
    applies: (rel) => isFrontendCode(rel) && !under(rel, 'frontend/src/screens/', 'frontend/src/navigation/'),
    find: (text) => specifiers(text).filter((s) => /(^|\/)screens\//.test(s)),
    why: 'Only src/navigation registers and imports screens.',
  },
  {
    id: 'component depends on a feature or screen',
    applies: (rel) => isFrontendCode(rel) && rel.startsWith('frontend/src/components/'),
    find: (text) => specifiers(text).filter((s) => /(^|\/)(features|screens)\//.test(s)),
    why: 'src/components is UI any screen may use, with no business logic: take data through props. UI for one domain goes in features/<domain>/components.',
  },
  {
    id: 'lib depends on app code',
    applies: (rel) => isFrontendCode(rel) && rel.startsWith('frontend/src/lib/') && !isCheckScript(rel),
    find: (text) => specifiers(text).filter((s) => /(^|\/)(features|screens|components|navigation)\//.test(s)),
    why: 'src/lib is app infrastructure (http, realtime, storage): it must not depend on features, screens or UI.',
  },
  {
    id: 'React in a service',
    applies: (rel) => isFrontendCode(rel) && /^frontend\/src\/features\/[^/]+\/services\//.test(rel),
    find: (text) => specifiers(text).filter((s) => s === 'react' || s.startsWith('react/')),
    why: 'features/<domain>/services hold API clients and pure logic, without React. React state goes in the feature\'s hooks/ (or context/).',
  },
  {
    id: 'value import from shared/contracts',
    applies: (rel) => isFrontendCode(rel) || isBackendCode(rel),
    find: (text) =>
      all(text, /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["'][^"']*shared\/contracts[^"']*["']/g, squash),
    why: 'shared/contracts is types only: use `import type { ... }` or `export type { ... }`. A value import would be bundled into the app and crash the backend image, which has no shared/ folder.',
  },
  {
    id: 'runtime code in shared/contracts',
    applies: isContract,
    find: (text) => [
      ...all(text, /^\s*export\s+(?:declare\s+)?(?:const|let|var|function|class|enum|default|async|abstract)\b[^\n]*/gm, squash),
      ...all(text, /^\s*(?:const|let|var|function|class|enum)\s+\w[^\n]*/gm, squash),
      ...all(text, /^\s*import\s+(?!type\b)[^\n]*/gm, squash),
    ],
    why: 'shared/contracts holds TypeScript types only (type, interface, import type, export type): nothing in it may run.',
  },
  {
    id: 'package import in the backend',
    applies: isBackendCode,
    find: (text) => specifiers(text).filter((s) => !s.startsWith('.') && !s.startsWith('/') && !s.startsWith('node:')),
    why: "The backend has no runtime packages: use Node's built-ins (import from 'node:...') or a small helper in backend/src/lib. Adding a dependency is the user's decision.",
  },
  {
    id: 'backend import without .ts',
    applies: isBackendCode,
    find: (text) => specifiers(text).filter((s) => s.startsWith('.') && !/\.(?:ts|json)$/.test(s)),
    why: 'Node runs the backend\'s TypeScript directly, so a relative import names the file with its .ts extension.',
  },
  {
    id: 'SQL outside backend/src/repositories',
    applies: (rel) =>
      isBackendCode(rel) && rel.startsWith('backend/src/') && !rel.startsWith('backend/src/repositories/') && rel !== 'backend/src/ems/db.ts',
    find: (text) =>
      all(
        text,
        /\b(?:SELECT\b[^;'"`]{0,200}?\bFROM\s+\w+|INSERT\s+(?:OR\s+\w+\s+)?INTO\s+\w+|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\s+\w+|CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b|ALTER\s+TABLE\s+\w+|DROP\s+(?:TABLE|INDEX)\b)/g,
        squash,
      ),
    why: 'Every SQL statement lives in backend/src/repositories (one file per table); schema changes are new migrations in backend/src/ems/db.ts. Call a repository function from here.',
  },
  {
    id: 'process.env outside backend/src/config.ts',
    applies: (rel) => isBackendCode(rel) && rel.startsWith('backend/src/') && rel !== 'backend/src/config.ts',
    find: (text) => all(text, /process\.env(?:\.\w+)?/g),
    why: 'Backend settings are read once in backend/src/config.ts (and documented in backend/.env.example); import them from there.',
  },
];

/** The documented places that may read an EXPO_PUBLIC_* variable outside env.ts (AGENTS.md, "Where code goes"). */
function envException(name, rel) {
  if (name === 'EXPO_PUBLIC_HEALTH_API') return rel.startsWith('frontend/src/features/health/services/');
  if (name === 'EXPO_PUBLIC_STORE_MODE')
    return ['frontend/App.tsx', 'frontend/src/navigation/AppNavigator.tsx', 'frontend/src/screens/ProfileScreen/ProfileScreen.data.ts'].includes(rel);
  if (name === 'EXPO_PUBLIC_PARKING') return rel === 'frontend/src/navigation/AppNavigator.tsx';
  return false;
}

function countTokens(tokens) {
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/** Problems the change adds: tokens that appear more often in `after` than in `before`. */
function contentProblems(rel, before, after) {
  const problems = [];
  const oldCode = codeOnly(before);
  const newCode = codeOnly(after);
  for (const rule of RULES) {
    if (!rule.applies(rel)) continue;
    const was = countTokens(rule.find(oldCode, rel));
    for (const [token, n] of countTokens(rule.find(newCode, rel))) {
      if (n > (was.get(token) ?? 0)) problems.push({ rule: rule.id, detail: token, why: rule.why });
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Path rules: where a NEW file may be created.

const dirExists = (rel) => {
  try {
    return statSync(path.join(ROOT, rel)).isDirectory();
  } catch {
    return false;
  }
};

function pathProblems(rel, isNew) {
  const p = (detail, why) => [{ rule: 'file in the wrong place', detail, why }];
  const seg = rel.split('/');

  if (/^frontend\/(ios|android)\//.test(rel)) {
    return p(rel, 'frontend/ios and frontend/android are generated (Continuous Native Generation). Configure native behaviour in app.json and config plugins instead.');
  }
  if (!isNew) return [];

  if (seg.length === 1) {
    if (CODE.test(rel) || /^(package(-lock)?\.json|tsconfig\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|requirements\.txt|pyproject\.toml)$/.test(rel)) {
      return p(rel, 'There is no root package or code: frontend/, backend/ and gateway/ each install and run from their own folder.');
    }
    return [];
  }
  if (!dirExists(seg[0])) {
    return p(`${seg[0]}/`, 'No new top-level folders. The repo is frontend/ (app), backend/ (EMS backend), shared/contracts/ (API types), gateway/ (CUBE gateway), plus docker/, scripts/, tools/, docs/.');
  }

  if (seg[0] === 'frontend') {
    if (seg.length === 2) {
      return /\.(?:tsx?|jsx?)$/.test(seg[1]) && !/\.config\.[cm]?js$/.test(seg[1]) && !['App.tsx', 'index.ts'].includes(seg[1])
        ? p(rel, 'App code goes in frontend/src/, not the frontend root.')
        : [];
    }
    if (!dirExists(`frontend/${seg[1]}`)) {
      return p(`frontend/${seg[1]}/`, 'App code goes in frontend/src/. This app uses React Navigation (src/navigation), not Expo Router, so there is no app/ folder.');
    }
    if (seg[1] === 'src') return srcPathProblems(rel, seg.slice(2), p);
  }

  if (seg[0] === 'backend' && seg[1] === 'src' && seg.length === 3 && !BACKEND_ROOT_FILES.includes(seg[2])) {
    return p(rel, `backend/src/ holds only its start-up files (${BACKEND_ROOT_FILES.join(', ')}). Routes go in routes/, SQL in repositories/, rules in the domain's folder (e.g. backend/src/parcels/), helpers in lib/.`);
  }

  if (seg[0] === 'shared' && seg[1] !== 'contracts' && CODE.test(rel)) {
    return p(rel, 'shared/ holds only the API types, in shared/contracts/<area>.ts (re-exported from index.ts).');
  }
  if (seg[0] === 'shared' && seg[1] === 'contracts' && (seg.length !== 3 || !/\.ts$/.test(seg[2]))) {
    return p(rel, 'A contract is one TypeScript file per area, directly in shared/contracts/, re-exported from index.ts.');
  }
  return [];
}

function srcPathProblems(rel, s, p) {
  if (s.length === 1) {
    return p(rel, `No files directly in src/. Use one of its folders: ${SRC_DIRS.join(', ')}.`);
  }
  if (!SRC_DIRS.includes(s[0])) {
    return p(`src/${s[0]}/`, `src/${s[0]}/ is not one of the app's folders (${SRC_DIRS.join(', ')}). Domain code goes in features/<domain>/, shared UI in components/, pure helpers in utils/.`);
  }

  if (s[0] === 'components' && (s.length < 3 || !COMPONENT_DIRS.includes(s[1]))) {
    return p(rel, `Shared UI goes in components/<group>/ with group one of ${COMPONENT_DIRS.join(', ')}. UI for one domain goes in features/<domain>/components/.`);
  }

  if (s[0] === 'features') {
    if (s.length < 3) return p(rel, 'Domain code goes in features/<domain>/.');
    if (!/^[a-z][A-Za-z0-9]*$/.test(s[1])) return p(`features/${s[1]}/`, 'A feature folder is the domain name in camelCase, e.g. features/lostItems/.');
    if (s.length === 3 && !['types.ts', 'index.ts'].includes(s[2])) {
      return p(rel, `A feature's root holds only types.ts (and index.ts). Code goes in its ${FEATURE_DIRS.join('/, ')}/ folders.`);
    }
    if (s.length > 3 && !FEATURE_DIRS.includes(s[2])) {
      return p(rel, `A feature has only ${FEATURE_DIRS.join('/, ')}/ folders: services without React, hooks over them, context for app-wide providers, components for UI only that domain uses.`);
    }
  }

  if (s[0] === 'screens') {
    const folder = s[1];
    if (s.length < 3) return p(rel, 'Each screen has its own folder: screens/<Name>Screen/.');
    if (!/^[A-Z][A-Za-z0-9]*Screen$/.test(folder)) return p(`screens/${folder}/`, 'A screen folder is named <Name>Screen in PascalCase, e.g. screens/LostItemsScreen/.');
    if (s.length > 3) return p(rel, 'A screen folder has no subfolders. Parts used only by this screen sit beside it as PascalCase.tsx; parts shared with other screens go in src/components or features/<domain>/components.');
    const file = s[2];
    const ok = file === 'index.ts' || new RegExp(`^${folder}(\\.[a-z]+)?\\.tsx?$`).test(file) || /^[A-Z][A-Za-z0-9]*\.tsx$/.test(file);
    if (!ok) {
      return p(rel, `A screen folder holds ${folder}.tsx, ${folder}.styles.ts, ${folder}.data.ts, index.ts, and screen-only parts as PascalCase.tsx. Hooks go in a feature's hooks/, helpers in its services/ or src/utils.`);
    }
  }
  return [];
}

// ---------------------------------------------------------------------------------------------
// One file: path + content

function checkFile(rel, before, after, isNew) {
  const allowed = after.includes(ALLOW);
  const problems = pathProblems(rel, isNew).filter((pr) => !(allowed && isNew && !/^frontend\/(ios|android)\//.test(rel)));
  if (CODE.test(rel)) problems.push(...contentProblems(rel, before, after));
  return problems;
}

function report(where, problems) {
  const lines = problems.map((pr) => `- ${pr.rule}: ${pr.detail}\n  ${pr.why}`);
  return [
    `Park-Lane structure check: ${where}`,
    ...lines,
    '',
    'Follow the project structure (.claude/rules/, docs/PROJECT_STRUCTURE.md). Only if the user has explicitly agreed to an exception, mark that line with a `structure-ok: <reason>` comment.',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Hook: Write / Edit / MultiEdit

function readText(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function checkEdit(tool, input) {
  if (!input?.file_path) return null;
  const abs = path.resolve(input.file_path);
  const rel = toRel(abs);
  if (!inside(rel)) return null;

  const current = readText(abs);
  const isNew = current === null;
  let before;
  let after;
  if (tool === 'Write') {
    before = current ?? '';
    after = input.content ?? '';
  } else if (tool === 'Edit') {
    before = input.old_string ?? '';
    after = input.new_string ?? '';
  } else if (tool === 'MultiEdit') {
    before = (input.edits ?? []).map((e) => e.old_string ?? '').join('\n');
    after = (input.edits ?? []).map((e) => e.new_string ?? '').join('\n');
  } else {
    return null;
  }
  const problems = checkFile(rel, before, after, isNew);
  return problems.length ? report(`this change to ${rel} is blocked.`, problems) : null;
}

// ---------------------------------------------------------------------------------------------
// Hook: Bash

function checkBash(command, cwd) {
  let dir = path.resolve(cwd || ROOT);
  const segments = command.split(/&&|\|\||;|\n|\|/);

  for (const raw of segments) {
    const seg = raw.trim();
    const cd = /^cd\s+(['"]?)([^'"\s]+)\1\s*$/.exec(seg);
    if (cd) {
      dir = path.resolve(dir, cd[2].replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
      continue;
    }
    const where = toRel(dir);

    // Package installs
    const pm = /^(?:\w+=\S*\s+)*(?:sudo\s+)?(npm|pnpm|yarn|bun)\s+(install|i|add)\b(.*)$/.exec(seg);
    if (pm) {
      const args = pm[3].trim().split(/\s+/).filter(Boolean);
      const pkgs = args.filter((a) => !a.startsWith('-'));
      const global = args.some((a) => a === '-g' || a === '--global');
      if (pkgs.length && !global) {
        if (where.startsWith('backend')) {
          return {
            ask: `backend/ has no runtime packages by design (it runs on plain Node). Adding "${pkgs.join(' ')}" is the user's call: confirm only if they asked for it.`,
          };
        }
        return {
          deny: `Do not add app packages with ${pm[1]} ${pm[2]}. From frontend/ run \`npx expo install ${pkgs.join(' ')}\` (dev tools: \`npx expo install ${pkgs.join(' ')} -- --save-dev\`): it picks versions that match the Expo SDK. A package with native code then needs a development build, not Expo Go. Prefer an Expo module when one exists.`,
        };
      }
    }
    if (where.startsWith('gateway') && /^(?:uv\s+)?pip3?\s+install\s+(?!-r\b)[^-]/.test(seg)) {
      return {
        deny: 'The gateway pins its dependencies in uv.lock: edit gateway/pyproject.toml, run `uv lock`, and commit both (gateway/README.md, "Develop"). Check the licence first.',
      };
    }

    // Shell edits of source files
    const targets = [];
    for (const m of seg.matchAll(/(?:^|[^<>&\d])>{1,2}\s*(['"]?)([^\s'";|&<>]+)\1/g)) targets.push(m[2]);
    for (const m of seg.matchAll(/\btee\s+(?:(?:-a|--append)\s+)*(['"]?)([^\s'";|&]+)\1/g)) targets.push(m[2]);
    if (/\b(?:g?sed)\b[^|]*\s(?:-[a-zA-Z]*i\b|-i|--in-place)/.test(seg) || /\bperl\b[^|]*\s-[a-zA-Z]*i/.test(seg)) {
      for (const m of seg.matchAll(/(['"]?)([^\s'";|&]+\.(?:[cm]?[jt]sx?))\1/g)) targets.push(m[2]);
    }
    for (const t of targets) {
      if (t.startsWith('/dev/')) continue;
      const rel = toRel(path.resolve(dir, t));
      if (inside(rel) && isGuardedSource(rel)) {
        return {
          deny: `Change ${rel} with the Edit or Write tool, not the shell: the Park-Lane structure check only sees those tools.`,
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// --changed: every file changed since a git ref

function changedMode(ref) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const tryGit = (...args) => {
    try {
      return git(...args);
    } catch {
      return null;
    }
  };

  const changed = new Set(
    [...git('diff', '--name-only', '--diff-filter=AMR', ref).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')]
      .map((f) => f.trim())
      .filter(Boolean),
  );

  const failures = [];
  for (const rel of changed) {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    const before = tryGit('show', `${ref}:${rel}`);
    const after = CODE.test(rel) ? readText(abs) ?? '' : '';
    const problems = checkFile(rel, before ?? '', after, before === null);
    if (problems.length) failures.push(report(rel, problems));
  }

  if (failures.length) {
    console.error(failures.join('\n\n'));
    console.error(`\n${failures.length} file(s) break the structure (checked ${changed.size} changed since ${ref}).`);
    process.exit(1);
  }
  console.log(`Structure check: ${changed.size} file(s) changed since ${ref}, no problems.`);
}

// ---------------------------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--changed') {
    changedMode(args[1] ?? 'HEAD');
    return;
  }

  let call;
  try {
    call = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return; // not a hook call we understand: never block on that
  }
  const tool = call.tool_name;
  const input = call.tool_input ?? {};

  if (tool === 'Bash') {
    const verdict = checkBash(String(input.command ?? ''), call.cwd);
    if (verdict?.deny) {
      console.error(verdict.deny);
      process.exit(2);
    }
    if (verdict?.ask) {
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: verdict.ask } }),
      );
    }
    return;
  }

  const message = checkEdit(tool, input);
  if (message) {
    console.error(message);
    process.exit(2);
  }
}

try {
  main();
} catch (error) {
  // A bug in this guard must not stop work: report it (exit 1 is a non-blocking hook error).
  console.error(`check-structure.mjs failed: ${error?.stack ?? error}`);
  process.exit(1);
}
