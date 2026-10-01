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
export { default as manifestSchema } from '../../../schemas/manifest.schema.json';
/**
 * A Quilt URI of the form `quilt://bucket/name:version`. Version is
 * optional — `quilt://bucket/name` means "resolve to the latest pinned
 * version". `quilt://cells/foo.bar` refers to a cell value in a sheet
 * (the canonical cell addressing scheme).
 */
export type QuiltURI = string;
/**
 * The result of resolving a Quilt URI. `version` is always set after
 * resolution (`:latest` is pinned). `localPath` and `signedUrl` are
 * optional because some artifacts are computed (cells) rather than
 * fetched.
 */
export interface ResolvedArtifact {
    /** The original URI that was passed in. */
    uri: QuiltURI;
    /** The version this URI resolved to. */
    version: string;
    /** The fully-resolved URI with explicit version. */
    resolvedUri: QuiltURI;
    /** Local materialized path, if the artifact was downloaded. */
    localPath?: string;
    /** Time-limited signed URL for remote fetch, if applicable. */
    signedUrl?: string;
    /** Free-form metadata returned by the store. */
    metadata: Record<string, unknown>;
    /** Provenance information: who made it, when, from what. */
    provenance: {
        createdAt: string;
        originCommit?: string;
        manifestId?: string;
    };
}
/**
 * The context object passed alongside any resolve/validate call. The
 * runtime injects run_id, timestamp, commit, and any planner-provided
 * variables. Templates may reference any of these as `{{key}}`.
 */
export interface RunContext {
    runId?: string;
    timestamp?: string;
    commit?: string;
    plannerVersion?: string;
    [key: string]: string | undefined;
}
/**
 * Result of manifest validation. `valid: true` means the manifest
 * conforms to the schema and (if requested) all artifact preconditions
 * are met.
 */
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}
export interface ValidationError {
    path: string;
    message: string;
    keyword?: string;
}
/**
 * Metadata attached to a published artifact. Becomes the artifact's
 * provenance record.
 */
export interface ArtifactMetadata {
    /** Schema version of the manifest, e.g. "1.0.0". */
    version?: string;
    /** Free-form tags for search and grouping. */
    tags?: string[];
    /** SHA-256 of the artifact bytes; computed if not provided. */
    contentHash?: string;
    /** MIME type, e.g. "application/json". */
    contentType?: string;
    /** The manifest_id of the sheet that produced this artifact. */
    manifestId?: string;
    /** The run_id of the execution that produced this artifact. */
    runId?: string;
    /** Any additional free-form metadata. */
    [key: string]: unknown;
}
/**
 * A run trace — the canonical, immutable record of one execution. Every
 * run_trace is itself an artifact in Quilt, with a canonical URI.
 */
export interface RunTrace {
    runId: string;
    planId?: string;
    manifestId?: string;
    manifestVersion?: string;
    startTime: string;
    endTime?: string;
    status: 'pending' | 'running' | 'success' | 'failed' | 'aborted';
    nodes: RunTraceNode[];
    provenance?: {
        commit?: string;
        plannerVersion?: string;
        manifestId?: string;
    };
    replayHint?: {
        priority?: number;
        tags?: string[];
    };
}
export interface RunTraceNode {
    nodeId: string;
    status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'rolledback';
    startTime?: string;
    endTime?: string;
    exitCode?: number;
    artifactUris?: QuiltURI[];
    logUri?: QuiltURI;
    error?: string;
}
/**
 * An abstract artifact store. The default in-memory implementation is
 * used for tests; production wire-ups provide a Cloudflare R2, S3, or
 * local-filesystem implementation.
 *
 * The store is content-addressed: callers provide a `logicalUri` (the
 * path before `:version`) and the store computes a version from the
 * content hash. The full URI returned is `${logicalUri}:${version}`.
 */
