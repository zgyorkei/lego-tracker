// PWA.A11Y-NAMES (RQ.dfdbfc, the user's pick of 16 Nov): every icon-only button and link has an accessible name,
// as aria-label in the app's language with a matching title. The same check is in SmakMal, Brick Tracker and
// BrickBudget; only the test runner and the parser's import differ.
import fs from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';
import { parseAst } from 'rollup/parseAst';
import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Each TSX file is turned into plain calls by esbuild (JSX as __h(tag, props, ...children)) and parsed into a syntax
// tree; every button, link and control with an interactive role is checked. Icon-only means no text that is there at
// the narrowest width in every state: Tailwind's `hidden` (display none until a breakpoint shows it) and aria-hidden
// hide text, `a && b` may be absent, both arms of `a ? b : c` must have text, an icon (an import from lucide-react) or
// an svg has none, an img has its alt. An icon-only control needs aria-label (or aria-labelledby) and a title, the same
// words, so a pointer user sees what a screen reader hears. A form field (input, select, textarea) takes its name from
// its <label>, which this check cannot see, so it is left out; a control whose props are spread is counted as skipped.
type Node = any;
type Unnamed = { file: string; line: number; tag: string; missing: string[] };

const ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'switch']);
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** For each generated line, its segments as [generated column, original line], from a source map's mappings. */
function lineMap(mappings: string): number[][][] {
  const lines: number[][][] = [];
  let srcLine = 0;
  for (const g of mappings.split(';')) {
    const segs: number[][] = [];
    let col = 0;
    for (const s of g.split(',')) {
      if (!s) continue;
      const v: number[] = [];
      let shift = 0;
      let val = 0;
      for (const ch of s) {
        const d = B64.indexOf(ch);
        val += (d & 31) << shift;
        if (d & 32) shift += 5;
        else { v.push(val & 1 ? -(val >> 1) : val >> 1); val = 0; shift = 0; }
      }
      col += v[0];
      if (v.length >= 4) { srcLine += v[2]; segs.push([col, srcLine]); }
    }
    lines.push(segs);
  }
  return lines;
}

const keyOf = (p: Node): string => (p.key.type === 'Identifier' ? p.key.name : String(p.key.value));
const tagName = (t: Node): string =>
  t.type === 'Literal' ? String(t.value) : t.type === 'Identifier' ? t.name : t.type === 'MemberExpression' ? `${tagName(t.object)}.${t.property.name}` : '?';
const isH = (n: Node): boolean => !!n && n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === '__h';
const propsOf = (el: Node): Node => (el.arguments[1] && el.arguments[1].type === 'ObjectExpression' ? el.arguments[1] : null);
const prop = (props: Node, name: string): Node => props && props.properties.find((p: Node) => p.type === 'Property' && keyOf(p) === name);
const filled = (props: Node, name: string): boolean => {
  const p = prop(props, name);
  return !!p && !(p.value.type === 'Literal' && String(p.value.value ?? '').trim() === '');
};
const children = (n: Node): Node[] => Object.values(n).flatMap((v: any) => (Array.isArray(v) ? v : [v])).filter((c: any) => c && typeof c.type === 'string');
function strings(n: Node, out: string[] = []): string[] {
  if (!n) return out;
  if (n.type === 'Literal' && typeof n.value === 'string') out.push(n.value);
  else if (n.type === 'TemplateLiteral') n.quasis.forEach((q: Node) => out.push(q.value.cooked || ''));
  else children(n).forEach((c) => strings(c, out));
  return out;
}
function hidden(props: Node): boolean {
  const ah = prop(props, 'aria-hidden');
  if (ah && !(ah.value.type === 'Literal' && (ah.value.value === false || ah.value.value === 'false'))) return true;
  const cn = prop(props, 'className');
  return !!cn && strings(cn.value).some((s) => s.split(/\s+/).includes('hidden'));
}
function hasText(node: Node, icons: Set<string>): boolean {
  if (!node) return false;
  switch (node.type) {
    case 'Literal': return typeof node.value === 'number' || (typeof node.value === 'string' && node.value.trim() !== '');
    case 'TemplateLiteral': return true;
    case 'ConditionalExpression': return hasText(node.consequent, icons) && hasText(node.alternate, icons);
    case 'LogicalExpression': return node.operator === '&&' ? false : hasText(node.left, icons) || hasText(node.right, icons);
    case 'ArrayExpression': return node.elements.some((e: Node) => hasText(e, icons));
    case 'CallExpression': {
      if (!isH(node)) return true;
      const props = propsOf(node);
      if (hidden(props)) return false;
      const t = tagName(node.arguments[0]);
      if (t === 'img') return filled(props, 'alt');
      if (t === 'svg' || icons.has(t)) return false;
      if (filled(props, 'aria-label')) return true;
      return node.arguments.slice(2).some((c: Node) => hasText(c, icons));
    }
    default: return true;
  }
}

