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
import { defineTool } from '@deepseek-ai/dsh-tools';
const SUPPORTED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg']);
/**
 * Register `browser_screenshot` on `ctx.tools`.
 * @param ctx - Cordis context with the tools service; the optional
 *   `attachments` service stores the captured pixels.
 * @param bridge - the authenticated bridge server.
 * @param options - resolved tool budgets.
 * @returns a disposer for the caller's effect to own.
 */
export function registerScreenshotTool(ctx, bridge, options) {
    // exec → projected content for this execution, mirroring the MCP adapter's
    // projection handoff: execute() does the async storage, projectContent()
    // stays synchronous.
    const projections = new WeakMap();
    const requestScreenshot = (exec, args) => {
        const sessionId = exec.agent === undefined ? undefined : String(exec.agent.id);
        const call = sessionId === undefined
            ? bridge.requestTool('browser_screenshot', args, exec.signal, options.toolTimeoutMs)
            : bridge.requestTool('browser_screenshot', args, exec.signal, options.toolTimeoutMs, sessionId);
        return call;
    };
    const storeImage = async (image) => {
        const attachments = ctx.get('attachments');
        if (attachments === undefined) {
            throw new Error('No attachment store is mounted, so the screenshot cannot be returned as an image.');
        }
        const mediaType = image.mediaType;
        if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
            throw new Error(`The browser returned an unsupported screenshot media type: ${mediaType}`);
        }
        const data = Buffer.from(image.data, 'base64');
        const [ref] = await attachments.saveImages([{ data: new Uint8Array(data), mediaType }]);
        return ref;
    };
    const tool = defineTool({
        name: 'browser_screenshot',
        description: 'Capture the current viewport of the controlled tab as an image and return it for visual inspection. '
            + 'The image is attached as an image content block. Only the active tab of its window can be captured, '
            + 'and only http/https pages.',
        parameters: {
            format: {
                type: 'string',
                enum: ['png', 'jpeg'],
                description: 'Image format. png is lossless; jpeg is smaller. Defaults to png.',
            },
            quality: {
                type: 'number',
                description: 'JPEG quality, 1-100. Defaults to 85. Ignored for png.',
            },
        },
        timeoutMs: options.toolTimeoutMs,
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    text: { type: 'string', required: true },
                    image: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            attachmentId: { type: 'string', required: true },
                            mediaType: { type: 'string', required: true },
                            bytes: { type: 'number', required: true },
                            width: { type: 'number', required: true },
                            height: { type: 'number', required: true },
                        },
                    },
                },
            },
            render: (_args, value) => {
                const result = value;
                return [{ type: 'text', text: result.text }];
            },
        },
        execute: async (args, exec) => {
            const a = args;
            const wireArgs = (format, quality) => ({
                format,
                ...(format === 'jpeg' && quality !== undefined ? { quality } : {}),
            });
            const format = a.format ?? 'png';
            const result = await requestScreenshot(exec, wireArgs(format, a.quality));
            let ref;
            try {
                ref = await storeImage(result.image);
            }
            catch (error) {
                // A lossless png can exceed the per-image byte limit on large or
                // hidpi viewports; retry once as jpeg before giving up.
                if (format === 'png' && isAdmissionLimit(error)) {
                    const fallback = await requestScreenshot(exec, wireArgs('jpeg', 80));
                    ref = await storeImage(fallback.image);
                }
                else {
                    throw error;
                }
            }
            const summary = `Captured the controlled tab viewport (${ref.width}x${ref.height} ${ref.mediaType}, ${formatBytes(ref.bytes)}).`;
            const metadata = {
                attachmentId: ref.attachmentId,
                mediaType: ref.mediaType,
                bytes: ref.bytes,
                width: ref.width,
                height: ref.height,
            };
            projections.set(exec, [
                { type: 'image', attachment: ref },
                { type: 'text', text: summary },
            ]);
            return { text: summary, image: metadata };
        },
        projectContent: (exec) => projections.get(exec),
    });
    const dispose = ctx.tools.register(tool);
    return () => dispose();
}
/** Whether an image-admission refusal was a size limit the retry can address. */
function isAdmissionLimit(error) {
    return error instanceof Error && 'code' in error
        && error.code === 'IMAGE_TOO_LARGE';
}
function formatBytes(bytes) {
    return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}
//# sourceMappingURL=screenshot-tools.js.map