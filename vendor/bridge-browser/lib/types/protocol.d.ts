/**
 * Wire contract between the dsh bridge plugin and the browser extension.
 *
 * Zero-dependency module (pure types, constants, and a parser): both the
 * plugin (node) and the Chrome extension (browser bundle) import this file, so
 * the frame shapes can never drift between the two halves.
 *
 * Frames are one JSON object per WebSocket message, discriminated by `t`.
 * Correlation ids (`id`) are minted by the requestor and echoed by the
 * responder; they are opaque strings, never parsed.
 *
 * @module
 */
/** WebSocket pathname the bridge plugin registers on the host webserver. */
export declare const BRIDGE_PATH = "/ext/bridge";
/** Zero-config discovery endpoint: returns `{ wsUrl }` for the extension. */
export declare const BRIDGE_CONFIG_PATH = "/ext/bridge-config";
/**
 * Fixed loopback ports the plugin's discovery beacon tries, in order.
 *
 * DSH Desktop launches its host with `--port 0`, so every launch lands on a
 * different OS-assigned port and no fixed list of real ports can find it. The
 * beacon binds the first free port of this range and answers
 * {@link BRIDGE_CONFIG_PATH} with the real bridge URL, which turns discovery
 * into a handful of bounded probes. 43189 is the port older deployment notes
 * already recommended pinning by hand.
 */
export declare const BEACON_PORTS: readonly [43189, 43190, 43191, 43192, 43193, 43194, 43195, 43196, 43197, 43198];
/**
 * Ports a local dsh may serve on without the beacon: the CLI default and the
 * ports operators historically picked. Probed after any remembered URL.
 */
export declare const LEGACY_BRIDGE_PORTS: readonly [3080, 3081, 3090, 14389];
/** Internal RPC used after an explicit tab handoff to seed the Agent's next step. */
export declare const BRIDGE_INJECT_BROWSER_SNAPSHOT_METHOD = "bridge.injectBrowserSnapshot";
/** Internal RPC used by the panel to permanently delete one session's durable storage. */
export declare const BRIDGE_SESSION_PURGE_METHOD = "bridge.session.purge";
/** Seconds a fresh socket may take to present `hello` before it is closed. */
export declare const HELLO_TIMEOUT_MS = 5000;
/** Server-side ping cadence; the client answers `pong` to prove liveness. */
export declare const PING_INTERVAL_MS = 30000;
/** Default bytes of the generated bearer token (256-bit). */
export declare const DEFAULT_TOKEN_BYTES = 32;
/** Default rendered-snapshot character budget. */
export declare const DEFAULT_SNAPSHOT_MAX_CHARS = 32000;
/** Smallest snapshot budget that can carry both trust boundaries and page text. */
export declare const MIN_SNAPSHOT_MAX_CHARS = 500;
/** Error codes a tool call may settle with. Open set: consumers must tolerate unknown codes. */
export type ToolErrorCode = 'no-active-tab' | 'content-unavailable' | 'action-failed' | 'timeout' | 'bridge-closed' | 'bad-args' | 'internal'
/** The platform has no trustworthy input channel (no `chrome.debugger`). */
 | 'input-unavailable';
/** One tool-call failure: stable machine code plus human text for the model. */
export interface ToolError {
    code: ToolErrorCode;
    message: string;
}
/** Result sent for a pending host interaction such as ask_user_question. */
export type RespondResult = {
    ok: true;
    value?: unknown;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
        details: Record<string, unknown>;
    };
};
/**
 * Developer-tools capability the extension advertises when it can drive a
 * debugger session (Chrome only: `chrome.debugger`). Absent for platforms and
 * builds without it, which keeps the devtools tools unregistered there.
 */
export interface DevToolsCaps {
    /** Wire version of the devtools tool group. */
    version: typeof DEVTOOLS_CAPS_VERSION;
}
/** Capabilities negotiated in `hello`/`hello.ok`. The extension performs its own actions; these bounds shape page snapshots. */
export interface BridgeCaps {
    /** The extension renders page state as text only (no screenshots). */
    textOnly: true;
    /** Upper bound on one rendered snapshot's characters (plugin config, minimum 500). */
    snapshotMaxChars: number;
    /** Upper bound on interactive inventory items per snapshot (plugin config). */
    maxInteractiveItems: number;
    /** Present only when the connected extension supports the developer-tools group. */
    devTools?: DevToolsCaps;
}
/** Version of the developer-tools tool group this plugin speaks. */
export declare const DEVTOOLS_CAPS_VERSION = 1;
/**
 * The developer-tools group's wire action names (tool name == action name).
 * Registered only while the connected extension advertises `caps.devTools`.
 */
