//! # ansi.ts
//!
//! ANSI escape code constants. Centralized so we don't sprinkle
//! `\x1b[` literals throughout the renderer.
//!
//! ## Notes
//!
//! - We use SGR (Select Graphic Rendition) codes only. We don't
//!   touch cursor position outside the renderer, which keeps
//!   things simple.
//! - The renderer uses `\x1b[J` (clear to end of screen) at the
//!   end of each frame so residue is wiped.
//! - `\x1b[?25l` / `\x1b[?25h` would hide/show the cursor, but
//!   we don't use them — the TUI plays well with tmux and the
//!   blinking cursor in the edit bar is fine.
export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const ITALIC = '\x1b[3m';
export const UNDERLINE = '\x1b[4m';
export const REVERSED = '\x1b[7m';
export const BLACK = '\x1b[30m';
export const RED = '\x1b[31m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const BLUE = '\x1b[34m';
export const MAGENTA = '\x1b[35m';
export const CYAN = '\x1b[36m';
export const WHITE = '\x1b[37m';
export const BRIGHT_BLACK = '\x1b[90m';
export const BRIGHT_RED = '\x1b[91m';
export const BRIGHT_GREEN = '\x1b[92m';
export const BRIGHT_YELLOW = '\x1b[93m';
export const BRIGHT_BLUE = '\x1b[94m';
export const BRIGHT_MAGENTA = '\x1b[95m';
export const BRIGHT_CYAN = '\x1b[96m';
export const BRIGHT_WHITE = '\x1b[97m';
// Color map for cell kinds. Used in the cell list to give each
// kind a distinct visual identity.
export const KIND_COLORS = {
    value: BRIGHT_BLUE,
    formula: BRIGHT_CYAN,
    api: BRIGHT_YELLOW,
    program: BRIGHT_MAGENTA,
    sensor: GREEN,
    io: YELLOW,
    listener: BRIGHT_RED,
    router: BRIGHT_GREEN,
};
