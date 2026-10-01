#!/usr/bin/env node
/**
 * quilt CLI — the entry point for working with sheets from the terminal.
 *
 * Commands:
 *   quilt init [name]              Scaffold a new sheet
 *   quilt run <sheet>              Run a sheet, watch cells update
 *   quilt serve <sheet>            Serve a sheet (stdio MCP or TUI)
 *   quilt get <sheet> <cell>       Get a cell's value
 *   quilt set <sheet> <cell> <v>   Set a cell's value
 *   quilt test <sheet>             Run cell tests
 *   quilt inspect <sheet>          Show sheet structure
 *   quilt validate <file>          Validate a manifest against the JSON Schema
 *                                  (optionally --check-exists to verify preconditions)
 *   quilt resolve <uri>            Resolve a Quilt URI (template substitution + version pinning)
 *   help                           Show this help
 *
 * The CLI is intentionally minimal — the real power is in the runtime
 * and the embedding surfaces (TUI, MCP, Web).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { QuiltEngine, parseSheet } from '@quilt/core';
import { startMcpServer } from '@quilt/mcp';
import { validateManifest, resolveArtifact, resolveTemplate, InMemoryArtifactStore } from '@quilt/sdk';
const HELP = `
quilt — a spreadsheet where every cell is a live, addressable capability

USAGE:
  quilt <command> [args]

COMMANDS:
  init [name]                  Scaffold a new sheet
  run <sheet>                  Run a sheet, print live cell values
  serve <sheet> [--mcp]        Serve a sheet (TUI by default, --mcp for MCP stdio)
  get <sheet> <cell>           Get a cell's current value
  set <sheet> <cell> <v>       Set a cell's value
  test <sheet>                 Run cell tests
  inspect <sheet>              Show sheet structure as a tree
  validate <file>              Validate a manifest against the JSON Schema
    --check-exists             Also verify artifact_exists preconditions
    --run-id <id>              Provide run_id for templating in preconditions
  resolve <uri>                Resolve a Quilt URI
    --run-id <id>              Provide run_id for templating
  help                         Show this help

EXAMPLES:
  quilt init my-autopilot
  quilt run examples/boat-autopilot/sheet.yaml
  quilt serve examples/agent-dashboard/sheet.yaml --mcp
  quilt get examples/boat-autopilot/sheet.yaml rudder.command
  quilt validate examples/train-classifier.manifest.yaml
  quilt resolve 'quilt://ml/models:{{run_id}}' --run-id r-20260819-01
`;
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    switch (command) {
        case 'init':
            return init(args[1]);
        case 'run':
            return runSheet(args[1]);
        case 'serve':
            return serveSheet(args[1], args.includes('--mcp'));
        case 'get':
            return getCell(args[1], args[2]);
        case 'set':
            return setCell(args[1], args[2], args[3]);
        case 'inspect':
            return inspect(args[1]);
        case 'test':
            return testSheet(args[1]);
        case 'validate':
            return validateCmd(args[1], args);
        case 'resolve':
            return resolveCmd(args[1], args);
        case 'help':
        case '--help':
        case '-h':
        case undefined:
            console.log(HELP);
            return;
        default:
            console.error(`unknown command: ${command}`);
            console.log(HELP);
            process.exit(1);
    }
}
async function loadSheet(path) {
    const abs = resolve(path);
    const source = await readFile(abs, 'utf8');
    const sheet = parseSheet(source);
    const engine = new QuiltEngine(sheet.id);
    engine.loadSheet(sheet);
    return { engine, sheet };
}
async function init(name) {
    const projectName = name ?? 'my-quilt-sheet';
    const template = `id: ${projectName}
title: "${projectName}"
description: "A new Quilt sheet"
version: 0.1.0

axes:
  rows: { name: instance }
  cols: { name: capability }

cells:
  - id: hello
    kind: value
    value: "Hello, Quilt!"
    description: "A static value cell"

  - id: greeting
    kind: formula
    expr: "=hello + ' Welcome to the grid.'"
    description: "A formula that depends on hello"

  - id: doubled
    kind: formula
    expr: "=2 * 3"
    description: "Pure computation"
`;
    const fs = await import('node:fs/promises');
    const filename = `${projectName}.quilt.yaml`;
    await fs.writeFile(filename, template, 'utf8');
    console.log(`✓ Scaffolded ${filename}`);
    console.log(`  Run with: quilt run ${filename}`);
    console.log(`  Inspect:  quilt inspect ${filename}`);
}
async function runSheet(path) {
    if (!path) {
        console.error('usage: quilt run <sheet>');
        process.exit(1);
    }
    const { engine, sheet } = await loadSheet(path);
    console.log(`▶ Running sheet: ${sheet.id} (${sheet.title ?? ''})`);
    console.log(`  ${engine.listCells().length} cells loaded.\n`);
    for (const cell of engine.listCells()) {
        try {
            const v = await engine.get(cell.id);
            const symbol = kindSymbol(cell.def.kind);
            const status = v.status === 'ready' ? '✓' : v.status === 'error' ? '✗' : '…';
            const value = formatValue(v.data);
            console.log(`  ${symbol} ${cell.id.padEnd(30)} [${cell.def.kind.padEnd(8)}] ${status} ${value}`);
        }
        catch (err) {
            console.error(`  ! ${cell.id} failed:`, err);
        }
    }
}
async function serveSheet(path, mcp = false) {
    if (!path) {
        console.error('usage: quilt serve <sheet> [--mcp]');
        process.exit(1);
    }
    const { engine, sheet } = await loadSheet(path);
    if (mcp) {
        console.error(`[quilt] serving sheet '${sheet.id}' as MCP server on stdio`);
        await startMcpServer(engine, { sheetName: sheet.id });
        return;
    }
    // Default: TUI (basic — full TUI in @quilt/tui)
    console.log(`▶ Serving sheet: ${sheet.id}`);
    console.log('  (TUI mode — install @quilt/tui for the full experience)');
    console.log('  (Use --mcp to expose as MCP server)\n');
    await runSheet(path);
}
async function getCell(path, cellId) {
    if (!path || !cellId) {
        console.error('usage: quilt get <sheet> <cell>');
        process.exit(1);
    }
    const { engine } = await loadSheet(path);
    const v = await engine.get(cellId);
    console.log(JSON.stringify(v, null, 2));
}
async function setCell(path, cellId, value) {
    if (!path || !cellId || value === undefined) {
        console.error('usage: quilt set <sheet> <cell> <value>');
        process.exit(1);
    }
    const { engine } = await loadSheet(path);
    let parsed = value;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        // keep as string
    }
    await engine.set(cellId, parsed);
    console.log(`✓ set ${cellId} = ${JSON.stringify(parsed)}`);
}
async function inspect(path) {
    if (!path) {
        console.error('usage: quilt inspect <sheet>');
        process.exit(1);
    }
    const { engine } = await loadSheet(path);
    const cells = engine.listCells();
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Sheet: ${engine.id}`);
    console.log(`Cells: ${cells.length}`);
    console.log(`${'─'.repeat(70)}\n`);
    // Group by kind
    const byKind = new Map();
    for (const cell of cells) {
        if (!byKind.has(cell.def.kind))
            byKind.set(cell.def.kind, []);
        byKind.get(cell.def.kind).push(cell);
    }
    for (const [kind, group] of byKind) {
        console.log(`[${kind}] (${group.length})`);
        for (const cell of group) {
            const deps = Array.from(cell.dependencies);
            const depStr = deps.length ? ` ← ${deps.join(', ')}` : '';
            const desc = cell.def.description ? ` — ${cell.def.description}` : '';
            console.log(`  ${cell.id}${depStr}${desc}`);
        }
        console.log();
    }
}
async function testSheet(path) {
    if (!path) {
        console.error('usage: quilt test <sheet>');
        process.exit(1);
    }
    const { engine } = await loadSheet(path);
    let passed = 0;
    let failed = 0;
    for (const cell of engine.listCells()) {
        try {
            const v = await engine.get(cell.id);
            if (v.status === 'ready') {
                passed++;
                console.log(`  ✓ ${cell.id}`);
            }
            else if (v.status === 'error') {
                failed++;
                console.log(`  ✗ ${cell.id}: ${v.error?.message}`);
            }
            else {
                passed++;
                console.log(`  · ${cell.id} (${v.status})`);
            }
        }
        catch (err) {
            failed++;
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`  ✗ ${cell.id}: ${msg}`);
        }
    }
    console.log(`\n${passed} passed, ${failed} failed (${engine.listCells().length} total)`);
    if (failed > 0)
        process.exit(1);
}
/**
 * `quilt validate <file>` — validate a manifest against the Quilt
 * manifest JSON Schema, with optional precondition checks.
 *
 * Examples:
 *   quilt validate my-manifest.yaml
 *   quilt validate my-manifest.yaml --check-exists
 *   quilt validate my-manifest.yaml --check-exists --run-id r-20260819-01
 */
