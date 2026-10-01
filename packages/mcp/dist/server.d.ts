/**
 * @quilt/mcp — Model Context Protocol server.
 *
 * Exposes a Quilt sheet as MCP tools and resources so any MCP client
 * (Claude Code, Claude Desktop, Cursor, Windsurf, etc.) can read and
 * interact with the sheet.
 *
 * Mapping:
 *   - Every named cell  →  an MCP tool (call it, get a value)
 *   - The whole sheet   →  an MCP resource (read it, get a snapshot)
 *
 * This is the bridge that makes Quilt a first-class citizen in the
 * agent ecosystem. Once exposed, agents can use cells as tools, and
 * the cells become shared working memory between humans and agents.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { QuiltEngine } from '@quilt/core';
import { type CallerContext } from '@quilt/core';
export interface McpServerOptions {
    identity?: CallerContext['identity'];
    sheetName?: string;
}
/**
 * Create and start an MCP server backed by a Quilt engine.
 */
export declare function createMcpServer(engine: QuiltEngine, options?: McpServerOptions): Server;
/**
 * Start the MCP server with stdio transport (for Claude Code etc.)
 */
export declare function startMcpServer(engine: QuiltEngine, options?: McpServerOptions): Promise<void>;
//# sourceMappingURL=server.d.ts.map