export declare const DEVTOOLS_TOOL_NAMES: readonly ["browser_devtools_elements", "browser_devtools_set_element_style", "browser_devtools_set_element_attribute", "browser_console_eval", "browser_console_logs", "browser_devtools_network", "browser_devtools_list_requests", "browser_devtools_get_request", "browser_devtools_request_body"];
/** Frames sent by the extension to the bridge plugin. */
export type ClientFrame = 
/** First frame, within HELLO_TIMEOUT_MS of socket open. */
{
    t: 'hello';
    token: string;
    caps: BridgeCaps;
}
/** Unary call projected by the active dsh Host adapter. */
 | {
    t: 'rpc';
    id: string;
    method: string;
    payload: unknown;
}
/** Answer or cancel a pending Host interaction waterfall. */
 | {
    t: 'respond';
    id: string;
    rpcId: string;
    result: RespondResult;
}
/** Result of a previously dispatched tool call. */
 | {
    t: 'tool.result';
    id: string;
    ok: true;
    result: unknown;
} | {
    t: 'tool.result';
    id: string;
    ok: false;
    error: ToolError;
}
/** Liveness reply. */
 | {
    t: 'pong';
};
/** Frames sent by the bridge plugin to the extension. */
export type ServerFrame = 
/** Accepted after a valid `hello`. */
{
    t: 'hello.ok';
    caps: BridgeCaps;
}
/** Reply to an `rpc` frame; `result` is the bridge's stable ServerResponse envelope. */
 | {
    t: 'rpc.result';
    id: string;
    ok: true;
    result: unknown;
} | {
    t: 'rpc.result';
    id: string;
    ok: false;
    error: {
        code: string;
        message: string;
    };
}
/** Receipt for a `respond` frame (normally `{ accepted: boolean }`). */
 | {
    t: 'respond.result';
    id: string;
    ok: true;
    result: unknown;
} | {
    t: 'respond.result';
    id: string;
    ok: false;
    error: {
        code: string;
        message: string;
    };
}
/** One bridge-owned event envelope projected from Remote streams and waterfalls. */
 | {
    t: 'event';
    frame: {
        rpcId: string;
        method: string;
        payload: unknown;
    };
}
/** A model-requested browser action to execute in the user-controlled tab. */
 | {
    t: 'tool.call';
    id: string;
    name: string;
    args: Record<string, unknown>;
    expiresAt: number;
    sessionId?: string;
}
/** Withdraw a tool call that timed out or whose caller was cancelled. */
 | {
    t: 'tool.cancel';
    id: string;
}
/** Liveness probe. */
 | {
    t: 'ping';
}
/** Fatal connection error; the client should re-authenticate. */
 | {
    t: 'error';
    code: string;
    message: string;
};
/** Any frame on the wire. */
export type BridgeFrame = ClientFrame | ServerFrame;
/**
 * Type guard: is this frame one the SERVER may send? Client-only shapes
 * (hello/tool.result/pong) narrow out, so server-side consumers never
 * dispatch on their own request vocabulary.
 * @param frame - parsed frame.
 * @returns true for server-sendable frames.
 */
export declare function isServerFrame(frame: BridgeFrame): frame is ServerFrame;
/**
 * Type guard: is this frame one the CLIENT may send? Server-only shapes
 * narrow out, so client-side consumers never dispatch on server vocabulary.
 * @param frame - parsed frame.
 * @returns true for client-sendable frames.
 */
export declare function isClientFrame(frame: BridgeFrame): frame is ClientFrame;
/**
 * Parse one WebSocket message into a frame.
 * @param text - raw message text.
 * @returns the frame, or `undefined` when the message is not a valid frame.
 */
export declare function parseBridgeFrame(text: string): BridgeFrame | undefined;
/** Validate the optional developer-tools capability; unknown versions are unusable. */
export declare function isDevToolsCaps(value: unknown): value is DevToolsCaps;
export declare function isRespondResult(value: unknown): value is RespondResult;
/**
 * Answer of the discovery endpoint ({@link BRIDGE_CONFIG_PATH}), served by the
 * host route and by the fixed-port beacon.
 *
 * `pid` and `startedAt` are optional instance metadata: the extension's
 * instance picker shows them, and an older plugin simply omits them.
 */
export interface BridgeConfigPayload {
    /** Bridge WebSocket URL the extension should open. */
    wsUrl: string;
    /** Set when a fixed-port discovery beacon (not the host route) answered. */
    beacon?: true;
    /** Host process id, for telling several local instances apart. */
    pid?: number;
    /** Host start time as an ISO 8601 string. */
    startedAt?: string;
}
/** Instance metadata the discovery endpoints advertise. */
export interface BridgeInstanceInfo {
    pid?: number;
    startedAt?: string;
}
/**
 * Build a discovery answer naming the host's real bridge URL.
 * @param hostPort - port the host webserver actually bound.
 * @param info - optional instance metadata.
 * @param beacon - mark the answer as coming from a beacon.
 * @returns the payload to serialize.
 */
export declare function bridgeConfigPayload(hostPort: number, info?: BridgeInstanceInfo, beacon?: boolean): BridgeConfigPayload;
/**
 * Whether a URL names the local bridge: `ws:` on a loopback host with the
 * bridge path. Discovered answers must satisfy this, so a stray local service
 * that happens to answer the path cannot send the extension off-machine.
 */
export declare function isLoopbackBridgeUrl(url: string): boolean;
/**
 * Parse a discovery answer. Unknown fields are ignored and instance metadata
 * is only kept when well formed; an answer that does not name the local bridge
 * is rejected outright.
 * @param value - parsed JSON body of the discovery response.
 * @returns the normalized payload, or `undefined` when it is not usable.
 */
export declare function parseBridgeConfigPayload(value: unknown): BridgeConfigPayload | undefined;
//# sourceMappingURL=protocol.d.ts.map