async function validateCmd(path, args) {
    if (!path) {
        console.error('usage: quilt validate <file> [--check-exists] [--run-id <id>]');
        process.exit(1);
    }
    const abs = resolve(path);
    const source = await readFile(abs, 'utf8');
    // The file may be a Quilt sheet (which has cells) or a plain manifest
    // (which is a JSON object matching the manifest schema). Detect by
    // attempting JSON parse first; if that fails, parse as YAML and look
    // for a `manifest` top-level key or treat the whole file as a sheet.
    let manifest;
    const trimmed = source.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        manifest = JSON.parse(source);
    }
    else {
        const yaml = await import('yaml');
        const parsed = yaml.parse(source);
        // If it has cells, it's a sheet — extract the manifest envelope
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.cells)) {
            manifest = parsed;
        }
        else {
            manifest = parsed;
        }
    }
    const checkExists = args.includes('--check-exists');
    const runIdIdx = args.indexOf('--run-id');
    const runId = runIdIdx > -1 ? args[runIdIdx + 1] : undefined;
    const runContext = runId ? { runId, timestamp: new Date().toISOString() } : { timestamp: new Date().toISOString() };
    const store = checkExists ? new InMemoryArtifactStore() : undefined;
    const result = await validateManifest(manifest, {
        store,
        checkExists,
        runContext,
    });
    if (result.valid) {
        console.log(`✓ Valid manifest: ${path}`);
        if (checkExists) {
            console.log(`  ✓ All artifact_exists preconditions satisfied`);
        }
        // Show a quick summary
        const m = manifest;
        if (m.id)
            console.log(`  id:        ${m.id}`);
        if (m.version)
            console.log(`  version:   ${m.version}`);
        if (m.provenance_tags?.length)
            console.log(`  tags:      ${m.provenance_tags.join(', ')}`);
        return;
    }
    console.error(`✗ Invalid manifest: ${path}`);
    for (const err of result.errors) {
        console.error(`  ${err.path}: ${err.message}`);
    }
    process.exit(1);
}
/**
 * `quilt resolve <uri>` — resolve a Quilt URI: template substitution
 * plus (optionally) version pinning against a store.
 *
 * Examples:
 *   quilt resolve 'quilt://ml/models:{{run_id}}' --run-id r-01
 */
