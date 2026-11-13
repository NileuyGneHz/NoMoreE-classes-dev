/**
 * dsh 0.2 Host adapter.
 *
 * Unary calls go directly through TypertGateway. Long-lived Session and
 * forwarded-event streams use the Gateway wire seam, while `$events/result`
 * goes through Connection because it is a Gateway-owned RPC endpoint rather
 * than a Typert Remote method.
 *
 * @module @yuxianglin/dsh-bridge-browser/src/remote-host-api
 */
import type { BrowserHostApi, HostRpcFailure } from './host-api.ts';
/** Structural subset of dsh 0.2.1's Host TypertGateway service. */
export interface TypertGatewayLike {
    readonly wireStream: {
        /**
         * dsh 0.2.1: `(endpoint, payload, uplink, peer, signal)`. The Peer is
         * required and never defaulted, so the bridge names the principal its
         * extension connection speaks for.
         */
        open(endpoint: string, payload: unknown, uplink: AsyncIterable<unknown>, peer: HostPeerLike, signal: AbortSignal): Promise<AsyncIterable<unknown>>;
        failure(error: unknown): HostRpcFailure;
    };
    invoke(request: {
        readonly namespace: string;
        readonly method: string;
        readonly args: Readonly<Record<string, unknown>>;
        /** Caller identity every dispatch names explicitly since dsh 0.2.1. */
        readonly peer: HostPeerLike;
        readonly signal?: AbortSignal;
    }): Promise<unknown>;
}
/**
 * Structural subset of dsh 0.2.1's PeerScope: the caller identity a Remote
 * call speaks for. Connection owns the instance; `signal` aborts when the
 * Peer is disposed, and streams that speak for it end with it.
 */
export interface HostPeerLike {
    readonly signal: AbortSignal;
    dispose(): Promise<void>;
}
/** Structural subset of dsh 0.2.1's Host Connection service. */
export interface HostConnectionLike {
    createSharedFetchHandler(channel: '/api'): {
        fetch(request: Request, peer: HostPeerLike): Promise<Response>;
    };
    /**
     * Independent in-process Peer, disposed with the Context that read the
     * service. The bridge authenticates the extension with its own token, then
     * speaks for the local operator who owns this Host.
     */
    createPeer(options: {
        readonly principal: {
            readonly kind: 'owner';
        };
        readonly interactions?: 'answer' | 'none';
    }): HostPeerLike;
}
/** Build the dsh 0.2 Host implementation. */
export declare function createRemoteHostApi(gateway: TypertGatewayLike, connection: HostConnectionLike): BrowserHostApi;
/** One selectable permission preset as the Host advertises it. */
export interface PermissionCatalogOption {
    readonly value: string;
    readonly name: string;
    readonly description?: string;
}
/** Process-level permission preset directory. */
export interface PermissionCatalog {
    readonly options: readonly PermissionCatalogOption[];
    readonly defaultOptions: readonly PermissionCatalogOption[];
    readonly defaultPreset: string;
}
/** Host command line that switches one Session's permission preset. */
export declare function permissionSwitchLine(preset: string): string;
/**
 * Host command syntax: byte 0 is `/`, then a lowercase name, then the end of
 * input or whitespace. Anything else is a prompt, never a command.
 * @param line - the exact composer line.
 * @returns true when the line claims the Host command grammar.
 */
export declare function isCommandLine(line: string): boolean;
//# sourceMappingURL=remote-host-api.d.ts.map