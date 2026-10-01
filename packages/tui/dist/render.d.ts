import type { TuiState } from './types.js';
/**
 * Render the full TUI frame to a string. The string ends with a
 * clear-to-end-of-screen escape so the previous frame's residue
 * (if any) is wiped.
 */
export declare function render(state: TuiState): string;
