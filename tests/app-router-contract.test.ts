/**
 * App Router contract + route-module discipline, checked with the TypeScript compiler.
 *
 * Why this file exists
 * --------------------
 * `npm run typecheck` runs `tsc --noEmit` over the sources. The App Router's own prop contracts are
 * NOT in the sources — Next.js generates them into `.next/types/**` during a build, and only the
 * `next build` "checking validity of types" step compares a page's `searchParams` against them. So a
 * page can pass `npm run typecheck` and still fail `npm run build`, which is exactly what happened to
 * `src/app/episodes/page.tsx`: CI went red on the build step with
 *
 *     Type '{ searchParams?: Record<…> | Promise<Record<…>> | undefined; }' does not satisfy the
 *     constraint 'PageProps'.
 *
 * because Next 15 always hands `params`/`searchParams` to a page as a **Promise**, and a union with a
 * plain `Record` is not assignable to `PageProps`. The same is true of route modules: Next's generated
 * entry validator rejects *any* extra runtime export from a `route.ts` (`checkFields<Diff<{GET?:…},
 * TEntry>>`), so a helper exported next to `POST` fails the build even though `tsc` is happy with it.
 *
 * This suite asserts both invariants with the real compiler over every file in `src/app`, in the test
 * step — which CI runs *before* the build — so the failure arrives as a named assertion instead of a
 * build-time type error 40 seconds later. It is a static check: nothing here renders a page.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const APP_DIR = path.resolve(new URL("../src/app", import.meta.url).pathname);

/** Runtime exports Next.js accepts from a `route.ts` (the generated validator's key set). */
const ROUTE_EXPORTS = new Set([
  "GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE", "PATCH",
  "config", "generateStaticParams", "revalidate", "dynamic", "dynamicParams",
  "fetchCache", "preferredRegion", "runtime", "maxDuration",
]);

/** Runtime exports Next.js accepts from a `page.tsx` or `layout.tsx`. */
const PAGE_EXPORTS = new Set([
  "default", "config", "generateStaticParams", "revalidate", "dynamic", "dynamicParams",
  "fetchCache", "preferredRegion", "runtime", "maxDuration",
  "metadata", "generateMetadata", "viewport", "generateViewport", "experimental_ppr",
]);

const ROUTE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE", "PATCH"]);
/** Props Next.js passes as a Promise. A plain object, or a union with one, is the bug this catches. */
const PROMISE_PROPS = new Set(["params", "searchParams"]);

interface AppFile {
  file: string;
  rel: string;
  kind: "route" | "page" | "layout" | "other";
  source: ts.SourceFile;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function classify(file: string): AppFile["kind"] {
  const base = path.basename(file);
  if (base === "route.ts") return "route";
  if (base === "page.tsx") return "page";
  if (base === "layout.tsx") return "layout";
  return "other";
}

const FILES: AppFile[] = walk(APP_DIR).map((file) => ({
  file,
  rel: path.relative(path.resolve(new URL("..", import.meta.url).pathname), file),
  kind: classify(file),
  source: ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
}));

/** The names a module exports at runtime — type-only exports are erased and do not count. */
function runtimeExports(sf: ts.SourceFile): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isExported = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

    // Interfaces and type aliases are erased at runtime; enums are not, so they count.
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;

    if (isExported && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) {
      // `export default function FooPage()` exports only `default` — the identifier is local, not a
      // second runtime export, so it must not be reported as one.
      if (mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) names.push("default");
      else names.push(node.name.text);
    } else if (isExported && ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.push(d.name.text);
      }
    } else if (ts.isExportAssignment(node)) {
      names.push("default");
    } else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      // `export type { X }` and `export { type X }` are both erased — neither is a runtime export.
      if (node.isTypeOnly) return;
      for (const el of node.exportClause.elements) {
        if (!el.isTypeOnly) names.push(el.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return [...new Set(names)];
}

/** True only for `Promise<…>` — a union containing anything else is not a Next 15 prop type. */
function isPromiseType(node: ts.TypeNode | undefined): boolean {
  return !!node && ts.isTypeReferenceNode(node) && node.typeName.getText() === "Promise";
}

function describeType(node: ts.TypeNode | undefined): string {
  return node ? node.getText().replace(/\s+/g, " ").slice(0, 120) : "(unannotated)";
}

/** Every `params`/`searchParams` property in a props/context type literal, with its annotation. */
function promisePropsIn(typeNode: ts.TypeNode | undefined): Array<{ name: string; type: ts.TypeNode | undefined }> {
  if (!typeNode) return [];
  const found: Array<{ name: string; type: ts.TypeNode | undefined }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertySignature(node) && ts.isIdentifier(node.name) && PROMISE_PROPS.has(node.name.text)) {
      found.push({ name: node.name.text, type: node.type });
    }
    ts.forEachChild(node, visit);
  };
  visit(typeNode);
  return found;
}

// --------------------------------------------------------------------------- the suite

