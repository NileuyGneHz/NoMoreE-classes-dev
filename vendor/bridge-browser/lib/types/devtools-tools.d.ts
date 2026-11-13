/**
 * Model-facing developer-tools (CDP) browser tools.
 *
 * This group is HIGH PRIVILEGE and is registered only while the connected
 * extension advertises the `devTools` capability (Chrome builds). Every call
 * still passes the extension's own approval policy: each action asks the user
 * in the side panel unless they turned on the developer-tools allowance for
 * their browser.
 *
 * The surface mirrors Chrome DevTools: element inspection plus live CSS/attribute
 * edits, page-context JavaScript execution plus recorded console output, and
 * captured network traffic. Results are single `{ text }` payloads whose
 * page-derived parts are explicitly untrusted.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools';
/** Options resolved from plugin config before tool registration. */
export interface BrowserDevToolsOptions {
    /** Per-tool-call budget in ms. */
    toolTimeoutMs: number;
    /** Cap on the model-visible text one devtools result may carry. */
    devToolsMaxChars: number;
}
/** Canonical tool result: one text payload. */
interface TextResult {
    text: string;
}
/** Call signature shared with `registerBrowserTools`. */
type Call = (exec: Pick<ToolRunContext, 'agent' | 'signal'>, name: string, args: Record<string, unknown>) => Promise<TextResult>;
/**
 * Register the developer-tools group on `ctx.tools`.
 * @param ctx - Cordis context with the tools service.
 * @param call - the shared bridge dispatcher.
 * @param options - resolved budgets.
 * @returns disposers keyed by tool name.
 */
export declare function registerBrowserDevTools(ctx: Context, call: Call, options: BrowserDevToolsOptions): Map<string, () => void>;
/**
 * The developer-tools model contracts, in the stable `DEVTOOLS_TOOL_NAMES`
 * order. Exported so the tool group's shape is testable without a Cordis
 * context.
 * @param call - the shared bridge dispatcher.
 * @param options - resolved budgets.
 * @returns the tool definitions.
 */
export declare function defineDevTools(call: Call, options: BrowserDevToolsOptions): ToolDefinition[];
/** The registered names, in the order this module defines them. */
export declare function devToolsToolNames(): readonly string[];
export {};
//# sourceMappingURL=devtools-tools.d.ts.map