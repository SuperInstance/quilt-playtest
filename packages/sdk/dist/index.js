/**
 * @quilt/sdk — agent substrate primitives
 *
 * Five functions that turn Quilt sheets into executable, auditable,
 * replayable artifacts. This is the minimal surface area that any
 * planner, runtime, or UI needs to compose Quilt sheets into agentic
 * workflows.
 *
 *   1. resolveTemplate(uri, context)  — substitute {{var}} tokens
 *   2. resolveArtifact(uri, context)  — resolve a Quilt URI to a pinned version
 *   3. validateManifest(manifest)     — JSON Schema validation + precondition checks
 *   4. publishArtifact(path, meta)    — upload an artifact, get back a canonical URI
 *   5. publishRunTrace(trace)         — write an immutable run trace to Quilt
 *
 * Why these five? They are the minimum surface that lets:
 *   - planners compile goals into manifest DAGs,
 *   - runtimes execute those DAGs transactionally,
 *   - agents query the past and learn from it,
 *   - UIs show users what is happening with full provenance.
 *
 * Everything else (UI, scheduler, model router) is built on top of these.
 *
 * The SDK is intentionally side-effect-free by default. `resolveArtifact`,
 * `validateManifest`, and `resolveTemplate` are pure functions of their
 * inputs. `publishArtifact` and `publishRunTrace` take a transport
 * (`ArtifactStore`) so callers can wire any backend (Cloudflare R2,
 * local FS, in-memory mock for tests).
 *
 * See `manifest.schema.json` for the manifest format these primitives
 * operate on.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Re-export the schema for convenience — consumers can import the JSON
// directly, but having it exported from the package means types and
// schema travel together.
export { default as manifestSchema } from '../../../schemas/manifest.schema.json' with { type: 'json' };
// ──────────────────────────────────────────────────────────────────────────
//  Primitive 1: resolveTemplate
// ──────────────────────────────────────────────────────────────────────────
/**
 * Substitute `{{key}}` tokens in a URI or path string with values from
 * the run context. Unknown keys cause a fail-fast error — silent
 * templating is the source of most reproducibility bugs.
 *
 * For ergonomics, `{{run_id}}` and `{{runId}}` both look up the same
 * value (snake_case ↔ camelCase). The lookup is case-insensitive and
 * ignores underscores.
 *
 * @example
 *   resolveTemplate("quilt://ml/models/classifier:{{run_id}}", { runId: "run-01" })
 *   // -> "quilt://ml/models/classifier:run-01"
 *
 *   resolveTemplate("quilt://data/{{dataset}}", { dataset: "imagenet" })
 *   // -> "quilt://data/imagenet"
 */
export function resolveTemplate(input, context = {}) {
    // Build a normalized lookup: lowercase, no underscores
    const norm = (s) => s.toLowerCase().replace(/_/g, '');
    const lookup = new Map();
    for (const [k, v] of Object.entries(context)) {
        if (v !== undefined)
            lookup.set(norm(k), v);
    }
    return input.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, key) => {
        const v = lookup.get(norm(key));
        if (v === undefined) {
            throw new TemplateError(`Missing template variable: ${key}. ` +
                `Provide it in the run context. Available: ${Object.keys(context).join(', ') || '(none)'}`);
        }
        return v;
    });
}
export class TemplateError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TemplateError';
    }
}
// ──────────────────────────────────────────────────────────────────────────
//  Primitive 2: resolveArtifact
// ──────────────────────────────────────────────────────────────────────────
/**
 * Resolve a Quilt URI to a concrete artifact version. If the URI has no
 * version, resolves to the latest. If the URI contains `{{var}}` tokens,
 * substitutes them from the run context first.
 *
 * The `store` argument is optional — when omitted, only the URI is
 * normalized (no fetch). This is useful for planners that want to know
 * what would be fetched without actually fetching.
 *
 * @example
 *   await resolveArtifact("quilt://ml/datasets/staged:latest", {}, store)
 *   // -> { uri: "quilt://ml/datasets/staged:latest", version: "v42", resolvedUri: "quilt://ml/datasets/staged:v42", ... }
 *
 *   await resolveArtifact("quilt://ml/models/classifier:{{run_id}}", { runId: "r-01" }, store)
 *   // -> { resolvedUri: "quilt://ml/models/classifier:r-01", version: "r-01", ... }
 */
