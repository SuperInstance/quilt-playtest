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
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
/**
 * Create and start an MCP server backed by a Quilt engine.
 */
export function createMcpServer(engine, options = {}) {
    const server = new Server({
        name: 'quilt',
        version: '0.1.0',
    }, {
        capabilities: {
            resources: {},
            tools: {},
        },
    });
    const sheetName = options.sheetName ?? engine.id;
    const baseContext = {
        timestamp: Date.now(),
        trace: [],
        identity: options.identity ?? { id: 'mcp-client', type: 'agent' },
    };
    // ---------------------------------------------------------------------------
    // Tools: one per cell
    // ---------------------------------------------------------------------------
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const cells = engine.listCells();
        return {
            tools: cells.map(cell => ({
                name: `cell__${cell.id.replace(/[^a-zA-Z0-9_]/g, '_')}`,
                description: cell.def.description ?? `Cell: ${cell.id} (${cell.def.kind})`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        input: {
                            description: 'Optional input to pass when calling this cell',
                        },
                        row: { type: ['string', 'number'], description: 'Caller row (for routing)' },
                        column: { type: ['string', 'number'], description: 'Caller column (for routing)' },
                    },
                },
            })),
        };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        if (!name?.startsWith('cell__')) {
            throw new Error(`unknown tool: ${name}`);
        }
        // Reverse the sanitization
        const cellId = name.slice('cell__'.length).replace(/_/g, '.');
        const cell = engine.getCell(cellId);
        if (!cell) {
            throw new Error(`no such cell: ${cellId}`);
        }
        const a = (args ?? {});
        const ctx = {
            ...baseContext,
            row: (a.row ?? undefined),
            column: (a.column ?? undefined),
            timestamp: Date.now(),
        };
        const value = await engine.call(cellId, a.input, ctx);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(value, null, 2),
                },
            ],
            isError: value.status === 'error',
        };
    });
    // ---------------------------------------------------------------------------
    // Resources: the whole sheet + per-cell snapshots
    // ---------------------------------------------------------------------------
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        const cells = engine.listCells();
        return {
            resources: [
                {
                    uri: `quilt://${sheetName}/sheet`,
                    name: `${sheetName} (full sheet)`,
                    description: 'Snapshot of all cell values in the sheet',
                    mimeType: 'application/json',
                },
                ...cells.map(cell => ({
                    uri: `quilt://${sheetName}/cell/${encodeURIComponent(cell.id)}`,
                    name: cell.id,
                    description: cell.def.description ?? `Cell of kind ${cell.def.kind}`,
                    mimeType: 'application/json',
                })),
            ],
        };
    });
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const uri = request.params.uri;
        const prefix = `quilt://${sheetName}/`;
        if (!uri.startsWith(prefix)) {
            throw new Error(`unknown resource: ${uri}`);
        }
        const rest = uri.slice(prefix.length);
        if (rest === 'sheet') {
            const cells = engine.listCells();
            const snapshot = {};
            for (const cell of cells) {
                const v = await engine.get(cell.id, baseContext);
                snapshot[cell.id] = {
                    kind: cell.def.kind,
                    status: v.status,
                    data: v.data,
                    computedAt: v.computedAt,
                };
            }
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(snapshot, null, 2),
                    },
                ],
            };
        }
        if (rest.startsWith('cell/')) {
            const cellId = decodeURIComponent(rest.slice('cell/'.length));
            const v = await engine.get(cellId, baseContext);
            return {
                contents: [
                    {
                        uri,
                        mimeType: 'application/json',
                        text: JSON.stringify(v, null, 2),
                    },
                ],
            };
        }
        throw new Error(`unknown resource path: ${rest}`);
    });
    return server;
}
/**
 * Start the MCP server with stdio transport (for Claude Code etc.)
 */
export async function startMcpServer(engine, options = {}) {
    const server = createMcpServer(engine, options);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // The server keeps the process alive via the transport
}
//# sourceMappingURL=server.js.map