async function resolveCmd(uri, args) {
    if (!uri) {
        console.error('usage: quilt resolve <uri> [--run-id <id>]');
        process.exit(1);
    }
    const runIdIdx = args.indexOf('--run-id');
    const runId = runIdIdx > -1 ? args[runIdIdx + 1] : undefined;
    const runContext = { runId, timestamp: new Date().toISOString() };
    // First show the template substitution
    let templated;
    try {
        templated = resolveTemplate(uri, runContext);
        if (templated !== uri) {
            console.log(`Template:    ${uri}`);
            console.log(`Substituted: ${templated}`);
        }
    }
    catch (err) {
        console.error(`✗ Template error: ${err.message}`);
        process.exit(1);
    }
    // Then resolve against an in-memory store (in production this would
    // hit the user's configured Quilt backend)
    const store = new InMemoryArtifactStore();
    const result = await resolveArtifact(uri, runContext, store);
    console.log(`Version:     ${result.version}`);
    console.log(`Resolved:    ${result.resolvedUri}`);
}
function kindSymbol(kind) {
    switch (kind) {
        case 'value': return '○';
        case 'formula': return 'ƒ';
        case 'api': return '↗';
        case 'program': return '⚙';
        case 'sensor': return '◉';
        case 'listener': return '⚡';
        case 'router': return '⇄';
        case 'io': return '⇆';
        default: return '?';
    }
}
function formatValue(v) {
    if (v === undefined)
        return '∅';
    if (v === null)
        return 'null';
    if (typeof v === 'string')
        return `"${v.length > 40 ? v.slice(0, 40) + '…' : v}"`;
    if (typeof v === 'object') {
        const s = JSON.stringify(v);
        return s.length > 40 ? s.slice(0, 40) + '…' : s;
    }
    return String(v);
}
main().catch((err) => {
    console.error('[quilt] error:', err);
    process.exit(1);
});
