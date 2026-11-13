/**
 * Fixed-port discovery beacon: a loopback HTTP endpoint that tells the browser
 * extension where this dsh instance listens.
 *
 * DSH Desktop launches its host with `--port 0`, so every launch lands on a
 * different OS-assigned port and no fixed list of real ports can find it. The
 * beacon binds the first free port of {@link BEACON_PORTS} and answers
 * {@link BRIDGE_CONFIG_PATH} with the real bridge URL, so discovery becomes a
 * handful of bounded probes instead of an ephemeral-range scan. Ports are tried
 * in order, so a machine running several dsh instances keeps them all
 * discoverable.
 *
 * Hardening: binds loopback only, sends no CORS headers (a web page cannot read
 * the answer), rejects a foreign `Host` header (DNS rebinding), and carries
 * nothing secret — the bridge WebSocket still authenticates every client.
 *
 * @module @yuxianglin/dsh-bridge-browser/src/discovery-beacon
 */
import { type BridgeInstanceInfo } from './protocol.ts';
/** Options for {@link startDiscoveryBeacon}. */
export interface DiscoveryBeaconOptions {
    /** Real port the host webserver bound; a getter keeps late binding safe. */
    hostPort: number | (() => number | undefined);
    /** Candidate ports, tried in order until one binds. */
    ports: readonly number[];
    /** Instance metadata carried in every answer. */
    info?: BridgeInstanceInfo;
    /** Diagnostics sink; silent by default so embedding stays quiet. */
    warn?: (message: string) => void;
}
/** A bound beacon. */
export interface DiscoveryBeacon {
    /** Loopback port the beacon actually bound. */
    port: number;
    /** Stop listening and release the port. */
    close(): Promise<void>;
}
/**
 * Validate and deduplicate candidate beacon ports, preserving order.
 * @param ports - candidate ports from configuration.
 * @returns the usable ports; invalid entries are dropped.
 */
export declare function sanitizeBeaconPorts(ports: readonly number[]): number[];
/**
 * Whether a configured bind address names this machine's loopback interface.
 * Non-loopback binds (a remote deployment) get no beacon: their clients cannot
 * use a `127.0.0.1` answer anyway.
 * @param host - bind address from the host webserver configuration.
 * @returns true for `127/8`, `::1`, and their IPv4-mapped forms.
 */
export declare function isLoopbackBindAddress(host: unknown): boolean;
/**
 * Whether a request's `Host` header names this beacon. A page that resolves its
 * own hostname to 127.0.0.1 (DNS rebinding) sends its own name here and is
 * rejected; the browser's loopback probes always send the address.
 * @param header - raw `Host` header.
 * @param port - port the beacon bound.
 */
export declare function isBeaconHost(header: string | undefined, port: number): boolean;
/**
 * Bind the first free discovery port and serve the config answer.
 *
 * Never throws: a host that cannot bind any candidate keeps running without a
 * beacon, and the extension still finds it by scanning.
 * @param options - ports, host port source, instance metadata, diagnostics sink.
 * @returns the bound beacon, or `undefined` when every candidate is taken.
 */
export declare function startDiscoveryBeacon(options: DiscoveryBeaconOptions): Promise<DiscoveryBeacon | undefined>;
//# sourceMappingURL=discovery-beacon.d.ts.map