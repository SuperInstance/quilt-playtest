/** The eight cell kinds, mirrored from the engine. */
export type CellKind = 'value' | 'formula' | 'api' | 'program' | 'sensor' | 'io' | 'listener' | 'router';
/** The three cell statuses that affect how we render. */
export type CellStatus = 'idle' | 'ready' | 'stale' | 'error';
/** A single row in the cell list. Pre-computed from the engine. */
export interface CellRow {
    id: string;
    kind: CellKind;
    /** The cell's current value, as a string. */
    value: string;
    status: CellStatus;
    /** An error message, if status === 'error'. */
    error: string | null;
    /** The cell's static dependencies (cells this one reads from). */
    dependencies: string[];
    /** The cell's dynamic dependents (cells that read this one). */
    dependents: string[];
}
/** The TUI's three input modes. */
export type TuiMode = 'normal' | 'edit' | 'set' | 'command';
/** The full state of the TUI at a point in time. */
export interface TuiState {
    /** The id of the sheet being displayed. */
    sheetId: string;
    /** All cells, in display order. */
    cells: CellRow[];
    /** The index of the selected cell in `cells`. */
    selectedIndex: number;
    /** The id of the selected cell (for the dep panels). */
    selectedId: string | null;
    /** The top row currently scrolled into view. */
    viewTop: number;
    /** How many rows fit in the viewport. */
    viewportHeight: number;
    /** The current input mode. */
    mode: TuiMode;
    /** The edit buffer (used in edit, set, and command modes). */
    editBuffer: string | null;
    /** Optional status line (last action, error, etc.). */
    status: string | null;
}
/** A user-issued command (after pressing `:`). */
export type TuiCommand = {
    type: 'reload';
} | {
    type: 'subscribe';
    cellId: string;
} | {
    type: 'unsubscribe';
    cellId: string;
} | {
    type: 'help';
};
