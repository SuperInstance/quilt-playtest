import { EventEmitter } from 'node:events';
/** The keys we care about. Everything else is ignored. */
export type TuiKey = {
    type: 'char';
    char: string;
} | {
    type: 'enter';
} | {
    type: 'escape';
} | {
    type: 'backspace';
} | {
    type: 'up';
} | {
    type: 'down';
} | {
    type: 'left';
} | {
    type: 'right';
} | {
    type: 'home';
} | {
    type: 'end';
} | {
    type: 'pageup';
} | {
    type: 'pagedown';
} | {
    type: 'ctrl';
    char: string;
};
/** A reader that turns stdin bytes into `TuiKey` events. */
export declare class KeyReader extends EventEmitter {
    private raw;
    /** Begin reading keys. Call this once at startup. */
    start(): void;
    /** Restore the terminal. Call this on exit. */
    shutdown(): void;
    private handleChunk;
    private handleCsi;
}
