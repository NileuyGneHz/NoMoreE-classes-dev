//#region lib/types/protocol.js
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
const BRIDGE_PATH = "/ext/bridge";
/** Zero-config discovery endpoint: returns `{ wsUrl }` for the extension. */
const BRIDGE_CONFIG_PATH = "/ext/bridge-config";
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
const BEACON_PORTS = [
	43189,
	43190,
	43191,
	43192,
	43193,
	43194,
	43195,
	43196,
	43197,
	43198
];
/**
* Ports a local dsh may serve on without the beacon: the CLI default and the
* ports operators historically picked. Probed after any remembered URL.
*/
const LEGACY_BRIDGE_PORTS = [
	3080,
	3081,
	3090,
	14389
];
/** Internal RPC used after an explicit tab handoff to seed the Agent's next step. */
const BRIDGE_INJECT_BROWSER_SNAPSHOT_METHOD = "bridge.injectBrowserSnapshot";
/** Internal RPC used by the panel to permanently delete one session's durable storage. */
const BRIDGE_SESSION_PURGE_METHOD = "bridge.session.purge";
/** Seconds a fresh socket may take to present `hello` before it is closed. */
const HELLO_TIMEOUT_MS = 5e3;
/** Server-side ping cadence; the client answers `pong` to prove liveness. */
const PING_INTERVAL_MS = 3e4;
/** Default bytes of the generated bearer token (256-bit). */
const DEFAULT_TOKEN_BYTES = 32;
/** Default rendered-snapshot character budget. */
const DEFAULT_SNAPSHOT_MAX_CHARS = 32e3;
/** Smallest snapshot budget that can carry both trust boundaries and page text. */
const MIN_SNAPSHOT_MAX_CHARS = 500;
/** Version of the developer-tools tool group this plugin speaks. */
const DEVTOOLS_CAPS_VERSION = 1;
/**
* The developer-tools group's wire action names (tool name == action name).
* Registered only while the connected extension advertises `caps.devTools`.
*/
const DEVTOOLS_TOOL_NAMES = [
	"browser_devtools_elements",
	"browser_devtools_set_element_style",
	"browser_devtools_set_element_attribute",
	"browser_console_eval",
	"browser_console_logs",
	"browser_devtools_network",
	"browser_devtools_list_requests",
	"browser_devtools_get_request",
	"browser_devtools_request_body"
];
/**
* Type guard: is this frame one the SERVER may send? Client-only shapes
* (hello/tool.result/pong) narrow out, so server-side consumers never
* dispatch on their own request vocabulary.
* @param frame - parsed frame.
* @returns true for server-sendable frames.
*/
function isServerFrame(frame) {
	return frame.t === "hello.ok" || frame.t === "rpc.result" || frame.t === "respond.result" || frame.t === "event" || frame.t === "tool.call" || frame.t === "tool.cancel" || frame.t === "ping" || frame.t === "error";
}
/**
* Type guard: is this frame one the CLIENT may send? Server-only shapes
* narrow out, so client-side consumers never dispatch on server vocabulary.
* @param frame - parsed frame.
* @returns true for client-sendable frames.
*/
function isClientFrame(frame) {
	return frame.t === "hello" || frame.t === "rpc" || frame.t === "respond" || frame.t === "tool.result" || frame.t === "pong";
}
/**
* Parse one WebSocket message into a frame.
* @param text - raw message text.
* @returns the frame, or `undefined` when the message is not a valid frame.
*/
function parseBridgeFrame(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const frame = value;
	if (typeof frame.t !== "string") return void 0;
	switch (frame.t) {
		case "hello": return typeof frame.token === "string" && isCaps(frame.caps) ? {
			t: "hello",
			token: frame.token,
			caps: frame.caps
		} : void 0;
		case "rpc": return typeof frame.id === "string" && typeof frame.method === "string" ? {
			t: "rpc",
			id: frame.id,
			method: frame.method,
			payload: frame.payload
		} : void 0;
		case "respond": return typeof frame.id === "string" && typeof frame.rpcId === "string" && isRespondResult(frame.result) ? {
			t: "respond",
			id: frame.id,
			rpcId: frame.rpcId,
			result: frame.result
		} : void 0;
		case "tool.result":
			if (typeof frame.id !== "string") return void 0;
			if (frame.ok === true && "result" in frame) return {
				t: "tool.result",
				id: frame.id,
				ok: true,
				result: frame.result
			};
			return isToolError(frame.error) ? {
				t: "tool.result",
				id: frame.id,
				ok: false,
				error: frame.error
			} : void 0;
		case "pong": return { t: "pong" };
		case "hello.ok": return isCaps(frame.caps) ? {
			t: "hello.ok",
			caps: frame.caps
		} : void 0;
		case "rpc.result":
			if (typeof frame.id !== "string") return void 0;
			if (frame.ok === true && "result" in frame) return {
				t: "rpc.result",
				id: frame.id,
				ok: true,
				result: frame.result
			};
			return typeof frame.error === "object" && frame.error !== null ? {
				t: "rpc.result",
				id: frame.id,
				ok: false,
				error: frame.error
			} : void 0;
		case "respond.result":
			if (typeof frame.id !== "string") return void 0;
			if (frame.ok === true && "result" in frame) return {
				t: "respond.result",
				id: frame.id,
				ok: true,
				result: frame.result
			};
			return isWireError(frame.error) ? {
				t: "respond.result",
				id: frame.id,
				ok: false,
				error: frame.error
			} : void 0;
		case "event": return typeof frame.frame === "object" && frame.frame !== null ? {
			t: "event",
			frame: frame.frame
		} : void 0;
		case "tool.call":
			if (frame.sessionId !== void 0 && (typeof frame.sessionId !== "string" || frame.sessionId.trim() === "")) return void 0;
			return typeof frame.id === "string" && typeof frame.name === "string" && typeof frame.args === "object" && frame.args !== null && !Array.isArray(frame.args) && typeof frame.expiresAt === "number" && Number.isFinite(frame.expiresAt) && frame.expiresAt > 0 ? {
				t: "tool.call",
				id: frame.id,
				name: frame.name,
				args: frame.args,
				expiresAt: frame.expiresAt,
				...typeof frame.sessionId === "string" ? { sessionId: frame.sessionId } : {}
			} : void 0;
		case "tool.cancel": return typeof frame.id === "string" ? {
			t: "tool.cancel",
			id: frame.id
		} : void 0;
		case "ping": return { t: "ping" };
		case "error": return typeof frame.code === "string" && typeof frame.message === "string" ? {
			t: "error",
			code: frame.code,
			message: frame.message
		} : void 0;
		default: return;
	}
}
function isCaps(value) {
	if (typeof value !== "object" || value === null) return false;
	const caps = value;
	return caps.textOnly === true && typeof caps.snapshotMaxChars === "number" && Number.isInteger(caps.snapshotMaxChars) && caps.snapshotMaxChars >= 500 && typeof caps.maxInteractiveItems === "number" && caps.maxInteractiveItems > 0 && (caps.devTools === void 0 || isDevToolsCaps(caps.devTools));
}
/** Validate the optional developer-tools capability; unknown versions are unusable. */
function isDevToolsCaps(value) {
	return typeof value === "object" && value !== null && value.version === 1;
}
function isToolError(value) {
	return typeof value === "object" && value !== null && typeof value.code === "string" && typeof value.message === "string";
}
function isWireError(value) {
	return typeof value === "object" && value !== null && typeof value.code === "string" && typeof value.message === "string";
}
function isRespondResult(value) {
	if (typeof value !== "object" || value === null) return false;
	const result = value;
	if (result.ok === true) return result.error === void 0;
	return result.ok === false && isRespondError(result.error);
}
function isRespondError(value) {
	return isWireError(value) && typeof value.details === "object" && value.details !== null && !Array.isArray(value.details);
}
/**
* Build a discovery answer naming the host's real bridge URL.
* @param hostPort - port the host webserver actually bound.
* @param info - optional instance metadata.
* @param beacon - mark the answer as coming from a beacon.
* @returns the payload to serialize.
*/
function bridgeConfigPayload(hostPort, info = {}, beacon = false) {
	return {
		wsUrl: `ws://127.0.0.1:${String(hostPort)}${BRIDGE_PATH}`,
		...beacon ? { beacon: true } : {},
		...info.pid === void 0 ? {} : { pid: info.pid },
		...info.startedAt === void 0 ? {} : { startedAt: info.startedAt }
	};
}
/**
* Whether a URL names the local bridge: `ws:` on a loopback host with the
* bridge path. Discovered answers must satisfy this, so a stray local service
* that happens to answer the path cannot send the extension off-machine.
*/
function isLoopbackBridgeUrl(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "ws:") return false;
	const hostname = parsed.hostname.toLowerCase();
	return (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1") && parsed.pathname === "/ext/bridge";
}
/**
* Parse a discovery answer. Unknown fields are ignored and instance metadata
* is only kept when well formed; an answer that does not name the local bridge
* is rejected outright.
* @param value - parsed JSON body of the discovery response.
* @returns the normalized payload, or `undefined` when it is not usable.
*/
function parseBridgeConfigPayload(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const body = value;
	if (typeof body.wsUrl !== "string" || !isLoopbackBridgeUrl(body.wsUrl)) return void 0;
	return {
		wsUrl: body.wsUrl,
		...body.beacon === true ? { beacon: true } : {},
		...typeof body.pid === "number" && Number.isInteger(body.pid) && body.pid > 0 ? { pid: body.pid } : {},
		...typeof body.startedAt === "string" && body.startedAt !== "" ? { startedAt: body.startedAt } : {}
	};
}
//#endregion
export { BEACON_PORTS, BRIDGE_CONFIG_PATH, BRIDGE_INJECT_BROWSER_SNAPSHOT_METHOD, BRIDGE_PATH, BRIDGE_SESSION_PURGE_METHOD, DEFAULT_SNAPSHOT_MAX_CHARS, DEFAULT_TOKEN_BYTES, DEVTOOLS_CAPS_VERSION, DEVTOOLS_TOOL_NAMES, HELLO_TIMEOUT_MS, LEGACY_BRIDGE_PORTS, MIN_SNAPSHOT_MAX_CHARS, PING_INTERVAL_MS, bridgeConfigPayload, isClientFrame, isDevToolsCaps, isLoopbackBridgeUrl, isRespondResult, isServerFrame, parseBridgeConfigPayload, parseBridgeFrame };