export interface ArtifactStore {
    /** Store bytes under a logical URI. Returns the canonical URI + version. */
    put(logicalUri: QuiltURI, bytes: Uint8Array | string, metadata: ArtifactMetadata): Promise<{
        uri: QuiltURI;
        version: string;
    }>;
    /** Fetch bytes by full URI. */
    get(uri: QuiltURI): Promise<{
        bytes: Uint8Array;
        metadata: ArtifactMetadata;
    }>;
    /** Check if an artifact exists. */
    exists(uri: QuiltURI): Promise<boolean>;
    /** List versions of a logical artifact (without :version). */
    listVersions(logicalUri: QuiltURI): Promise<{
        version: string;
        createdAt: string;
    }[]>;
}
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
export declare function resolveTemplate(input: string, context?: RunContext): string;
export declare class TemplateError extends Error {
    constructor(message: string);
}
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
export declare function resolveArtifact(uri: QuiltURI, context?: RunContext, store?: ArtifactStore): Promise<ResolvedArtifact>;
export declare class ResolveError extends Error {
    readonly uri: QuiltURI;
    constructor(message: string, uri: QuiltURI);
}
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
export declare function validateManifest(manifest: unknown, options?: {
    store?: ArtifactStore;
    checkExists?: boolean;
    runContext?: RunContext;
}): Promise<ValidationResult>;
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
export declare function publishArtifact(source: Uint8Array | string | {
    path: string;
}, metadata: ArtifactMetadata, store: ArtifactStore): Promise<{
    uri: QuiltURI;
    version: string;
    contentHash: string;
}>;
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
export declare function publishRunTrace(trace: RunTrace, store: ArtifactStore): Promise<{
    uri: QuiltURI;
    version: string;
}>;
/**
 * A minimal in-memory artifact store. Useful for tests, examples, and
 * browser-based demos where there is no real backend. Production
 * deployments should swap this for a Cloudflare R2 / S3 implementation.
 */
export declare class InMemoryArtifactStore implements ArtifactStore {
    private store;
    put(logicalUri: QuiltURI, bytes: Uint8Array | string, metadata: ArtifactMetadata): Promise<{
        uri: QuiltURI;
        version: string;
    }>;
    get(uri: QuiltURI): Promise<{
        bytes: Uint8Array;
        metadata: ArtifactMetadata;
    }>;
    exists(uri: QuiltURI): Promise<boolean>;
    listVersions(logicalUri: QuiltURI): Promise<{
        version: string;
        createdAt: string;
    }[]>;
    /** Inspect everything (for debugging). */
    entries(): Array<[string, ArtifactMetadata]>;
}
/**
 * A federated cell reference. The format is:
 *
 *   quilt://[instance-id]/[sheet-id]#[cell-path]
 *
 * Examples:
 *   quilt://local/boat-autopilot#rudder.angle
 *   quilt://jetson-lab/perception#vision.scene
 *   quilt://codespace-7c3/prod#anomaly.detector
 *   quilt://*#/anywhere           — wildcard routing
 *   quilt://esp32-fleet/+/rudder.angle — fleet-wide cell
 *
 * The instance-id can be a name, IP, hostname, or `local` for the
 * current process. The sheet-id identifies a loaded sheet. The
 * cell-path uses dots, like a Quilt cell id.
 */
export interface FederatedCellRef {
    /** The original URI. */
    uri: string;
    /** Instance id (e.g. "local", "jetson-lab", "codespace-7c3"). */
    instance: string;
    /** Sheet id (e.g. "boat-autopilot", "prod"). */
    sheet: string;
    /** Cell path within the sheet (e.g. "rudder.angle"). */
    cellPath: string;
    /** Whether this is a wildcard reference (`*` or `+`). */
    isWildcard: boolean;
}
/**
 * Parse a federated cell URI into its parts. Throws on malformed URIs.
 *
 * @example
 *   parseCellRef("quilt://local/boat-autopilot#rudder.angle")
 *   // -> { instance: "local", sheet: "boat-autopilot", cellPath: "rudder.angle", ... }
 */
export declare function parseCellRef(uri: string): FederatedCellRef;
export declare class CellRefError extends Error {
    readonly uri: string;
    constructor(message: string, uri?: string);
}
/**
 * A live handle to a cell, locally or on a remote Quilt. Wraps a
 * subscription so callers can `await handle.get()`, `await
 * handle.set(v)`, and `await handle.unsubscribe()`.
 *
 * The handle is the federated equivalent of a cell id: addressable,
 * subscribable, and inspectable. It hides the difference between
 * "value is in this process" and "value is on another Quilt 4 hops
 * away" — the caller doesn't care.
 */
