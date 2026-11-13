// 浏览器桥组合：包里带一份 @yuxianglin/dsh-bridge-browser 的构建产物，
// 宿主没装上游插件时由本插件代挂（单包即可拿到 browser_* 工具）。
// 已装上游插件时自动跳过，避免重复注册同名工具。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { PACKAGE_ROOT } from './gate.js'

/** 包内 vendored 桥的入口。 */
export const BRIDGE_ENTRY = join(PACKAGE_ROOT, 'vendor', 'bridge-browser', 'lib', 'index.js')

/** 宿主是否已经注册了浏览器工具（用 browser_snapshot 探测）。 */
export function hasBrowserTools(tools) {
  try {
    return Boolean(tools?.get?.('browser_snapshot'))
  } catch {
    return false
  }
}

/**
 * 按配置组合桥。
 * @returns {Promise<{mode:'off'|'skipped'|'missing'|'composed'|'failed', error?:string}>}
 */
export async function composeBridge(ctx, config) {
  if (config.bridge === 'off') return { mode: 'off' }
  if (hasBrowserTools(ctx.tools)) return { mode: 'skipped' }
  if (!existsSync(BRIDGE_ENTRY)) return { mode: 'missing' }
  try {
    const mod = await import(pathToFileURL(BRIDGE_ENTRY).href)
    await mod.apply(ctx, {
      toolTimeoutMs: 90_000,
      snapshotMaxChars: 32_000,
      maxInteractiveItems: 60,
    })
    return { mode: 'composed' }
  } catch (error) {
    return { mode: 'failed', error: String(error?.message ?? error) }
  }
}