test("app router: every src/app file parses and is classified", () => {
  assert.ok(FILES.length > 100, `expected the whole app tree, found ${FILES.length} files`);
  const routes = FILES.filter((f) => f.kind === "route").length;
  const pages = FILES.filter((f) => f.kind === "page").length;
  const layouts = FILES.filter((f) => f.kind === "layout").length;
  assert.ok(routes > 100, `expected the API surface, found ${routes} route.ts files`);
  assert.ok(pages > 40, `expected the page surface, found ${pages} page.tsx files`);
  assert.ok(layouts >= 1, "expected at least one layout.tsx");
});

test("app router: params/searchParams are always Promises, never a union with a plain object", () => {
  const violations: string[] = [];
  for (const f of FILES) {
    if (f.kind === "other") continue;
    const wanted = f.kind === "route" ? ROUTE_METHODS : new Set(["default"]);
    ts.forEachChild(f.source, (node) => {
      if (!ts.isFunctionDeclaration(node) || !node.name) return;
      const isDefault = ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      if (!(wanted.has(node.name.text) || (wanted.has("default") && isDefault))) return;
      for (const param of node.parameters) {
        for (const prop of promisePropsIn(param.type)) {
          if (!isPromiseType(prop.type)) {
            violations.push(`${f.rel} ${node.name.text}(): ${prop.name}: ${describeType(prop.type)} — Next 15 passes it as Promise<…>`);
          }
        }
      }
    });
  }
  assert.deepEqual(violations, [], `App Router prop contract violations:\n${violations.join("\n")}`);
});

test("app router: a page's props are never typed as a Record | Promise union", () => {
  // The union form is the specific shape that broke the production build: it satisfies neither the
  // sync nor the async contract, and `Diff<PageProps, …>` rejects it.
  const offenders = FILES.filter((f) => f.kind !== "other").filter((f) => {
    const text = f.source.getFullText();
    return /(?:searchParams|params)\s*\??\s*:\s*Record<[^;]*\|\s*Promise</.test(text)
      || /(?:searchParams|params)\s*\??\s*:\s*Promise<[^;]*\|\s*Record</.test(text);
  });
  assert.deepEqual(offenders.map((f) => f.rel), [], "params/searchParams must be a Promise, not a union with Record");
});

test("route modules: no runtime export besides the HTTP methods and route config", () => {
  const violations: string[] = [];
  for (const f of FILES.filter((x) => x.kind === "route")) {
    for (const name of runtimeExports(f.source)) {
      if (!ROUTE_EXPORTS.has(name)) {
        violations.push(`${f.rel} exports "${name}" — Next's entry validator rejects any extra runtime export from a route module; move the helper into src/core or src/lib`);
      }
    }
  }
  assert.deepEqual(violations, [], `route.ts export discipline:\n${violations.join("\n")}`);
});

test("page and layout modules: no runtime export besides the entry and route config", () => {
  const violations: string[] = [];
  for (const f of FILES.filter((x) => x.kind === "page" || x.kind === "layout")) {
    for (const name of runtimeExports(f.source)) {
      if (!PAGE_EXPORTS.has(name)) {
        violations.push(`${f.rel} exports "${name}" — only the default entry, metadata and route config may be exported`);
      }
    }
  }
  assert.deepEqual(violations, [], `page/layout export discipline:\n${violations.join("\n")}`);
});

test("every page.tsx and route.ts has the entry Next.js expects", () => {
  const missing: string[] = [];
  for (const f of FILES) {
    const names = runtimeExports(f.source);
    if (f.kind === "page" && !names.includes("default")) missing.push(`${f.rel}: no default export`);
    if (f.kind === "layout" && !names.includes("default")) missing.push(`${f.rel}: no default export`);
    if (f.kind === "route" && !names.some((n) => ROUTE_METHODS.has(n))) missing.push(`${f.rel}: exports no HTTP method`);
  }
  assert.deepEqual(missing, [], `missing entries:\n${missing.join("\n")}`);
});

test("route modules: dynamic params are awaited before use", () => {
  // `{ params }: { params: Promise<{ id: string }> }` must be read as `(await params).id`. A
  // synchronous `params.id` on a Promise silently yields undefined at runtime and typechecks fine.
  const violations: string[] = [];
  for (const f of FILES.filter((x) => x.kind === "route")) {
    const text = f.source.getFullText();
    if (!/params\s*:\s*Promise</.test(text)) continue;
    // Any bare `params.<field>` that is not `(await params).<field>` or `params.then` is suspect.
    const bare = text.match(/(?<![.\w])params\.(?!\s*then)[A-Za-z_]/g);
    if (bare && !/\(await params\)/.test(text) && !/await params\b/.test(text)) {
      violations.push(`${f.rel}: reads params.<field> without awaiting the Promise`);
    }
  }
  assert.deepEqual(violations, [], `unawaited params:\n${violations.join("\n")}`);
});
