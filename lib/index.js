/**
 * dsh-webclass-zhs — 智慧树「去提升」答题闭环 + 站点门禁 + 技能运行时注册。
 *
 * 三层分工：
 *   1. 门禁层：site_gate 调 C++ 行为树（bin/win32-x64/site_gate.exe）判定 URL 是否放行；
 *   2. 状态层：zhs_* 工具做大纲/下一节/提交前校验/台账，全部受 route.json 硬校验；
 *   3. 技能层：包内 skills/ 在运行时注册成 dsh 技能（webclass-zhs-answer）。
 *
 * 只用公开 seam：ctx.tools.register / ctx.skills.register / systemPrompt.section / ctx.inject。
 * @module dsh-webclass-zhs
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PACKAGE_ROOT } from './gate.js'
import { composeBridge } from './bridge.js'
import { assertRouted, DEFAULT_GATE_BIN, DEFAULT_GATE_DIR, loadGateFiles, runGateBinary, writeRoute } from './gate.js'
import { loadSkills, registerSkill } from './skills.js'
import { appendLedger, flatten, loadOutline, readLedger, writeOutline } from './store.js'

export const name = 'dsh-webclass-zhs'

/** 需要 harness 的 tools 服务；其余服务用 ctx.inject 条件挂载。 */
export const inject = ['tools']

export const DEFAULTS = {
  /** 工作目录：outline.json / results.jsonl / route.json 的落点。空串 = 进程 cwd。 */
  root: '',
  /** record 时是否校验题数与答案数一致。 */
  strict: true,
  /** 门禁站点的默认归属（zhs_* 工具只属于这个站点）。 */
  site: 'zhihuishu',
  /** 浏览器桥：auto=宿主已有就跳过，on=强制组合，off=不组合。 */
  bridge: 'auto',
  /** 用户去 chrome://extensions 加载的扩展目录；缺省用包内 vendor/browser-extension。 */
  extensionDir: '',
  /** 是否注册包内技能。 */
  skills: true,
  /** 技能目录；缺省用包内 skills/。 */
  skillsDir: '',
  gate: {
    enabled: true,
    binPath: '',
    gateDir: '',
    timeoutMs: 2000,
    routeTtlMinutes: 30,
  },
}

const text = (s) => [{ type: 'text', text: String(s ?? '') }]
const rootSchema = { type: 'string', description: '工作目录（缺省用插件配置 root 或进程 cwd）' }

/** 归一化配置（不做 schema 校验，保持与旧版 apply(ctx, rawConfig) 兼容）。 */
export function resolveConfig(raw = {}) {
  const gate = { ...DEFAULTS.gate, ...(raw.gate ?? {}) }
  return {
    root: raw.root ? String(raw.root) : process.cwd(),
    strict: raw.strict !== false,
    site: raw.site ? String(raw.site) : DEFAULTS.site,
    bridge: raw.bridge === 'off' ? 'off' : raw.bridge === 'on' ? 'on' : 'auto',
    extensionDir: raw.extensionDir ? String(raw.extensionDir) : join(PACKAGE_ROOT, 'vendor', 'browser-extension'),
    skills: raw.skills !== false,
    skillsDir: raw.skillsDir ? String(raw.skillsDir) : join(PACKAGE_ROOT, 'skills'),
    gate: {
      enabled: gate.enabled !== false,
      binPath: gate.binPath ? String(gate.binPath) : DEFAULT_GATE_BIN,
      gateDir: gate.gateDir ? String(gate.gateDir) : DEFAULT_GATE_DIR,
      timeoutMs: Number(gate.timeoutMs) > 0 ? Number(gate.timeoutMs) : 2000,
      routeTtlMinutes: Number(gate.routeTtlMinutes) > 0 ? Number(gate.routeTtlMinutes) : 30,
    },
  }
}

/** 给一个工具加 route 硬门禁；未放行时返回该工具形状的失败结果。 */
function withRouteGuard(config, toolName, tool, failure) {
  const original = tool.execute
  tool.execute = async (args, exec) => {
    const check = assertRouted({ root: config.root, site: config.site, tool: toolName })
    if (!check.ok) return failure(check.message)
    return original(args, exec)
  }
  return tool
}

