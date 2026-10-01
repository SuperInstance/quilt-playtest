//! # render.ts
//!
//! The TUI's renderer. Pure functions: take data, return a string.
//! No I/O, no side effects. This is what makes the TUI testable.
//!
//! ## Why no TUI library
//!
//! We use raw ANSI escape codes directly. Why?
//!
//! - **No dependency**. A TUI library is a 5-10MB install. We
//!   avoid it.
//! - **No full-screen mode**. We don't use `process.stdout.isTTY`
//!   alt-screen, which means the TUI plays well with tmux/screen/
//!   and you can scroll back through history.
//! - **Testable**. Pure functions over strings. We can write
//!   snapshot tests that don't require a terminal.
//!
//! The cost is that we don't get resize handling or mouse
//! support. We don't need them — the TUI is a focused tool, not
//! a full IDE.
//!
//! ## Layout
//!
//! ```text
//! ┌─ Quilt TUI — sheet.id (N cells) ───────────────┐
//! │ ID                KIND     VALUE               │
//! │ a                 value    10                  │
//! │ b                 value    20                  │
//! │ > sum             formula  <error: ...>        │  ← selected
//! │ cool              formula  30                  │
//! ├─ Dependencies of: sum ──────────────────────────┤
//! │ a                                                  │
//! │ b                                                  │
//! ├─ Dependents of: sum ────────────────────────────┤
//! │ (none)                                             │
//! ├─ Keys: j/k=navigate  e=edit  s=set  r=reload  q=quit ─┤
//! └────────────────────────────────────────────────────────┘
//! ```
//!
//! The renderer takes a `TuiState` and produces a single string.
//! The string includes ANSI codes for colors and a clear-line at
//! the end. We use the cursor-restoration trick to keep the
//! position stable across redraws.
import { KIND_COLORS, RESET, BOLD, DIM, REVERSED, RED, GREEN, YELLOW, CYAN } from './ansi.js';
// =============================================================================
// Public API
// =============================================================================
/**
 * Render the full TUI frame to a string. The string ends with a
 * clear-to-end-of-screen escape so the previous frame's residue
 * (if any) is wiped.
 */
export function render(state) {
    const lines = [];
    lines.push(renderHeader(state));
    lines.push('');
    lines.push(renderCellList(state));
    lines.push('');
    lines.push(renderDependencies(state));
    lines.push('');
    lines.push(renderDependents(state));
    lines.push('');
    lines.push(renderModeBar(state));
    lines.push('');
    lines.push(renderHelpBar(state));
    // Clear the rest of the screen so the frame is bounded.
    return lines.join('\n') + '\x1b[J';
}
// =============================================================================
// Section renderers
// =============================================================================
function renderHeader(state) {
    const title = `${BOLD}Quilt TUI${RESET} — ${CYAN}${state.sheetId}${RESET} ` +
        `${DIM}(${state.cells.length} cells)${RESET}`;
    const status = state.status ? `  ${state.status}` : '';
    return `┌─ ${title}${status} ─`;
}
function renderCellList(state) {
    const lines = ['│'];
    const { cells, selectedIndex, viewTop, viewportHeight, mode } = state;
    // Compute visible range (with scroll).
    const top = Math.max(0, Math.min(viewTop, cells.length - 1));
    const bottom = Math.min(cells.length, top + viewportHeight);
    // Pad the id column to a fixed width for alignment.
    const idWidth = Math.max(8, ...cells.map((c) => c.id.length));
    for (let i = top; i < bottom; i++) {
        const cell = cells[i];
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? '│ > ' : '│   ';
        const idColor = isSelected ? `${REVERSED}` : '';
        const idText = cell.id.padEnd(idWidth);
        const kindText = `${KIND_COLORS[cell.kind] ?? ''}${cell.kind.padEnd(8)}${RESET}`;
        const valueText = formatCellValue(cell, mode);
        const line = `│${prefix}${idColor}${idText}${RESET}  ${kindText}  ${valueText}`;
        lines.push(line);
    }
    // Scroll indicator.
    if (cells.length > viewportHeight) {
        const showing = `${top + 1}–${bottom} of ${cells.length}`;
        lines.push(`│ ${DIM}… ${showing} …${RESET}`);
    }
    return lines.join('\n');
}
function renderDependencies(state) {
    const lines = [`├─ ${BOLD}Dependencies of:${RESET} ${state.selectedId ?? '(none selected)'} ─`];
    const cell = state.cells[state.selectedIndex];
    if (!cell) {
        lines.push('│ (no cell selected)');
    }
    else if (cell.dependencies.length === 0) {
        lines.push(`│ ${DIM}(none)${RESET}`);
    }
    else {
        for (const dep of cell.dependencies) {
            lines.push(`│   ${DIM}← ${dep}${RESET}`);
        }
    }
    return lines.join('\n');
}
function renderDependents(state) {
    const lines = [`├─ ${BOLD}Dependents of:${RESET} ${state.selectedId ?? '(none selected)'} ─`];
    const cell = state.cells[state.selectedIndex];
    if (!cell) {
        lines.push('│ (no cell selected)');
    }
    else if (cell.dependents.length === 0) {
        lines.push(`│ ${DIM}(none)${RESET}`);
    }
    else {
        for (const dep of cell.dependents) {
            lines.push(`│   ${DIM}→ ${dep}${RESET}`);
        }
    }
    return lines.join('\n');
}
function renderModeBar(state) {
    if (state.mode === 'edit') {
        return `├─ ${YELLOW}EDIT${RESET} ${state.editBuffer ?? ''}_ ─`;
    }
    else if (state.mode === 'set') {
        return `├─ ${YELLOW}SET${RESET} ${state.editBuffer ?? ''}_ ─`;
    }
    else if (state.mode === 'command') {
        return `├─ ${CYAN}:${RESET}${state.editBuffer ?? ''}_ ─`;
    }
    return `├─ ${BOLD}NORMAL${RESET} ─`;
}
function renderHelpBar(state) {
    const keys = state.mode === 'normal'
        ? 'j/k=navigate  g/G=top/bottom  e=edit  s=set  /=command  r=reload  q=quit'
        : state.mode === 'edit'
            ? 'type value  Enter=save  Esc=cancel'
            : state.mode === 'set'
                ? 'type new value as JSON  Enter=apply  Esc=cancel'
                : 'type command  Enter=run  Esc=cancel';
    return `└─ ${DIM}${keys}${RESET} ─`;
}
// =============================================================================
// Value formatter
// =============================================================================
/**
 * Format a cell's value for display. We use a few color cues:
 *  - green for Ready values
 *  - red for errors
 *  - yellow for stale values
 *  - dim for null/undefined
 */
function formatCellValue(cell, _mode) {
    if (cell.error) {
        return `${RED}error: ${truncate(cell.error, 30)}${RESET}`;
    }
    if (cell.status === 'stale') {
        return `${YELLOW}${truncate(cell.value, 30)} ${DIM}(stale)${RESET}`;
    }
    if (cell.status === 'idle') {
        return `${DIM}(idle)${RESET}`;
    }
    if (cell.value === '' || cell.value === 'null' || cell.value === 'undefined') {
        return `${DIM}${cell.value}${RESET}`;
    }
    // Truncate long values.
    const display = truncate(cell.value, 50);
    return `${GREEN}${display}${RESET}`;
}
function truncate(s, max) {
    if (s.length <= max)
        return s;
    return s.slice(0, max - 1) + '…';
}