export async function resolveArtifact(uri, context = {}, store) {
    // 1. Validate URI shape
    if (!uri.startsWith('quilt://') && !uri.startsWith('cell://')) {
        throw new ResolveError(`Invalid Quilt URI: "${uri}". Must start with "quilt://" or "cell://".`, uri);
    }
    // 2. Substitute template variables
    let templated;
    try {
        templated = resolveTemplate(uri, context);
    }
    catch (err) {
        if (err instanceof TemplateError) {
            throw new ResolveError(`Template substitution failed: ${err.message}`, uri);
        }
        throw err;
    }
    // 3. Parse logicalUri + version. Forms:
    //    quilt://bucket/name:version
    //    quilt://bucket/name      -> :latest
    //    cell://sheet/cell.path   -> no version (always live)
    const lastColon = templated.lastIndexOf(':');
    let logicalUri;
    let version;
    if (lastColon > templated.indexOf('//')) {
        // There's a version segment
        logicalUri = templated.slice(0, lastColon);
        version = templated.slice(lastColon + 1);
    }
    else {
        logicalUri = templated;
        version = 'latest';
    }
    if (version === 'latest' && store) {
        const versions = await store.listVersions(logicalUri);
        if (versions.length === 0) {
            throw new ResolveError(`No versions found for ${logicalUri}`, uri);
        }
        // Most recent first
        versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        version = versions[0].version;
    }
    const resolvedUri = `${logicalUri}:${version}`;
    // 4. If a store is given, fetch metadata
    let metadata = {};
    let provenance = { createdAt: new Date().toISOString() };
    if (store) {
        try {
            const result = await store.get(resolvedUri);
            metadata = result.metadata;
            const createdAtValue = result.metadata.createdAt;
            const createdAt = typeof createdAtValue === 'string' ? createdAtValue : new Date().toISOString();
            const originCommit = result.metadata.originCommit;
            const manifestIdValue = result.metadata.manifestId;
            provenance = {
                createdAt,
                originCommit: typeof originCommit === 'string' ? originCommit : undefined,
                manifestId: typeof manifestIdValue === 'string' ? manifestIdValue : undefined,
            };
        }
        catch (err) {
            // For latest->pinned, the resolved version may not be materialized
            // yet. That's OK — we return the resolved URI and let the caller
            // decide whether to fail.
            metadata = { _resolveWarning: `Could not fetch metadata: ${err.message}` };
        }
    }
    return {
        uri,
        version,
        resolvedUri,
        metadata,
        provenance,
    };
}
export class ResolveError extends Error {
    uri;
    constructor(message, uri) {
        super(message);
        this.name = 'ResolveError';
        this.uri = uri;
    }
}
// ──────────────────────────────────────────────────────────────────────────
//  Primitive 3: validateManifest
// ──────────────────────────────────────────────────────────────────────────
/**
 * Validate a manifest against the Quilt manifest JSON schema, and
 * optionally check that all `artifact_exists` preconditions are met.
 *
 * Returns `{ valid: true, errors: [] }` on success, or
 * `{ valid: false, errors: [...] }` with one entry per failure.
 *
 * @example
 *   validateManifest(manifest)  // schema-only
 *   validateManifest(manifest, { store, checkExists: true })  // also verify preconditions
 */
