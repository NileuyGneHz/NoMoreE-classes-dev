// 站点门禁：调用 C++ 行为树进程做决策，并把放行结果落成 route.json。
// JS 侧只做「spawn + 读结果 + 写 route」；匹配规则只在 gate/sites.json 与 gate/gate.tree.json 里。
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 包根目录（lib/ 的上一级）。 */
export const PACKAGE_ROOT = resolve(HERE, '..')

/** 门禁资源目录。 */
export const DEFAULT_GATE_DIR = join(PACKAGE_ROOT, 'gate')

/** 预编译门禁进程（当前只发布 win32-x64）。 */
export const DEFAULT_GATE_BIN = join(PACKAGE_ROOT, 'bin', 'win32-x64', 'site_gate.exe')

/** 读取 sites.json 与 tree.json；失败返回 undefined。 */
export function loadGateFiles(gateDir = DEFAULT_GATE_DIR) {
  try {
    const sites = JSON.parse(readFileSync(join(gateDir, 'sites.json'), 'utf8'))
    const tree = JSON.parse(readFileSync(join(gateDir, 'gate.tree.json'), 'utf8'))
    return { sites, tree }
  } catch {
    return undefined
  }
}

/** 一行 JSON 调门禁进程；任何异常都收敛成 ask_user（fail-closed）。 */
export function runGateBinary({ binPath, payload, timeoutMs = 2000 }) {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn(binPath, ['--json'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      resolvePromise({ decision: 'ask_user', reason: 'gate_spawn_failed', reasons: [String(error?.message ?? error)] })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      try { child.kill() } catch { /* already gone */ }
      resolvePromise(value)
    }
    timer = setTimeout(
      () => finish({ decision: 'ask_user', reason: 'gate_timeout', reasons: [`gate timeout after ${timeoutMs}ms`] }),
      timeoutMs,
    )
    child.on('error', (error) => {
      finish({ decision: 'ask_user', reason: 'gate_spawn_failed', reasons: [String(error?.message ?? error)] })
    })
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', () => {
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? ''
      if (!line) {
        finish({ decision: 'ask_user', reason: 'gate_no_output', reasons: [stderr.trim() || 'gate produced no output'] })
        return
      }
      try {
        finish({ ...JSON.parse(line), stderr: stderr.trim() || undefined })
      } catch {
        finish({ decision: 'ask_user', reason: 'gate_bad_json', reasons: [line.slice(0, 200)] })
      }
    })
    try {
      child.stdin.write(JSON.stringify(payload))
      child.stdin.end()
    } catch {
      finish({ decision: 'ask_user', reason: 'gate_stdin_failed', reasons: [] })
    }
  })
}

/** route.json 落点。 */
export function routeFilePath(root) {
  return join(root, 'route.json')
}

/** 把放行结果落盘（只影响后续工具校验，不参与门禁决策）。 */
export function writeRoute(root, decision, ttlMinutes = 30) {
  const file = routeFilePath(root)
  mkdirSync(dirname(file), { recursive: true })
  const record = {
    site: decision.site ?? '',
    skill: decision.skill ?? '',
    tools: Array.isArray(decision.allowedTools) ? decision.allowedTools : [],
    at: new Date().toISOString(),
    ttlMinutes,
  }
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

/** 读取当前放行记录；无或损坏返回 null。 */
export function readRoute(root) {
  try {
    return JSON.parse(readFileSync(routeFilePath(root), 'utf8'))
  } catch {
    return null
  }
}

/** zhs_* 工具的统一硬门禁：未放行 / 站点不符 / 过期 / 工具不在白名单 → 拒绝。 */
export function assertRouted({ root, site, tool }) {
  const route = readRoute(root)
  if (route === null || typeof route !== 'object') {
    return { ok: false, reason: 'no_route', message: '未通过 site_gate：先调用 site_gate({url}) 取得放行' }
  }
  if (site && route.site !== site) {
    return { ok: false, reason: 'site_mismatch', message: `门禁放行的是 ${String(route.site)}，本工具属于 ${site}` }
  }
  const at = Date.parse(String(route.at ?? ''))
  const ttlMinutes = Number(route.ttlMinutes ?? 30)
  if (!Number.isFinite(at) || !(ttlMinutes > 0) || Date.now() - at > ttlMinutes * 60_000) {
    return { ok: false, reason: 'route_expired', message: '放行已过期：重新调用 site_gate({url})' }
  }
  if (tool && Array.isArray(route.tools) && route.tools.length > 0 && !route.tools.includes(tool)) {
    return { ok: false, reason: 'tool_not_allowed', message: `${tool} 不在该站点放行白名单里` }
  }
  return { ok: true, route }
}