export function nextSectionTool(config) {
  return {
    name: 'zhs_next_section',
    description:
      '读取 outline.json + results.jsonl，返回下一个尚未作答的小节（模块/单元/知识点）以及总进度。已经全部答完时返回 done=true。',
    parameters: {
      type: 'object',
      properties: {
        root: rootSchema,
        skip: { type: 'array', items: { type: 'string' }, description: '额外要跳过的小节名' },
      },
      required: [],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          done: { type: 'boolean' },
          point: { type: 'string' },
          module: { type: 'string' },
          unit: { type: 'string' },
          answered: { type: 'integer' },
          total: { type: 'integer' },
          message: { type: 'string' },
        },
        required: ['done', 'answered', 'total', 'message'],
      },
      render: (_a, v) => text(v.message),
    },
    async execute(args) {
      const root = args.root || config.root
      const outline = loadOutline(root)
      if (!outline) {
        return { done: false, answered: 0, total: 0, message: '缺少 outline.json（见 README：zhs_outline_set 写入）' }
      }
      const flat = flatten(outline)
      const done = new Set(readLedger(root).map((r) => r.point))
      for (const s of args.skip ?? []) done.add(s)
      const answered = flat.filter((s) => done.has(s.point)).length
      const next = flat.find((s) => !done.has(s.point))
      if (!next) {
        return { done: true, answered, total: flat.length, message: `全部完成：${answered}/${flat.length}` }
      }
      return {
        done: false,
        point: next.point,
        module: next.module,
        unit: next.unit,
        answered,
        total: flat.length,
        message: `下一节：${next.module} / ${next.unit} / ${next.point}（进度 ${answered}/${flat.length}）`,
      }
    },
  }
}

export function precheckTool(config) {
  return {
    name: 'zhs_precheck',
    description:
      '提交前校验：给定本卷题数与每题选中的选项序号，检查是否有漏答/多答/序号越界。返回 ok=false 时不要点「提交作业」。',
    parameters: {
      type: 'object',
      properties: {
        point: { type: 'string', description: '小节名' },
        questionCount: { type: 'integer', description: '卷面题数（以答题进度分母或答题卡题数为准）' },
        answered: {
          type: 'array',
          items: { type: ['array', 'null'], items: { type: 'integer' } },
          description: '每题选中的选项序号（1 起）；未答传 null。多选题传数组。',
        },
      },
      required: ['point', 'questionCount', 'answered'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          missing: { type: 'array', items: { type: 'integer' } },
          message: { type: 'string' },
        },
        required: ['ok', 'missing', 'message'],
      },
      render: (_a, v) => text(v.message),
    },
    async execute(args) {
      const missing = []
      for (let i = 0; i < args.questionCount; i += 1) {
        const a = args.answered?.[i]
        if (a === null || a === undefined || (Array.isArray(a) && a.length === 0)) missing.push(i + 1)
      }
      const extra = (args.answered?.length ?? 0) > args.questionCount
      const ok = missing.length === 0 && !extra
      const msg = ok
        ? `可以提交：${args.questionCount} 题均已作答（${args.point}）`
        : `暂缓提交：未作答 ${missing.length ? missing.join('、') : '无'}${extra ? '；答案数超过题数' : ''}`
      return { ok, missing, message: msg }
    },
  }
}

export function recordTool(config) {
  return {
    name: 'zhs_record_result',
    description: '把一节的结果追加进 results.jsonl（只追加）：每题回答、已答对、总题数、掌握度。',
    parameters: {
      type: 'object',
      properties: {
        root: rootSchema,
        point: { type: 'string' },
        answers: { type: 'array', items: {}, description: '逐题所选，如 [[2],[1,2,4],null]' },
        correct: { type: 'integer' },
        total: { type: 'integer' },
        mastery: { type: 'number', description: '平台掌握度百分比，如 97' },
        note: { type: 'string' },
      },
      required: ['point', 'correct', 'total'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          answered: { type: 'integer' },
          total: { type: 'integer' },
          message: { type: 'string' },
        },
        required: ['ok', 'answered', 'total', 'message'],
      },
      render: (_a, v) => text(v.message),
    },
    async execute(args) {
      const root = args.root || config.root
      if (config.strict && Number(args.correct) > Number(args.total)) {
        return { ok: false, answered: 0, total: 0, message: '已答对数不能大于总题数' }
      }
      appendLedger(root, {
        point: args.point,
        answers: args.answers ?? null,
        correct: args.correct,
        total: args.total,
        mastery: args.mastery ?? null,
        note: args.note ?? '',
      })
      const outline = loadOutline(root)
      const flat = outline ? flatten(outline) : []
      const answered = flat.length ? flat.filter((s) => s.point === args.point).length : 1
      const doneCount = new Set(readLedger(root).map((r) => r.point)).size
      return {
        ok: true,
        answered: doneCount,
        total: flat.length || doneCount,
        message: `已记录：${args.point} ${args.correct}/${args.total}${args.mastery != null ? `（掌握度 ${args.mastery}%）` : ''}；台账 ${doneCount}/${flat.length || '?'}`,
      }
    },
  }
}

