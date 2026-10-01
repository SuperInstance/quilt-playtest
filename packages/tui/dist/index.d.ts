import type { QuiltEngine } from '@quilt/core';
/** The TUI application. One per running session. */
export declare class QuiltTui {
    private state;
    private reader;
    private engine;
    private frame;
    private redrawTimer;
    private running;
    private subscriptions;
    constructor(engine: QuiltEngine);
    /** Start the TUI. Returns when the user quits. */
    run(): Promise<void>;
    /** Stop the TUI, restoring the terminal. */
    shutdown(): void;
    /** Re-pull all cell state from the engine. */
    private refreshCells;
    /** Convert a CellDef to a CellRow for display. */
    private cellToRow;
    /** Format a CellValue as a string for display. */
    private formatValue;
    private handleKey;
    private handleNormalKey;
    private handleEditKey;
    private handleSetKey;
    private handleCommandKey;
    private enterEdit;
    private enterSet;
    private enterCommand;
    private commitEdit;
    private commitSet;
    private runCommand;
    private reload;
    private moveSelection;
    /** Schedule a re-render. Coalesces multiple state changes. */
    private scheduleRedraw;
    /** Force an immediate redraw. */
    private draw;
    /**
     * Subscribe to engine changes. The TypeScript engine exposes
     * `subscribe(cellId, callback)`. We subscribe to every cell
     * and on any change, refresh the affected row.
     */
    private subscribeToEngine;
}
/**
 * Start the TUI for an engine. Returns a promise that resolves
 * when the user quits.
 */
export declare function startTui(engine: QuiltEngine): Promise<void>;
export type { CellRow, CellKind, TuiState } from './types.js';
export type { TuiKey } from './input.js';
