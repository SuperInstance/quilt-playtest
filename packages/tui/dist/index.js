//! # index.ts
//!
//! The Quilt TUI — terminal-native view of a running engine.
//!
//! ## Role in the system
//!
//! The TUI is one of the three "surfaces" of Quilt (alongside
//! the CLI and the MCP server). It sits on top of the engine
//! and gives a human operator a focused, keyboard-driven view of:
//!
//! - Every cell in the current sheet
//! - The cell's value, status, and error (if any)
//! - The cell's dependencies and dependents
//! - The current caller context
//!
//! ## Architecture
//!
//! The TUI is a state machine. Each keystroke updates the state;
//! each state change triggers a re-render. The renderer is pure
//! (see `render.ts`), so we can swap in different renderers
//! (e.g. a web UI later) without changing the state machine.
//!
//! ```text
//!   ┌────────────┐  keystrokes   ┌────────────┐  render()   ┌──────────┐
//!   │ KeyReader  │ ────────────► │   TuiApp   │ ──────────► │  stdout  │
//!   └────────────┘               └────────────┘             └──────────┘
//!                                       │
//!                                       │ engine.subscribe()
//!                                       ▼
//!                                 ┌────────────┐
//!                                 │   Engine   │
//!                                 └────────────┘
//! ```
//!
//! ## Used by
//!
//! - Users who want to inspect / debug a running engine.
//! - The `quilt-tui` binary in `bin/`.
//! - Future: agents that prefer text output over structured JSON.
import { render } from './render.js';
import { KeyReader } from './input.js';
// =============================================================================
// The TUI class
// =============================================================================
/** The TUI application. One per running session. */
export class QuiltTui {
    state;
    reader;
    engine;
    frame = 0;
    redrawTimer = null;
    running = false;
    subscriptions = [];
    constructor(engine) {
        this.engine = engine;
        this.state = {
            sheetId: engine.id,
            cells: [],
            selectedIndex: 0,
            selectedId: null,
            viewTop: 0,
            viewportHeight: 15,
            mode: 'normal',
            editBuffer: null,
            status: null,
        };
        this.reader = new KeyReader();
        this.refreshCells();
    }
    /** Start the TUI. Returns when the user quits. */
    async run() {
        this.running = true;
        this.subscribeToEngine();
        this.reader.start();
        this.reader.on('key', (key) => this.handleKey(key));
        this.scheduleRedraw();
    }
    /** Stop the TUI, restoring the terminal. */
    shutdown() {
        this.running = false;
        this.subscriptions.forEach((s) => s.dispose());
        this.subscriptions = [];
        this.reader.shutdown();
        if (this.redrawTimer) {
            clearTimeout(this.redrawTimer);
            this.redrawTimer = null;
        }
    }
    // ===========================================================================
    // State management
    // ===========================================================================
    /** Re-pull all cell state from the engine. */
    async refreshCells() {
        const cells = this.engine.listCells();
        this.state.cells = await Promise.all(cells.map((c) => this.cellToRow(c.def)));
        // Update selectedId based on selectedIndex.
        this.state.selectedId = this.state.cells[this.state.selectedIndex]?.id ?? null;
    }
    /** Convert a CellDef to a CellRow for display. */
    async cellToRow(def) {
        let value = '';
        let error = null;
        let status = 'ready';
        try {
            // Read the current value. This may fail for cells that need
            // inputs we don't have (e.g. an api cell needing a caller).
            const v = await this.engine.get(def.id, { timestamp: Date.now() });
            value = this.formatValue(v);
            status = v.status;
            error = v.error?.message ?? null;
        }
        catch (e) {
            error = e instanceof Error ? e.message : String(e);
            status = 'error';
        }
        return {
            id: def.id,
            kind: def.kind,
            value,
            status,
            error,
            dependencies: [], // populated below
            dependents: [],
        };
    }
    /** Format a CellValue as a string for display. */
    formatValue(v) {
        if (v.data === null || v.data === undefined)
            return 'null';
        if (typeof v.data === 'string')
            return v.data;
        if (typeof v.data === 'number' || typeof v.data === 'boolean')
            return String(v.data);
        try {
            return JSON.stringify(v.data);
        }
        catch {
            return String(v.data);
        }
    }
    // ===========================================================================
    // Input handling
    // ===========================================================================
    handleKey(key) {
        if (this.state.mode === 'normal')
            this.handleNormalKey(key);
        else if (this.state.mode === 'edit')
            this.handleEditKey(key);
        else if (this.state.mode === 'set')
            this.handleSetKey(key);
        else if (this.state.mode === 'command')
            this.handleCommandKey(key);
        this.scheduleRedraw();
    }
    handleNormalKey(key) {
        if (key.type === 'char') {
            if (key.char === 'q') {
                this.shutdown();
                return;
            }
            if (key.char === 'j' || key.char === '\x1b[B')
                this.moveSelection(1);
            else if (key.char === 'k' || key.char === '\x1b[A')
                this.moveSelection(-1);
            else if (key.char === 'g')
                this.moveSelection(-this.state.cells.length);
            else if (key.char === 'G')
                this.moveSelection(this.state.cells.length);
            else if (key.char === 'e')
                this.enterEdit();
            else if (key.char === 's')
                this.enterSet();
            else if (key.char === ':')
                this.enterCommand();
            else if (key.char === 'r')
                this.reload();
        }
        else if (key.type === 'ctrl' && key.char === 'c') {
            this.shutdown();
            return;
        }
        else if (key.type === 'up')
            this.moveSelection(-1);
        else if (key.type === 'down')
            this.moveSelection(1);
        else if (key.type === 'pageup')
            this.moveSelection(-this.state.viewportHeight);
        else if (key.type === 'pagedown')
            this.moveSelection(this.state.viewportHeight);
        else if (key.type === 'home') {
            this.state.selectedIndex = 0;
            this.state.selectedId = this.state.cells[0]?.id ?? null;
        }
        else if (key.type === 'end') {
            this.state.selectedIndex = this.state.cells.length - 1;
            this.state.selectedId = this.state.cells[this.state.selectedIndex]?.id ?? null;
        }
    }
    handleEditKey(key) {
        if (key.type === 'escape') {
            this.state.mode = 'normal';
            this.state.editBuffer = null;
            return;
        }
        if (key.type === 'enter') {
            this.commitEdit();
            return;
        }
        if (key.type === 'backspace') {
            if (this.state.editBuffer && this.state.editBuffer.length > 0) {
                this.state.editBuffer = this.state.editBuffer.slice(0, -1);
            }
            return;
        }
        if (key.type === 'char') {
            this.state.editBuffer = (this.state.editBuffer ?? '') + key.char;
        }
    }
    handleSetKey(key) {
        if (key.type === 'escape') {
            this.state.mode = 'normal';
            this.state.editBuffer = null;
            return;
        }
        if (key.type === 'enter') {
            this.commitSet();
            return;
        }
        if (key.type === 'backspace') {
            if (this.state.editBuffer && this.state.editBuffer.length > 0) {
                this.state.editBuffer = this.state.editBuffer.slice(0, -1);
            }
            return;
        }
        if (key.type === 'char') {
            this.state.editBuffer = (this.state.editBuffer ?? '') + key.char;
        }
    }
    handleCommandKey(key) {
        if (key.type === 'escape') {
            this.state.mode = 'normal';
            this.state.editBuffer = null;
            return;
        }
        if (key.type === 'enter') {
            this.runCommand();
            return;
        }
        if (key.type === 'backspace') {
            if (this.state.editBuffer && this.state.editBuffer.length > 0) {
                this.state.editBuffer = this.state.editBuffer.slice(0, -1);
            }
            return;
        }
        if (key.type === 'char') {
            this.state.editBuffer = (this.state.editBuffer ?? '') + key.char;
        }
    }
    // ===========================================================================
    // Mode transitions
    // ===========================================================================
    enterEdit() {
        const cell = this.state.cells[this.state.selectedIndex];
        if (!cell)
            return;
        this.state.mode = 'edit';
        this.state.editBuffer = cell.value;
    }
    enterSet() {
        this.state.mode = 'set';
        this.state.editBuffer = '';
    }
    enterCommand() {
        this.state.mode = 'command';
        this.state.editBuffer = '';
    }
    commitEdit() {
        // For the MVP, "edit" just shows a status message — real
        // edit-in-place is non-trivial because we don't know the
        // cell's value type. Use `s` to set a value instead.
        this.state.status = 'use s to set a new value (edit is read-only in MVP)';
        this.state.mode = 'normal';
        this.state.editBuffer = null;
    }
    async commitSet() {
        const cell = this.state.cells[this.state.selectedIndex];
        if (!cell) {
            this.state.mode = 'normal';
            this.state.editBuffer = null;
            return;
        }
        const raw = (this.state.editBuffer ?? '').trim();
        try {
            // Try to parse as JSON; fall back to string.
            const v = raw.startsWith('"') || raw.startsWith('{') || raw.startsWith('[') || raw === 'null' || raw === 'true' || raw === 'false' || /^-?\d/.test(raw)
                ? JSON.parse(raw)
                : raw;
            await this.engine.set(cell.id, v, { timestamp: Date.now() });
            this.state.status = `set ${cell.id} = ${JSON.stringify(v)}`;
            this.refreshCells();
        }
        catch (e) {
            this.state.status = `set failed: ${e instanceof Error ? e.message : String(e)}`;
        }
        this.state.mode = 'normal';
        this.state.editBuffer = null;
    }
    runCommand() {
        const cmd = (this.state.editBuffer ?? '').trim();
        if (cmd === 'reload' || cmd === 'r') {
            this.reload();
        }
        else if (cmd === 'help' || cmd === '?') {
            this.state.status = 'commands: reload, help';
        }
        else if (cmd === 'quit' || cmd === 'q') {
            this.shutdown();
        }
        else {
            this.state.status = `unknown command: ${cmd}`;
        }
        this.state.mode = 'normal';
        this.state.editBuffer = null;
    }
    reload() {
        this.refreshCells();
        this.state.status = 'reloaded';
    }
    // ===========================================================================
    // Selection
    // ===========================================================================
    moveSelection(delta) {
        if (this.state.cells.length === 0)
            return;
        const next = Math.max(0, Math.min(this.state.cells.length - 1, this.state.selectedIndex + delta));
        this.state.selectedIndex = next;
        this.state.selectedId = this.state.cells[next]?.id ?? null;
        // Scroll the viewport if needed.
        if (next < this.state.viewTop) {
            this.state.viewTop = next;
        }
        else if (next >= this.state.viewTop + this.state.viewportHeight) {
            this.state.viewTop = next - this.state.viewportHeight + 1;
        }
    }
    // ===========================================================================
    // Rendering
    // ===========================================================================
    /** Schedule a re-render. Coalesces multiple state changes. */
    scheduleRedraw() {
        if (this.redrawTimer)
            return;
        this.redrawTimer = setTimeout(() => {
            this.redrawTimer = null;
            this.draw();
        }, 16); // ~60fps
    }
    /** Force an immediate redraw. */
    draw() {
        if (!this.running)
            return;
        // Move cursor to top-left, then render. The renderer's
        // trailing \x1b[J wipes the rest of the screen.
        process.stdout.write('\x1b[H' + render(this.state));
    }
    // ===========================================================================
    // Engine subscription
    // ===========================================================================
    /**
     * Subscribe to engine changes. The TypeScript engine exposes
     * `subscribe(cellId, callback)`. We subscribe to every cell
     * and on any change, refresh the affected row.
     */
    subscribeToEngine() {
        for (const cell of this.engine.listCells()) {
            const id = cell.def.id;
            const subId = this.engine.subscribe(id, (newValue) => {
                // Find the row and update it.
                const row = this.state.cells.find((c) => c.id === id);
                if (!row)
                    return;
                row.value = this.formatValue(newValue);
                row.status = newValue.status;
                row.error = newValue.error?.message ?? null;
                this.scheduleRedraw();
            });
            this.subscriptions.push({ dispose: () => this.engine.unsubscribe(subId) });
        }
    }
}
// =============================================================================
// Convenience: start the TUI for an engine
// =============================================================================
/**
 * Start the TUI for an engine. Returns a promise that resolves
 * when the user quits.
 */
export async function startTui(engine) {
    const tui = new QuiltTui(engine);
    try {
        await tui.run();
    }
    finally {
        tui.shutdown();
    }
}