export function outlineSetTool(config) {
  return {
    name: 'zhs_outline_set',
    description: '写入课程大纲 outline.json，用于 zhs_next_section 计算下一节。结构：{modules:[{name,units:[{name,points:[string]}]}]}',
    parameters: {
      type: 'object',
      properties: {
        root: rootSchema,
        outline: { type: 'object', description: '课程大纲' },
      },
      required: ['outline'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { points: { type: 'integer' }, message: { type: 'string' } },
        required: ['points', 'message'],
      },
      render: (_a, v) => text(v.message),
    },
    async execute(args) {
      const root = args.root || config.root
      writeOutline(root, args.outline)
      const flat = flatten(args.outline)
      return { points: flat.length, message: `大纲已写入：${flat.length} 个知识点` }
    },
  }
}

/** 站点门禁工具：任何网页任务的第一步。 */
export function siteGateTool(config, state) {
  return {
    name: 'site_gate',
    description:
      '网页任务的第一步：用当前页面 URL 识别站点并申请放行。只有 decision=allow 才能继续该站点的技能操作；decision=ask_user 表示站点/页面未登记，必须停下来问用户；decision=deny 表示明确拒绝。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '当前页面 URL（从 browser_snapshot 的页面信息里取）' },
        pageReady: { type: 'boolean', description: '页面是否已加载完成；缺省 true' },
      },
      required: ['url'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          decision: { type: 'string', enum: ['allow', 'ask_user', 'deny'] },
          site: { type: 'string' },
          skill: { type: 'string' },
          allowedTools: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
          reasons: { type: 'array', items: { type: 'string' } },
        },
        required: ['decision', 'site', 'skill', 'allowedTools', 'reason', 'reasons'],
      },
      render: (_a, v) => text(`${v.decision}${v.site ? ` · ${v.site}` : ''}${v.skill ? ` · ${v.skill}` : ''} — ${v.reason}`),
    },
    async execute(args) {
      const empty = { decision: 'ask_user', site: '', skill: '', allowedTools: [], reason: '', reasons: [] }
      if (!config.gate.enabled) {
        return { decision: 'allow', site: '', skill: '', allowedTools: [], reason: 'gate_disabled', reasons: ['gate disabled by config'] }
      }
      const files = loadGateFiles(config.gate.gateDir)
      if (files === undefined) {
        return { ...empty, reason: 'gate_files_missing', reasons: [`缺少 ${config.gate.gateDir}/sites.json 或 gate.tree.json`] }
      }
      const decision = await runGateBinary({
        binPath: config.gate.binPath,
        timeoutMs: config.gate.timeoutMs,
        payload: {
          url: String(args.url ?? ''),
          pageReady: args.pageReady !== false,
          skills: state.skills,
          skillsKnown: state.skillsKnown,
          sites: files.sites,
          tree: files.tree,
        },
      })
      if (decision.decision === 'allow') {
        writeRoute(config.root, decision, config.gate.routeTtlMinutes)
      }
      return {
        decision: ['allow', 'ask_user', 'deny'].includes(decision.decision) ? decision.decision : 'ask_user',
        site: String(decision.site ?? ''),
        skill: String(decision.skill ?? ''),
        allowedTools: Array.isArray(decision.allowedTools) ? decision.allowedTools : [],
        reason: String(decision.reason ?? ''),
        reasons: Array.isArray(decision.reasons) ? decision.reasons.map(String) : [],
      }
    },
  }
}

/** 告诉用户去哪里加载浏览器扩展（扩展必须人工加载）。 */
export function extensionPathTool(config) {
  return {
    name: 'zhs_extension_path',
    description: '返回包内浏览器扩展目录的绝对路径；用户需要在 chrome://extensions 里「加载已解压的扩展程序」选它。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' }, message: { type: 'string' } },
        required: ['path', 'message'],
      },
      render: (_a, v) => text(v.message),
    },
    async execute() {
      return {
        path: config.extensionDir,
        message: `扩展目录：${config.extensionDir}（chrome://extensions → 开发者模式 → 加载已解压的扩展程序）`,
      }
    },
  }
}