export async function validateManifest(manifest, options = {}) {
    // Lazy-load ajv so consumers that only use resolveTemplate don't pay
    // the cost. Use unknown casts because ajv is a CJS module whose types
    // don't perfectly fit the ESM-style default import.
    const AjvModule = await import('ajv');
    const AjvCtor = AjvModule.default;
    const addFormatsModule = await import('ajv-formats');
    const addFormats = addFormatsModule.default;
    const schemaModule = await import('../../../schemas/manifest.schema.json', { with: { type: 'json' } });
    const schema = schemaModule.default;
    const ajv = new AjvCtor({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const valid = validate(manifest);
    const errors = [];
    if (!valid) {
        for (const err of validate.errors ?? []) {
            errors.push({
                path: err.instancePath || '/',
                message: err.message ?? 'validation error',
                keyword: err.keyword,
            });
        }
        return { valid: false, errors };
    }
    // Precondition checks
    if (options.checkExists && options.store) {
        const m = manifest;
        for (const pre of m.preconditions ?? []) {
            if (pre.type === 'artifact_exists' && pre.uri) {
                try {
                    const resolved = await resolveArtifact(pre.uri, options.runContext ?? {}, options.store);
                    const exists = await options.store.exists(resolved.resolvedUri);
                    if (!exists) {
                        errors.push({
                            path: `/preconditions/${pre.uri}`,
                            message: `Precondition artifact_exists failed: ${resolved.resolvedUri} does not exist`,
                            keyword: 'artifact_exists',
                        });
                    }
                }
                catch (err) {
                    errors.push({
                        path: `/preconditions/${pre.uri}`,
                        message: `Precondition check failed: ${err.message}`,
                        keyword: 'artifact_exists',
                    });
                }
            }
        }
    }
    return { valid: errors.length === 0, errors };
}
// ──────────────────────────────────────────────────────────────────────────
//  Primitive 4: publishArtifact
// ──────────────────────────────────────────────────────────────────────────
/**
 * Upload an artifact to the store and return its canonical Quilt URI.
 * The version is derived from the content hash (sha256) by default, or
 * from `metadata.version` if provided. This makes publishes content-
 * addressed and idempotent.
 *
 * @example
 *   const path = "trained_model.bin";
 *   const bytes = await readFile(path);
 *   const { uri, version } = await publishArtifact(bytes, {
 *     manifestId: "train-classifier",
 *     runId: "run-20260819-01",
 *     tags: ["model", "production"],
 *   }, store);
 *   // -> uri: "quilt://artifacts/trained_model:abc123...", version: "abc123..."
 */
export async function publishArtifact(source, metadata, store) {
    let bytes;
    if (typeof source === 'string') {
        bytes = new TextEncoder().encode(source);
    }
    else if (source instanceof Uint8Array) {
        bytes = source;
    }
    else {
        // { path: string }
        const buf = await readFile(source.path);
        bytes = new Uint8Array(buf);
    }
    const contentHash = metadata.contentHash ?? hashBytes(bytes);
    // Logical URI: derive from metadata or generate a UUID
    const logicalName = (metadata.manifestId ?? 'artifact') + '/' + (metadata.runId ?? shortHash(bytes));
    const logicalUri = `quilt://artifacts/${logicalName}`;
    const enrichedMetadata = {
        ...metadata,
        contentHash,
        createdAt: metadata.createdAt ?? new Date().toISOString(),
    };
    const result = await store.put(logicalUri, bytes, enrichedMetadata);
    return {
        uri: result.uri,
        version: result.version,
        contentHash,
    };
}
function hashBytes(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
function shortHash(bytes) {
    return hashBytes(bytes).slice(0, 8);
}
// ──────────────────────────────────────────────────────────────────────────
//  Primitive 5: publishRunTrace
// ──────────────────────────────────────────────────────────────────────────
/**
 * Persist a run_trace as an immutable Quilt artifact. Run traces are
 * always versioned by run_id so they can be replayed deterministically.
 *
 * The run_trace itself is the audit log: who ran what, when, with what
 * inputs, producing what outputs, and what happened at each node. It
 * is the single canonical record of an execution.
 *
 * @example
 *   await publishRunTrace({
 *     runId: "run-20260819-01",
 *     planId: "plan-abc",
 *     manifestId: "train-classifier",
 *     startTime: "2026-08-19T11:00:00Z",
 *     endTime:   "2026-08-19T11:42:13Z",
 *     status: "success",
 *     nodes: [
 *       { nodeId: "ingest",  status: "success", artifactUris: ["quilt://data/raw:v1"] },
 *       { nodeId: "train",   status: "success", artifactUris: ["quilt://models/classifier:abc123"] },
 *       { nodeId: "validate", status: "success" },
 *     ],
 *     provenance: { commit: "9f8a7b", plannerVersion: "1.0.0" },
 *   }, store);
 */
export async function publishRunTrace(trace, store) {
    if (!trace.runId) {
        throw new Error('RunTrace must have a runId');
    }
    if (!trace.nodes || trace.nodes.length === 0) {
        throw new Error('RunTrace must have at least one node');
    }
    const json = JSON.stringify(trace, null, 2);
    const bytes = new TextEncoder().encode(json);
    const contentHash = hashBytes(bytes);
    const metadata = {
        contentType: 'application/json',
        contentHash,
        manifestId: trace.manifestId,
        runId: trace.runId,
        tags: ['run-trace', ...(trace.replayHint?.tags ?? [])],
        createdAt: trace.startTime,
        ...trace.provenance,
    };
    const logicalUri = `quilt://runs/${trace.manifestId ?? 'unscoped'}/${trace.runId}`;
    const result = await store.put(logicalUri, bytes, { ...metadata, version: contentHash.slice(0, 12) });
    return {
        uri: result.uri,
        version: result.version,
    };
}
// ──────────────────────────────────────────────────────────────────────────
//  In-memory ArtifactStore (for tests and small demos)
// ──────────────────────────────────────────────────────────────────────────
/**
 * A minimal in-memory artifact store. Useful for tests, examples, and
 * browser-based demos where there is no real backend. Production
 * deployments should swap this for a Cloudflare R2 / S3 implementation.
 */
export class InMemoryArtifactStore {
    store = new Map();
    async put(logicalUri, bytes, metadata) {
        const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
        const contentHash = metadata.contentHash ?? hashBytes(data);
        const version = metadata.version ?? contentHash.slice(0, 12);
        const fullUri = `${logicalUri}:${version}`;
        this.store.set(fullUri, { bytes: data, metadata: { ...metadata, contentHash, createdAt: metadata.createdAt ?? new Date().toISOString() } });
        return { uri: fullUri, version };
    }
    async get(uri) {
        const entry = this.store.get(uri);
        if (!entry)
            throw new Error(`Artifact not found: ${uri}`);
        return entry;
    }
    async exists(uri) {
        return this.store.has(uri);
    }
    async listVersions(logicalUri) {
        const out = [];
        const prefix = logicalUri + ':';
        for (const [uri, entry] of this.store) {
            if (uri.startsWith(prefix)) {
                const version = uri.slice(prefix.length);
                const createdAt = entry.metadata.createdAt;
                out.push({ version, createdAt: typeof createdAt === 'string' ? createdAt : '' });
            }
        }
        return out;
    }
    /** Inspect everything (for debugging). */
    entries() {
        return Array.from(this.store.entries()).map(([uri, e]) => [uri, e.metadata]);
    }
}
/**
 * Parse a federated cell URI into its parts. Throws on malformed URIs.
 *
 * @example
 *   parseCellRef("quilt://local/boat-autopilot#rudder.angle")
 *   // -> { instance: "local", sheet: "boat-autopilot", cellPath: "rudder.angle", ... }
 */
export function parseCellRef(uri) {
    if (!uri.startsWith('quilt://')) {
        throw new CellRefError(`Cell ref must start with "quilt://": ${uri}`);
    }
    const afterScheme = uri.slice('quilt://'.length);
    const hashIdx = afterScheme.indexOf('#');
    if (hashIdx < 0) {
        throw new CellRefError(`Cell ref must contain "#" separator: ${uri}`);
    }
    const pathPart = afterScheme.slice(0, hashIdx);
    const cellPath = afterScheme.slice(hashIdx + 1);
    if (!cellPath) {
        throw new CellRefError(`Cell ref has empty cell path: ${uri}`);
    }
    const pathSegments = pathPart.split('/').filter((s) => s.length > 0);
    if (pathSegments.length < 2) {
        throw new CellRefError(`Cell ref needs both instance and sheet: ${uri}. ` +
            `Expected: quilt://[instance]/[sheet]#[cell-path]`);
    }
    const [instance, sheet] = pathSegments;
    const isWildcard = instance === '*' || sheet === '+' || cellPath === '*';
    return {
        uri,
        instance: instance,
        sheet: sheet,
        cellPath,
        isWildcard,
    };
}
export class CellRefError extends Error {
    uri;
    constructor(message, uri = '') {
        super(message);
        this.name = 'CellRefError';
        this.uri = uri;
    }
}
/**
 * The most common transport: the local process. If `instance` is
 * "local" or matches the configured `localInstanceId`, read from the
 * local engine. Otherwise, raise — the caller should provide a
 * RemoteCellTransport for non-local instances.
 */
export class LocalCellTransport {
    engines;
    localInstanceId;
    listeners = new Map();
    constructor(engines, localInstanceId = 'local') {
        this.engines = engines;
        this.localInstanceId = localInstanceId;
    }
    async get(instance, sheet, cellPath) {
        const engine = this.engineFor(instance);
        return engine.getCell(sheet, cellPath);
    }
    async set(instance, sheet, cellPath, value) {
        const engine = this.engineFor(instance);
        await engine.setCell(sheet, cellPath, value);
    }
    subscribe(instance, sheet, cellPath, callback) {
        const engine = this.engineFor(instance);
        const unsub = engine.subscribe(sheet, cellPath, callback);
        return unsub;
    }
    engineFor(instance) {
        if (instance === 'local' || instance === this.localInstanceId) {
            // For "local", use the first registered engine (the convention is
            // one local engine per process)
            const first = this.engines.values().next().value;
            if (!first) {
                throw new CellRefError('No local engine registered');
            }
            return first;
        }
        const engine = this.engines.get(instance);
        if (!engine) {
            throw new CellRefError(`No engine registered for instance "${instance}". ` +
                `Registered: ${Array.from(this.engines.keys()).join(', ') || '(none)'}`);
        }
        return engine;
    }
}
/**
 * An HTTP-based transport for talking to a remote Quilt instance.
 * The remote must expose a compatible HTTP API. See `quilt-codespace`
 * for the reference implementation.
 *
 * @example
 *   const remote = new HttpCellTransport('https://my-codespace-7681.githubpreview.dev', 'my-token');
 *   const value = await remote.get('codespace-7c3', 'prod', 'anomaly.score');
 */
export class HttpCellTransport {
    baseUrl;
    token;
    listeners = new Map();
    eventSources = new Map();
    constructor(baseUrl, token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }
    headers() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
        };
    }
    cellPath(instance, sheet, cellPath) {
        return `/cells/${encodeURIComponent(instance)}/${encodeURIComponent(sheet)}/${cellPath
            .split('.')
            .map(encodeURIComponent)
            .join('/')}`;
    }
    async get(instance, sheet, cellPath) {
        const url = `${this.baseUrl}${this.cellPath(instance, sheet, cellPath)}`;
        const res = await fetch(url, { headers: this.headers() });
        if (!res.ok) {
            throw new CellRefError(`HTTP ${res.status} getting ${url}: ${await res.text()}`, url);
        }
        const body = await res.json();
        return body.value;
    }
    async set(instance, sheet, cellPath, value) {
        const url = `${this.baseUrl}${this.cellPath(instance, sheet, cellPath)}`;
        const res = await fetch(url, {
            method: 'PUT',
            headers: this.headers(),
            body: JSON.stringify({ value }),
        });
        if (!res.ok) {
            throw new CellRefError(`HTTP ${res.status} setting ${url}: ${await res.text()}`, url);
        }
    }
    subscribe(instance, sheet, cellPath, callback) {
        const key = `${instance}/${sheet}/${cellPath}`;
        let set = this.listeners.get(key);
        if (!set) {
            set = new Set();
            this.listeners.set(key, set);
        }
        set.add(callback);
        // Open SSE connection if this is the first listener
        if (set.size === 1) {
            const url = `${this.baseUrl}${this.cellPath(instance, sheet, cellPath)}/events`;
            const es = new EventSource(url, { withCredentials: false });
            // Note: EventSource doesn't support custom headers, so the token
            // must be passed via query string in the actual URL. The
            // reference Quilt Codespace exposes a token-validated SSE
            // endpoint at /events?token=...
            es.onmessage = (ev) => {
                try {
                    const data = JSON.parse(ev.data);
                    for (const cb of this.listeners.get(key) ?? []) {
                        cb(data.value);
                    }
                }
                catch {
                    // ignore malformed events
                }
            };
            this.eventSources.set(key, es);
        }
        return () => {
            const s = this.listeners.get(key);
            if (!s)
                return;
            s.delete(callback);
            if (s.size === 0) {
                this.listeners.delete(key);
                const es = this.eventSources.get(key);
                if (es) {
                    es.close();
                    this.eventSources.delete(key);
                }
            }
        };
    }
}
/**
 * Resolve a federated cell URI to a live, subscribable handle.
 *
 * This is the federation equivalent of `resolveArtifact`:
 * - `resolveArtifact` pins an artifact to a version
 * - `resolveCell` pins a cell to a live handle
 *
 * @example
 *   const handle = await resolveCell('quilt://local/boat-autopilot#rudder.angle', transport);
 *   const value = await handle.get();
 *   const unsub = handle.subscribe((v) => console.log('rudder changed:', v));
 */
export async function resolveCell(uri, transport) {
    const ref = parseCellRef(uri);
    if (ref.isWildcard) {
        throw new CellRefError(`Wildcard cell refs cannot be resolved to a single handle: ${uri}. ` +
            `Use a routing table or fleet-discovery to expand wildcards first.`);
    }
    // Validate the cell exists by attempting a get
    await transport.get(ref.instance, ref.sheet, ref.cellPath);
    let unsubscribed = false;
    const localListeners = new Set();
    return {
        uri,
        async get() {
            return transport.get(ref.instance, ref.sheet, ref.cellPath);
        },
        async set(value) {
            await transport.set(ref.instance, ref.sheet, ref.cellPath, value);
        },
        subscribe(callback) {
            if (unsubscribed)
                throw new CellRefError('Cannot subscribe to an unsubscribed handle');
            localListeners.add(callback);
            const unsub = transport.subscribe(ref.instance, ref.sheet, ref.cellPath, (v) => {
                if (!unsubscribed)
                    callback(v);
            });
            return () => {
                localListeners.delete(callback);
                unsub();
            };
        },
        unsubscribe() {
            unsubscribed = true;
            localListeners.clear();
        },
    };
}
/**
 * Subscribe to a federated cell. Convenience wrapper around
 * `resolveCell` + `handle.subscribe`. The callback fires for every
 * value change until the returned unsubscribe is called.
 *
 * @example
 *   const unsub = subscribeCell(
 *     'quilt://jetson-lab/perception#vision.scene',
 *     transport,
 *     (scene) => console.log('new scene:', scene)
 *   );
 *   // ...later
 *   unsub();
 */
export function subscribeCell(uri, transport, callback) {
    let unsub = null;
    let cancelled = false;
    resolveCell(uri, transport)
        .then((handle) => {
        if (cancelled) {
            handle.unsubscribe();
            return;
        }
        unsub = handle.subscribe(callback);
    })
        .catch((err) => {
        // Fire callback with the error so the caller can log it
        callback({ __subscribeError: err.message });
    });
    return () => {
        cancelled = true;
        if (unsub)
            unsub();
    };
}
/**
 * A routing table for federated cells. Maps wildcard patterns to
 * specific instance ids. Like DNS for cells:
 *   quilt://[*]/prod#x  ->  quilt://codespace-7c3/prod#x
 * (the wildcards are written as [*] and + to avoid ending the comment)
 *
 * The simplest routing is instance-prefix matching:
 *   "*"              -> "local" (default)
 *   "jetson-*"       -> "jetson-lab"
 *   "esp32-*"        -> first esp32 in fleet
 *
 * @example
 *   const router = new CellRouter();
 *   router.add('local', localTransport);
 *   router.add('jetson-lab', httpTransport1);
 *   router.add('codespace-7c3', httpTransport2);
 *
 *   const handle = await router.resolve('quilt://jetson-lab/perception#vision.scene');
 *   // -> uses httpTransport1
 */
export class CellRouter {
    transports = new Map();
    /** Register a transport for a specific instance id. */
    add(instance, transport) {
        this.transports.set(instance, transport);
        return this;
    }
    /** Remove a transport. */
    remove(instance) {
        return this.transports.delete(instance);
    }
    /** Resolve a cell URI to a live handle, routing through the right transport. */
    async resolve(uri) {
        const ref = parseCellRef(uri);
        const transport = this.transports.get(ref.instance);
        if (!transport) {
            throw new CellRefError(`No transport registered for instance "${ref.instance}". ` +
                `Registered: ${Array.from(this.transports.keys()).join(', ') || '(none)'}`);
        }
        return resolveCell(uri, transport);
    }
    /** Subscribe to a cell, routing through the right transport. */
    subscribe(uri, callback) {
        const ref = parseCellRef(uri);
        const transport = this.transports.get(ref.instance);
        if (!transport) {
            throw new CellRefError(`No transport registered for instance "${ref.instance}". ` +
                `Registered: ${Array.from(this.transports.keys()).join(', ') || '(none)'}`);
        }
        return subscribeCell(uri, transport, callback);
    }
    /** List all registered instance ids. */
    instances() {
        return Array.from(this.transports.keys());
    }
}
/**
 * Detect the deployment tier this Quilt is running in. Looks at env
 * vars, runtime markers, and platform-specific signals.
 *
 * Override with the `QUILT_TIER` env var (one of: esp32, jetson,
 * codespace, cloudflare, server, browser).
 *
 * @example
 *   const tier = detectTier();
 *   // -> { tier: 'codespace', instanceId: 'codespace-a1b2', platform: 'GitHub Codespace', ... }
 */
export function detectTier() {
    // Manual override
    const override = (typeof process !== 'undefined' ? process.env?.QUILT_TIER : undefined);
    if (override) {
        return tierInfoFor(override);
    }
    // Cloudflare Worker
    if (typeof globalThis !== 'undefined' && globalThis.caches !== undefined && typeof globalThis.WebSocketPair !== 'undefined') {
        return tierInfoFor('cloudflare');
    }
    // GitHub Codespace
    if (typeof process !== 'undefined' && process.env?.CODESPACES === 'true') {
        return tierInfoFor('codespace');
    }
    // ESP32 / embedded (very rough — real detection needs no_std Rust)
    if (typeof process !== 'undefined' && (process.env?.QUILT_TARGET === 'esp32' || process.env?.PLATFORM === 'esp32')) {
        return tierInfoFor('esp32');
    }
    // Jetson / edge (CUDA available, ARM64, etc.)
    if (typeof process !== 'undefined' && process.env?.QUILT_TARGET === 'jetson') {
        return tierInfoFor('jetson');
    }
    // Browser
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        return tierInfoFor('browser');
    }
    // Generic server
    if (typeof process !== 'undefined' && process.versions?.node) {
        return tierInfoFor('server');
    }
    return tierInfoFor('unknown');
}
/**
 * Build a TierInfo for a given tier, including auto-generated instance
 * id and platform name.
 */