export interface CellHandle {
    /** The original URI. */
    readonly uri: string;
    /** Get the current value. */
    get(): Promise<unknown>;
    /** Set the value (if the cell is settable; throws on read-only). */
    set(value: unknown): Promise<void>;
    /** Subscribe to changes. Returns an unsubscribe function. */
    subscribe(callback: (value: unknown) => void): () => void;
    /** Unsubscribe all listeners. */
    unsubscribe(): void;
}
/**
 * A transport for fetching cells from a remote Quilt instance. The
 * default in-process implementation reads from a local engine; the
 * HTTP/MCP/WebSocket implementation talks to a remote Quilt.
 */
export interface CellTransport {
    /** Get a cell value. */
    get(instance: string, sheet: string, cellPath: string): Promise<unknown>;
    /** Set a cell value. */
    set(instance: string, sheet: string, cellPath: string, value: unknown): Promise<void>;
    /** Subscribe to cell changes. Returns an unsubscribe function. */
    subscribe(instance: string, sheet: string, cellPath: string, callback: (value: unknown) => void): () => void;
}
/**
 * A local in-process transport backed by a QuiltEngine-like object.
 * The minimal contract needed is `getCell`, `setCell`, and `subscribe`.
 * This works with `@quilt/core`'s `QuiltEngine` directly.
 */
export interface LocalEngine {
    getCell(sheetId: string, cellPath: string): Promise<unknown>;
    setCell(sheetId: string, cellPath: string, value: unknown): Promise<void>;
    subscribe(sheetId: string, cellPath: string, callback: (value: unknown) => void): () => void;
}
/**
 * The most common transport: the local process. If `instance` is
 * "local" or matches the configured `localInstanceId`, read from the
 * local engine. Otherwise, raise — the caller should provide a
 * RemoteCellTransport for non-local instances.
 */