/** 诊断：装配结果一眼可见（技能是否注册、route 状态、门禁路径）。 */
export function statusTool(config, state) {
  return {
    name: 'zhs_status',
    description: '诊断本插件装配状态：技能注册情况、route.json 放行状态、门禁二进制与扩展目录。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      render: (_a, v) => text(v.message),
    },
    async execute() {
      const route = (() => {
        try {
          return JSON.parse(readFileSync(join(config.root, 'route.json'), 'utf8'))
        } catch {
          return null
        }
      })()
      let registry = '(skills service unavailable)'
      if (state.skillsService?.list !== undefined) {
        try {
          const list = await state.skillsService.list({})
          const mine = list.filter((s) => s.name.startsWith('webclass') || s.source === 'bundled' || s.provider === 'dsh-webclass-zhs')
          registry = mine.length === 0
            ? '(none)'
            : mine.map((s) => `${s.name} source=${s.source} provider=${s.provider} path=${s.path ?? ''} rb=${s.resourceBase?.kind === 'directory' ? s.resourceBase.path : ''}`).join(' | ')
        } catch (error) {
          registry = `list failed: ${String(error?.message ?? error)}`
        }
      }
      return {
        message: [
          `site=${config.site} root=${config.root}`,
          `gate.exepath=${config.gate.binPath}`,
          `gate.enabled=${config.gate.enabled}`,
          `skills.dir=${config.skillsDir}`,
          `skills.found=${state.skills.length}`,
          `skills.registered=${state.registered.join(',') || '(none)'}`,
          `skills.errors=${state.skillErrors.join(' | ') || '(none)'}`,
          `skills.registry=${registry}`,
          `bridge=${state.bridgeMode ?? 'pending'}`,
          `route=${route ? `${route.site}/${route.skill}@${route.at}` : '(none)'}`,
        ].join('\n'),
      }
    },
  }
}

export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  const state = { skills: [], skillsKnown: Boolean(ctx.get('skills')), registered: [], skillErrors: [], skillsService: ctx.get('skills') }

  if (config.skills) {
    const skills = loadSkills(config.skillsDir)
    state.skills = skills.map((s) => s.name)
    ctx.inject(['skills'], (skillCtx) => {
      state.skillsKnown = true
      state.skillsService = skillCtx.skills
      for (const skill of skills) {
        try {
          registerSkill(skillCtx, skill, { provider: 'dsh-webclass-zhs' })
          state.registered.push(skill.name)
        } catch (error) {
          state.skillErrors.push(`${skill.name}: ${String(error?.message ?? error)}`)
        }
      }
      skillCtx.logger?.info?.(`dsh-webclass-zhs: skills registered (${state.registered.length}/${skills.length})`)
    })
  }

  ctx.effect(() => ctx.tools.register(statusTool(config, state)), 'dsh-webclass-zhs: status')
  ctx.effect(() => ctx.tools.register(siteGateTool(config, state)), 'dsh-webclass-zhs: site gate')
  ctx.effect(() => ctx.tools.register(extensionPathTool(config)), 'dsh-webclass-zhs: extension path')
  ctx.effect(
    () => ctx.tools.register(withRouteGuard(config, 'zhs_outline_set', outlineSetTool(config), (m) => ({ points: 0, message: m }))),
    'dsh-webclass-zhs: outline',
  )
  ctx.effect(
    () => ctx.tools.register(withRouteGuard(config, 'zhs_next_section', nextSectionTool(config), (m) => ({ done: false, answered: 0, total: 0, message: m }))),
    'dsh-webclass-zhs: next',
  )
  ctx.effect(
    () => ctx.tools.register(withRouteGuard(config, 'zhs_precheck', precheckTool(config), (m) => ({ ok: false, missing: [], message: m }))),
    'dsh-webclass-zhs: precheck',
  )
  ctx.effect(
    () => ctx.tools.register(withRouteGuard(config, 'zhs_record_result', recordTool(config), (m) => ({ ok: false, answered: 0, total: 0, message: m }))),
    'dsh-webclass-zhs: record',
  )

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    ctx.effect(
      () => systemPrompt.section({
        name: 'tool:webclass-zhs-site-gate',
        order: 106,
        text: () => '站点门禁：任何网页任务开工前，先用当前页面 URL 调用 site_gate({url})。decision=allow 才能执行该站点的技能操作；decision=ask_user 表示该站点/页面未登记，必须停下来问用户，不得继续操作页面。zhs_* 工具在未放行时会直接拒绝执行。',
      }),
      'dsh-webclass-zhs: system prompt section',
    )
  }

  ctx.inject(['webServer', 'typertGateway', 'connection', 'agents'], (bridgeCtx) => {
    composeBridge(bridgeCtx, config)
      .then((result) => {
        state.bridgeMode = result.mode
        const logger = bridgeCtx.logger
        const line = `dsh-webclass-zhs: browser bridge ${result.mode}${result.error ? ` (${result.error})` : ''}`
        if (result.mode === 'failed') logger?.warn?.(line)
        else logger?.info?.(line)
      })
      .catch((error) => {
        bridgeCtx.logger?.warn?.(`dsh-webclass-zhs: browser bridge failed: ${String(error?.message ?? error)}`)
      })
  })
}
