/**
 * The screenshot tool: captures the controlled tab's viewport through the
 * extension and returns the image as a durable attachment block.
 *
 * The wire result carries base64 pixels; this side stores them exactly once
 * in the attachment store and hands the model an image ContentBlock plus a
 * short text summary. The persisted tool value keeps metadata only — no
 * base64 — so sessions stay small. Whether the active model can consume the
 * image is the runtime's projection concern (text-only routes receive a
 * placeholder), and programmatic callers keep the attachment reference.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis';
import type { BridgeServer } from './server.ts';
/** Options shared with the text browser tools. */
export interface ScreenshotToolOptions {
    toolTimeoutMs: number;
}
/**
 * Register `browser_screenshot` on `ctx.tools`.
 * @param ctx - Cordis context with the tools service; the optional
 *   `attachments` service stores the captured pixels.
 * @param bridge - the authenticated bridge server.
 * @param options - resolved tool budgets.
 * @returns a disposer for the caller's effect to own.
 */
export declare function registerScreenshotTool(ctx: Context, bridge: BridgeServer, options: ScreenshotToolOptions): () => void;
//# sourceMappingURL=screenshot-tools.d.ts.map