/** The icon-only controls in one TSX source that lack aria-label or title, and how many controls it has. */
function unnamedIn(file: string, code: string, transformSync: any, parseAst: any): { controls: number; skipped: number; unnamed: Unnamed[] } {
  const out = transformSync(code, { loader: 'tsx', jsx: 'transform', jsxFactory: '__h', jsxFragment: '__F', target: 'esnext', sourcemap: 'external', sourcefile: file });
  const map = lineMap(JSON.parse(out.map).mappings);
  const starts = [0];
  for (let i = 0; i < out.code.length; i++) if (out.code[i] === '\n') starts.push(i + 1);
  const lineOf = (off: number): number => {
    let l = 0;
    while (l + 1 < starts.length && starts[l + 1] <= off) l++;
    let best: number[] | undefined = (map[l] || [])[0];
    for (const s of map[l] || []) if (s[0] <= off - starts[l]) best = s;
    return best ? best[1] + 1 : 0;
  };
  const ast = parseAst(out.code);
  const icons = new Set<string>();
  for (const st of ast.body) if (st.type === 'ImportDeclaration' && /lucide-react|react-icons|heroicons/.test(String(st.source.value))) st.specifiers.forEach((s: Node) => icons.add(s.local.name));
  const unnamed: Unnamed[] = [];
  let controls = 0;
  let skipped = 0;
  const visit = (n: Node): void => {
    if (isH(n)) {
      const t = tagName(n.arguments[0]);
      const base = t.split('.').pop() as string;
      const props = propsOf(n);
      const role = prop(props, 'role');
      const field = ['input', 'select', 'textarea'].includes(base);
      if (!field && (base === 'button' || base === 'a' || t === 'Link' || t === 'NavLink' || (role && role.value.type === 'Literal' && ROLES.has(String(role.value.value))))) {
        controls++;
        const raw = n.arguments[1];
        const spread = (raw && raw.type !== 'ObjectExpression' && !(raw.type === 'Literal' && raw.value === null)) || (!!props && props.properties.some((p: Node) => p.type === 'SpreadElement'));
        const iconOnly = !n.arguments.slice(2).some((c: Node) => hasText(c, icons));
        if (spread && !(filled(props, 'aria-label') && filled(props, 'title'))) skipped++;
        else if (iconOnly) {
          const missing = [!(filled(props, 'aria-label') || filled(props, 'aria-labelledby')) ? 'aria-label' : '', !filled(props, 'title') ? 'title' : ''].filter(Boolean);
          if (missing.length) unnamed.push({ file, line: lineOf(n.start), tag: t, missing });
        }
      }
    }
    children(n).forEach(visit);
  };
  visit(ast);
  return { controls, skipped, unnamed };
}

/** The app's TSX files (tests left out) under `dirs`, relative to `root`. */
function tsxFiles(root: string, dirs: string[], fs: any, path: any): string[] {
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) files.push(path.relative(root, p).replace(/\\/g, '/'));
    }
  };
  for (const d of dirs) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
  return files;
}

const FIXTURE = `import { X, Calendar, Loader2 } from 'lucide-react';
const A = () => <>
  <button onClick={close}><X /></button>
  <button aria-label="Close" title="Close" onClick={close}><X /></button>
  <a href="/planner"><Calendar /><span className="hidden md:inline">Planner</span></a>
  <button>{busy ? <Loader2 /> : 'Save'}</button>
  <button>Save</button>
  <button title="Close"><X /></button>
  <label><input type="checkbox" role="switch" /> Remind me</label>
</>;`;

// The first esbuild call starts its binary and the scan transforms every TSX file: on a loaded machine that is
// longer than vitest's 5 s default.
const SLOW = 60_000;

describe('PWA.A11Y-NAMES: icon-only controls have an accessible name', () => {
  it('the check flags an icon-only control, a label hidden below a breakpoint, a spinner-only state and a title alone, and passes named ones', () => {
    const r = unnamedIn('fixture.tsx', FIXTURE, transformSync, parseAst);
    const got = r.unnamed.map((u) => `${u.line} ${u.missing.join('+')}`);
    expect(r.controls).toBe(6);
    expect(got).toEqual(['3 aria-label+title', '5 aria-label+title', '6 aria-label+title', '8 aria-label']);
  }, SLOW);
  it('no icon-only button or link in the app lacks its aria-label and title', () => {
    const root = process.cwd();
    const files = tsxFiles(root, ["src"], fs, path);
    let controls = 0;
    const unnamed: string[] = [];
    for (const f of files) {
      const r = unnamedIn(f, fs.readFileSync(path.join(root, f), 'utf8'), transformSync, parseAst);
      controls += r.controls;
      unnamed.push(...r.unnamed.map((u) => `${u.file}:${u.line} <${u.tag}> needs ${u.missing.join(' + ')}`));
    }
    // A check that reads nothing must not pass as a check that found nothing.
    expect(files.length).toBeGreaterThan(10);
    expect(controls).toBeGreaterThan(80);
    expect(unnamed).toEqual([]);
  }, SLOW);
});