export function tierInfoFor(tier) {
    const instanceId = generateInstanceId(tier);
    switch (tier) {
        case 'esp32':
            return {
                tier,
                instanceId,
                platform: 'ESP32 (no_std)',
                capabilities: {
                    async: false,
                    network: true, // WiFi
                    filesystem: true, // NVS / flash
                    persistent: true,
                    gpu: false,
                    llmApi: false, // too small
                },
                siblings: ['jetson', 'codespace'],
            };
        case 'jetson':
            return {
                tier,
                instanceId,
                platform: 'Jetson / Edge (Linux + CUDA)',
                capabilities: {
                    async: true,
                    network: true,
                    filesystem: true,
                    persistent: true,
                    gpu: true,
                    llmApi: true, // can run small models locally
                },
                siblings: ['esp32', 'codespace', 'cloudflare'],
            };
        case 'codespace':
            return {
                tier,
                instanceId,
                platform: 'GitHub Codespace (Linux container)',
                capabilities: {
                    async: true,
                    network: true,
                    filesystem: true,
                    persistent: false, // ephemeral by default
                    gpu: false, // no GPU in codespace
                    llmApi: true,
                },
                siblings: ['jetson', 'cloudflare', 'server'],
            };
        case 'cloudflare':
            return {
                tier,
                instanceId,
                platform: 'Cloudflare Worker (V8 isolate)',
                capabilities: {
                    async: true,
                    network: true,
                    filesystem: false, // no local FS
                    persistent: true, // D1, KV, R2
                    gpu: false,
                    llmApi: true, // Workers AI
                },
                siblings: ['codespace', 'jetson'],
            };
        case 'server':
            return {
                tier,
                instanceId,
                platform: 'Generic server (Node.js / Bun / Deno)',
                capabilities: {
                    async: true,
                    network: true,
                    filesystem: true,
                    persistent: true,
                    gpu: true, // if hardware available
                    llmApi: true,
                },
                siblings: ['codespace', 'jetson', 'cloudflare'],
            };
        case 'browser':
            return {
                tier,
                instanceId,
                platform: 'Browser (Web)',
                capabilities: {
                    async: true,
                    network: true,
                    filesystem: false, // no FS
                    persistent: true, // IndexedDB / localStorage
                    gpu: true, // WebGL
                    llmApi: true, // browser LLM
                },
                siblings: ['codespace', 'cloudflare', 'server'],
            };
        case 'unknown':
        default:
            return {
                tier: 'unknown',
                instanceId,
                platform: 'Unknown',
                capabilities: {
                    async: false,
                    network: false,
                    filesystem: false,
                    persistent: false,
                    gpu: false,
                    llmApi: false,
                },
                siblings: [],
            };
    }
}
function generateInstanceId(tier) {
    const env = typeof process !== 'undefined' ? process.env : {};
    // Honor explicit instance id
    if (env.QUILT_INSTANCE_ID)
        return env.QUILT_INSTANCE_ID;
    // Honor Codespace name
    if (env.CODESPACE_NAME)
        return `codespace-${env.CODESPACE_NAME.split('-').pop()}`;
    // Honor hostname
    let hostname = 'local';
    try {
        if (typeof process !== 'undefined' && process.env?.HOSTNAME) {
            hostname = process.env.HOSTNAME;
        }
    }
    catch {
        // no-op
    }
    // Tier-specific id format
    const suffix = (hostname || 'local').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || Math.random().toString(36).slice(2, 8);
    return `${tier}-${suffix}`;
}
export class FederatedArtifactStore {
    hotCache = new Map();
    currentBytes = 0;
    maxBytes;
    local;
    opts;
    constructor(opts = {}) {
        this.opts = opts;
        this.maxBytes = opts.maxLocalBytes ?? 64 * 1024 * 1024; // 64 MB default
        this.local = opts.local ?? new MemoryCacheBackend();
    }
    log(msg, level = 'info') {
        this.opts.log?.(msg, level);
    }
    /** Build the R2 key for a logical URI + version. */
    r2Key(uri, version) {
        // Strip `quilt://` prefix; preserve bucket/name:version structure
        const clean = uri.replace(/^quilt:\/\//, '');
        return version ? `${clean}:${version}` : clean;
    }
    /** Promote an entry to hot cache; LRU-evict if over limit. */
    touchHot(key, entry) {
        entry.lastAccess = Date.now();
        this.hotCache.set(key, entry);
        this.currentBytes += entry.size;
        while (this.currentBytes > this.maxBytes && this.hotCache.size > 1) {
            // Evict LRU
            let oldest = null;
            let oldestTime = Infinity;
            for (const [k, e] of this.hotCache) {
                if (e.lastAccess < oldestTime) {
                    oldest = k;
                    oldestTime = e.lastAccess;
                }
            }
            if (oldest && oldest !== key) {
                const evicted = this.hotCache.get(oldest);
                if (evicted)
                    this.currentBytes -= evicted.size;
                this.hotCache.delete(oldest);
            }
            else
                break;
        }
    }
    async put(logicalUri, bytes, metadata) {
        const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
        const contentHash = metadata.contentHash ?? hashBytes(data);
        const version = metadata.version ?? contentHash.slice(0, 12);
        const fullUri = `${logicalUri}:${version}`;
        const fullMeta = { ...metadata, contentHash, createdAt: metadata.createdAt ?? new Date().toISOString() };
        // 1. Write to local tier
        await this.local.put(fullUri, data, fullMeta);
        // 2. Write to hot cache
        const entry = { bytes: data, metadata: fullMeta, size: data.byteLength, lastAccess: Date.now() };
        this.touchHot(fullUri, entry);
        // 3. Replicate to R2 if available (best-effort; failure doesn't break the put)
        if (this.opts.r2 && this.opts.r2Bucket) {
            try {
                const key = this.r2Key(logicalUri, version);
                await this.opts.r2.put(key, data);
                this.log(`R2 put: ${key} (${data.byteLength} bytes)`, 'info');
            }
            catch (e) {
                this.log(`R2 put failed for ${logicalUri}: ${e.message}`, 'warn');
            }
        }
        return { uri: fullUri, version };
    }
    async get(uri) {
        // 1. Hot cache
        const hot = this.hotCache.get(uri);
        if (hot) {
            hot.lastAccess = Date.now();
            return { bytes: hot.bytes, metadata: hot.metadata };
        }
        // 2. Local tier
        const local = await this.local.get(uri);
        if (local) {
            const entry = { ...local, size: local.bytes.byteLength, lastAccess: Date.now() };
            this.touchHot(uri, entry);
            return { bytes: local.bytes, metadata: local.metadata };
        }
        // 3. R2 (cold tier)
        if (this.opts.r2) {
            const key = this.r2Key(uri);
            const obj = await this.opts.r2.get(key);
            if (obj) {
                const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
                const metadata = { contentHash: hashBytes(bytes), createdAt: new Date().toISOString() };
                // Promote: write through local + hot
                await this.local.put(uri, bytes, metadata);
                const entry = { bytes, metadata, size: bytes.byteLength, lastAccess: Date.now() };
                this.touchHot(uri, entry);
                this.log(`R2 hit: ${key} (${bytes.byteLength} bytes, promoted to local)`, 'info');
                return { bytes, metadata };
            }
        }
        throw new Error(`Artifact not found in any tier: ${uri}`);
    }
    async exists(uri) {
        if (this.hotCache.has(uri))
            return true;
        if (await this.local.get(uri).then((x) => !!x))
            return true;
        if (this.opts.r2) {
            const obj = await this.opts.r2.get(this.r2Key(uri));
            return !!obj;
        }
        return false;
    }
    async listVersions(logicalUri) {
        const out = [];
        const prefix = logicalUri + ':';
        // Local
        if (this.local.list) {
            const items = await this.local.list(prefix);
            for (const it of items) {
                const version = it.key.slice(prefix.length);
                out.push({ version, createdAt: typeof it.metadata.createdAt === 'string' ? it.metadata.createdAt : '' });
            }
        }
        // R2
        if (this.opts.r2?.list) {
            const r2List = await this.opts.r2.list({ prefix: this.r2Key(logicalUri) });
            for (const obj of r2List.objects) {
                const version = obj.key.split(':').pop() ?? '';
                if (!out.find((o) => o.version === version)) {
                    out.push({ version, createdAt: obj.uploaded });
                }
            }
        }
        return out;
    }
    /** Invalidate a URI from all tiers. */
    async invalidate(uri) {
        this.hotCache.delete(uri);
        await this.local.delete?.(uri);
        if (this.opts.r2?.delete) {
            await this.opts.r2.delete(this.r2Key(uri));
        }
    }
    /** Inspect hot cache (for debugging / metrics). */
    hotStats() {
        return { entries: this.hotCache.size, bytes: this.currentBytes, maxBytes: this.maxBytes };
    }
}
/** In-memory cache backend (default for `local`). */
export class MemoryCacheBackend {
    store = new Map();
    async get(key) { return this.store.get(key) ?? null; }
    async put(key, bytes, metadata) { this.store.set(key, { bytes, metadata }); }
    async delete(key) { this.store.delete(key); }
    async list(prefix) {
        const out = [];
        for (const [k, v] of this.store)
            if (!prefix || k.startsWith(prefix))
                out.push({ key: k, metadata: v.metadata });
        return out;
    }
}
/** Filesystem-backed cache tier (Node.js). */
export class FileSystemCacheBackend {
    rootDir;
    constructor(rootDir) { this.rootDir = rootDir; }
    path(key) {
        // Sanitize: replace non-alphanumeric with underscores
        const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
        return `${this.rootDir}/${safe}`;
    }
    async get(key) {
        try {
            const { readFile } = await import('node:fs/promises');
            const data = await readFile(this.path(key));
            // Read metadata from sidecar
            let metadata = { contentHash: hashBytes(new Uint8Array(data)) };
            try {
                const { readFile: r2 } = await import('node:fs/promises');
                const metaJson = await r2(this.path(key) + '.meta.json', 'utf8');
                metadata = JSON.parse(metaJson);
            }
            catch { /* no metadata file */ }
            return { bytes: new Uint8Array(data), metadata };
        }
        catch {
            return null;
        }
    }
    async put(key, bytes, metadata) {
        const { writeFile, mkdir } = await import('node:fs/promises');
        const { dirname } = await import('node:path');
        await mkdir(dirname(this.path(key)), { recursive: true });
        await writeFile(this.path(key), bytes);
        await writeFile(this.path(key) + '.meta.json', JSON.stringify(metadata, null, 2));
    }
    async delete(key) {
        try {
            const { unlink } = await import('node:fs/promises');
            await unlink(this.path(key));
            await unlink(this.path(key) + '.meta.json');
        }
        catch { /* ignore */ }
    }
    async list(prefix) {
        const { readdir, readFile } = await import('node:fs/promises');
        try {
            const files = await readdir(this.rootDir);
            const out = [];
            for (const f of files) {
                if (f.endsWith('.meta.json'))
                    continue;
                const k = f; // reconstruction: we don't have the original URI, but the key matches
                if (prefix && !k.startsWith(prefix))
                    continue;
                let metadata = { contentHash: '' };
                try {
                    metadata = JSON.parse(await readFile(`${this.rootDir}/${f}.meta.json`, 'utf8'));
                }
                catch { /* ignore */ }
                out.push({ key: k, metadata });
            }
            return out;
        }
        catch {
            return [];
        }
    }
}
// Note: MqttCellTransport is a URI-addressed transport (resolve/getValue/
// publish/subscribe(uri, onValue)) rather than the (instance, sheet, cellPath)
// shape of the CellTransport interface, so it does not declare `implements
// CellTransport`. It is consumed directly via its own API (see
// federation-store tests), not through the CellTransport contract.
export class MqttCellTransport {
    client;
    opts;
    listeners = new Map();
    connected = false;
    constructor(client, opts) {
        this.client = client;
        this.opts = { qos: 1, retain: true, ...opts };
        this.wire();
    }
    wire() {
        this.client.on('connect', () => { this.connected = true; });
        this.client.on('close', () => { this.connected = false; });
        this.client.on('message', (topic, payload) => {
            const t = String(topic);
            const p = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
            try {
                const decoded = JSON.parse(new TextDecoder().decode(p));
                for (const [pattern, cbs] of this.listeners) {
                    if (mqttTopicMatches(pattern, t)) {
                        for (const cb of cbs)
                            cb(decoded);
                    }
                }
            }
            catch { /* malformed payload, ignore */ }
        });
    }
    async resolve(uri) {
        const ref = parseCellRef(uri);
        // Topic format: quilt/{instance}/{sheet}/{cellPath}
        // Subscribers can use wildcards: quilt/+/+/#, quilt/+/foo/+/bar, etc.
        const topic = `quilt/${ref.instance}/${ref.sheet}/${ref.cellPath}`;
        return { uri, ref, transport: 'mqtt', topic };
    }
    async getValue(uri, timeoutMs = 5000) {
        // MQTT doesn't have a synchronous get. We subscribe and wait for the
        // next retained message, with a configurable timeout.
        const ref = parseCellRef(uri);
        const topic = `quilt/${ref.instance}/${ref.sheet}/${ref.cellPath}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { unsub(); reject(new Error(`MQTT getValue timeout for ${uri}`)); }, timeoutMs);
            const cb = (v) => { clearTimeout(timer); unsub(); resolve(v); };
            const subs = this.listeners.get(topic) ?? new Set();
            subs.add(cb);
            this.listeners.set(topic, subs);
            const unsub = () => { subs.delete(cb); if (subs.size === 0)
                this.listeners.delete(topic); };
            this.client.subscribe(topic, { qos: this.opts.qos ?? 1 });
        });
    }
    subscribe(uri, onValue) {
        const ref = parseCellRef(uri);
        const topic = `quilt/${ref.instance}/${ref.sheet}/${ref.cellPath}`;
        const cb = (v) => onValue(v);
        const subs = this.listeners.get(topic) ?? new Set();
        subs.add(cb);
        this.listeners.set(topic, subs);
        this.client.subscribe(topic, { qos: this.opts.qos ?? 1 });
        return () => {
            subs.delete(cb);
            if (subs.size === 0)
                this.listeners.delete(topic);
        };
    }
    publish(uri, value) {
        const ref = parseCellRef(uri);
        const topic = `quilt/${ref.instance}/${ref.sheet}/${ref.cellPath}`;
        const payload = new TextEncoder().encode(JSON.stringify(value));
        this.client.publish(topic, payload, { qos: this.opts.qos ?? 1, retain: this.opts.retain ?? true });
    }
    /** Direct topic access (for non-Quilt MQTT topics). */
    publishRaw(topic, payload, retain) {
        this.client.publish(topic, payload, { qos: this.opts.qos ?? 1, retain: retain ?? this.opts.retain ?? true });
    }
    subscribeRaw(topic, cb) {
        const handler = (t, p) => {
            const payload = p instanceof Uint8Array ? p : new Uint8Array(p);
            cb(String(t), payload);
        };
        this.client.on('message', handler);
        this.client.subscribe(topic, { qos: this.opts.qos ?? 1 });
        return () => { };
    }
    isConnected() { return this.connected; }
    close() { this.client.end(true); }
}
/** MQTT topic matching with wildcards. `+` matches one level; `#` matches many. */
export function mqttTopicMatches(pattern, topic) {
    const p = pattern.split('/');
    const t = topic.split('/');
    for (let i = 0; i < p.length; i++) {
        if (p[i] === '#')
            return true;
        if (p[i] === '+') {
            if (t[i] === undefined)
                return false;
            continue;
        }
        if (p[i] !== t[i])
            return false;
    }
    return p.length === t.length;
}