export declare class LocalCellTransport implements CellTransport {
    private readonly engines;
    private readonly localInstanceId;
    private listeners;
    constructor(engines: Map<string, LocalEngine>, localInstanceId?: string);
    get(instance: string, sheet: string, cellPath: string): Promise<unknown>;
    set(instance: string, sheet: string, cellPath: string, value: unknown): Promise<void>;
    subscribe(instance: string, sheet: string, cellPath: string, callback: (value: unknown) => void): () => void;
    private engineFor;
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
export declare class HttpCellTransport implements CellTransport {
    private readonly baseUrl;
    private readonly token;
    private listeners;
    private eventSources;
    constructor(baseUrl: string, token: string);
    private headers;
    private cellPath;
    get(instance: string, sheet: string, cellPath: string): Promise<unknown>;
    set(instance: string, sheet: string, cellPath: string, value: unknown): Promise<void>;
    subscribe(instance: string, sheet: string, cellPath: string, callback: (value: unknown) => void): () => void;
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
export declare function resolveCell(uri: string, transport: CellTransport): Promise<CellHandle>;
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
export declare function subscribeCell(uri: string, transport: CellTransport, callback: (value: unknown) => void): () => void;
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
export declare class CellRouter {
    private transports;
    /** Register a transport for a specific instance id. */
    add(instance: string, transport: CellTransport): this;
    /** Remove a transport. */
    remove(instance: string): boolean;
    /** Resolve a cell URI to a live handle, routing through the right transport. */
    resolve(uri: string): Promise<CellHandle>;
    /** Subscribe to a cell, routing through the right transport. */
    subscribe(uri: string, callback: (value: unknown) => void): () => void;
    /** List all registered instance ids. */
    instances(): string[];
}
/**
 * The deployment tier this Quilt is running in. Each tier has different
 * capabilities (memory, async support, network) and connects to
 * different siblings in a federation.
 *
 * Mirrors cocapn-runtime's "room" abstraction:
 *   ESP32 bare metal  -> quilt-esp32 (no_std, sensors+actuators)
 *   Jetson/Pi edge    -> quilt-jetson (sync + alloc, vision)
 *   Codespace         -> quilt-codespace (async, ttyd + MCP)
 *   Docker container  -> quilt-cloudflare (Workers, edge)
 *   Lighthouse cloud  -> quilt-codespace persistent (fleet coord)
 */
export type QuiltTier = 'esp32' | 'jetson' | 'codespace' | 'cloudflare' | 'server' | 'browser' | 'unknown';
/**
 * Information about the detected deployment tier. Use this to decide
 * which siblings to federate with and which capabilities to advertise.
 */
export interface TierInfo {
    tier: QuiltTier;
    /** Auto-generated instance id (e.g. "esp32-abc123", "codespace-7c3f1"). */
    instanceId: string;
    /** Human-readable platform name (e.g. "GitHub Codespace", "ESP32-WROOM-32"). */
    platform: string;
    /** Capabilities the tier supports. */
    capabilities: {
        async: boolean;
        network: boolean;
        filesystem: boolean;
        persistent: boolean;
        gpu: boolean;
        llmApi: boolean;
    };
    /** Connection hints for sibling tiers. */
    siblings: string[];
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
export declare function detectTier(): TierInfo;
/**
 * Build a TierInfo for a given tier, including auto-generated instance
 * id and platform name.
 */
export declare function tierInfoFor(tier: QuiltTier): TierInfo;
/**
 * FederatedArtifactStore — a multi-tier, content-addressed artifact store
 * with R2 as the canonical backing store and per-tier caches.
 *
 * Three-tier architecture:
 *   1. **Local memory** (fastest, per-instance) — for hot artifacts
 *   2. **Tier-local disk** (fast, per-instance) — for warm artifacts
 *   3. **R2 / S3** (canonical, shared) — for everything else
 *
 * Every artifact is content-addressed (sha256). Lookups can specify which
 * tiers to consult. Promotion from cold → warm → hot happens on read.
 *
 * This is the missing piece for cross-tier federation: an ESP32 can fetch
 * a model from R2 via the codespace's local cache, a Cloudflare Worker
 * can read a sheet from R2 with zero cold-start penalty, a Jetpack can
 * upload a run trace to R2 so the central server can replay it.
 *
 * R2 SDK is dynamically imported so this module works in non-R2
 * environments (browsers, Node, Workers without R2 binding). When the R2
 * binding is not available, only the local cache tier is used.
 */
export interface FederatedStoreOptions {
    /** R2 binding (Workers) — pass `env.MY_BUCKET`. */
    r2?: {
        put: (key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string) => Promise<unknown>;
        get: (key: string) => Promise<{
            body: ReadableStream;
            bodyUsed?: boolean;
        } | null>;
        delete?: (key: string) => Promise<void>;
        list?: (opts?: {
            prefix?: string;
            limit?: number;
            cursor?: string;
        }) => Promise<{
            objects: Array<{
                key: string;
                uploaded: string;
                size: number;
            }>;
            cursor?: string;
            truncated: boolean;
        }>;
    };
    /** R2 bucket name (required if r2 is set). */
    r2Bucket?: string;
    /** Tier-local cache: filesystem-style key/value. Defaults to an in-memory cache. */
    local?: {
        get: (key: string) => Promise<{
            bytes: Uint8Array;
            metadata: ArtifactMetadata;
        } | null>;
        put: (key: string, bytes: Uint8Array, metadata: ArtifactMetadata) => Promise<void>;
        delete?: (key: string) => Promise<void>;
        list?: (prefix?: string) => Promise<Array<{
            key: string;
            metadata: ArtifactMetadata;
        }>>;
    };
    /** Max local cache size in bytes (LRU eviction). */
    maxLocalBytes?: number;
    /** Custom logger. */
    log?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
}
export declare class FederatedArtifactStore implements ArtifactStore {
    private hotCache;
    private currentBytes;
    private readonly maxBytes;
    private readonly local;
    private readonly opts;
    constructor(opts?: FederatedStoreOptions);
    private log;
    /** Build the R2 key for a logical URI + version. */
    private r2Key;
    /** Promote an entry to hot cache; LRU-evict if over limit. */
    private touchHot;
    put(logicalUri: QuiltURI, bytes: Uint8Array | string, metadata: ArtifactMetadata): Promise<{
        uri: QuiltURI;
        version: string;
    }>;
    get(uri: QuiltURI): Promise<{
        bytes: Uint8Array;
        metadata: ArtifactMetadata;
    }>;
    exists(uri: QuiltURI): Promise<boolean>;
    listVersions(logicalUri: QuiltURI): Promise<{
        version: string;
        createdAt: string;
    }[]>;
    /** Invalidate a URI from all tiers. */
    invalidate(uri: QuiltURI): Promise<void>;
    /** Inspect hot cache (for debugging / metrics). */
    hotStats(): {
        entries: number;
        bytes: number;
        maxBytes: number;
    };
}
/** In-memory cache backend (default for `local`). */
export declare class MemoryCacheBackend {
    private store;
    get(key: string): Promise<{
        bytes: Uint8Array;
        metadata: ArtifactMetadata;
    } | null>;
    put(key: string, bytes: Uint8Array, metadata: ArtifactMetadata): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<{
        key: string;
        metadata: ArtifactMetadata;
    }[]>;
}
/** Filesystem-backed cache tier (Node.js). */
export declare class FileSystemCacheBackend {
    private rootDir;
    constructor(rootDir: string);
    private path;
    get(key: string): Promise<{
        bytes: Uint8Array;
        metadata: ArtifactMetadata;
    } | null>;
    put(key: string, bytes: Uint8Array, metadata: ArtifactMetadata): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<Array<{
        key: string;
        metadata: ArtifactMetadata;
    }>>;
}
/**
 * MqttCellTransport — an IoT-native cell transport using MQTT 5.0.
 *
 * Each Quilt cell is published to a topic of the form:
 *   quilt/[instance]/[sheet]/#/[cell-path]
 *
 * Subscribers can subscribe to:
 *   - A specific cell: quilt/+/+/foo/bar
 *   - A whole sheet: quilt/+/+/#/foo
 *   - A whole instance: quilt/esp32-1/#/+
 *   - The whole federation: quilt/#/+/+/+
 *
 * MQTT's retained-message + last-will-and-testament features mean cells
 * are auto-replayed on reconnect, and dead instances are detected in <1s.
 *
 * This is the natural transport for ESP32 / Jetson fleets behind a
 * local broker (Mosquitto, EMQX, HiveMQ, AWS IoT Core, Azure IoT Hub).
 */
export interface MqttTransportOptions {
    /** MQTT broker URL (e.g., `mqtt://broker:1883`, `mqtts://...:8883`). */
    url: string;
    /** Client id (defaults to instance id). */
    clientId?: string;
    /** Username/password (optional). */
    username?: string;
    password?: string;
    /** Will message on disconnect. */
    will?: {
        topic: string;
        payload: Uint8Array;
        qos: 0 | 1 | 2;
        retain: boolean;
    };
    /** QoS for cell publishes. Default 1. */
    qos?: 0 | 1 | 2;
    /** Whether published cells should be retained. Default true. */
    retain?: boolean;
}
/**
 * A minimal mqtt-like client interface. We don't import the `mqtt` package
 * directly because it's an optional peer dependency. Pass any client that
 * conforms to this shape: `mqtt`, `mqtt.js`, `aedes`, etc.
 */
export interface MqttLikeClient {
    on(event: 'connect' | 'message' | 'error' | 'close', cb: (...args: unknown[]) => void): void;
    subscribe(topic: string, opts?: {
        qos: 0 | 1 | 2;
    }, cb?: (err: Error | null) => void): void;
    publish(topic: string, payload: Uint8Array | string, opts?: {
        qos: 0 | 1 | 2;
        retain: boolean;
    }, cb?: () => void): void;
    end(force?: boolean): void;
}
export declare class MqttCellTransport {
    private readonly client;
    private readonly opts;
    private readonly listeners;
    private connected;
    constructor(client: MqttLikeClient, opts: MqttTransportOptions);
    private wire;
    resolve(uri: string): Promise<{
        uri: string;
        ref: FederatedCellRef;
        transport: 'mqtt';
        topic: string;
    }>;
    getValue(uri: string, timeoutMs?: number): Promise<unknown>;
    subscribe(uri: string, onValue: (v: unknown) => void): () => void;
    publish(uri: string, value: unknown): void;
    /** Direct topic access (for non-Quilt MQTT topics). */
    publishRaw(topic: string, payload: Uint8Array | string, retain?: boolean): void;
    subscribeRaw(topic: string, cb: (topic: string, payload: Uint8Array) => void): () => void;
    isConnected(): boolean;
    close(): void;
}
/** MQTT topic matching with wildcards. `+` matches one level; `#` matches many. */
export declare function mqttTopicMatches(pattern: string, topic: string): boolean;
