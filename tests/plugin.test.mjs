#!/usr/bin/env node
// 假宿主单测：不启动 DSH，验证插件装配与门禁硬校验。
//   node tests/plugin.test.mjs
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../lib/index.js'

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` :: ${detail}`}`)
  if (!ok) failed += 1
}

/** 极简 cordis ctx：只实现本插件用到的 seam。 */
function makeCtx(services = {}) {
  const tools = new Map()
  const registeredSkills = []
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    services,
    tools: {
      register(def) {
        tools.set(def.name, def)
        return () => {}
      },
      get: (name) => tools.get(name),
    },
    get: (name) => services[name],
    effect(fn) {
      return fn()
    },
    inject(deps, cb) {
      if (deps.every((dep) => services[dep] !== undefined)) cb(ctx)
      return () => {}
    },
  }
  if (services.skills !== undefined) {
    ctx.skills = {
      register(def) {
        registeredSkills.push(def)
        return () => {}
      },
    }
  }
  return { ctx, tools, registeredSkills }
}

const root = mkdtempSync(join(tmpdir(), 'zhs-gate-test-'))
const urlOk = 'https://studentexamcomh5.zhihuishu.com/studentReviewTestOrExam/1/1/2/abc/1'

// 1) 无技能服务：工具齐全、门禁按 skillsKnown=false 放行、route 落盘
{
  const { ctx, tools } = makeCtx()
  apply(ctx, { root })
  for (const name of ['site_gate', 'zhs_extension_path', 'zhs_outline_set', 'zhs_next_section', 'zhs_precheck', 'zhs_record_result']) {
    check(`tool registered: ${name}`, tools.has(name))
  }
  const gate = await tools.get('site_gate').execute({ url: urlOk })
  check('gate allows known site without skills service', gate.decision === 'allow' && gate.site === 'zhihuishu', JSON.stringify(gate))
  check('route.json written', existsSync(join(root, 'route.json')))
  const precheck = await tools.get('zhs_precheck').execute({ point: 'demo', questionCount: 2, answered: [[1], [2, 3]] })
  check('precheck ok with route', precheck.ok === true, JSON.stringify(precheck))
}

// 2) 无 route：zhs_* 必须拒绝
{
  const root2 = mkdtempSync(join(tmpdir(), 'zhs-gate-test-'))
  const { ctx, tools } = makeCtx()
  apply(ctx, { root: root2 })
  const precheck = await tools.get('zhs_precheck').execute({ point: 'demo', questionCount: 1, answered: [[1]] })
  check('precheck refused without route', precheck.ok === false && /site_gate/.test(precheck.message), JSON.stringify(precheck))
  const next = await tools.get('zhs_next_section').execute({})
  check('next_section refused without route', next.done === false && /site_gate/.test(next.message), JSON.stringify(next))
}

// 3) 未知站点：ask_user，且不写 route
{
  const root3 = mkdtempSync(join(tmpdir(), 'zhs-gate-test-'))
  const { ctx, tools } = makeCtx()
  apply(ctx, { root: root3 })
  const gate = await tools.get('site_gate').execute({ url: 'https://example.com/anything' })
  check('gate asks user for unknown site', gate.decision === 'ask_user', JSON.stringify(gate))
  check('no route for unknown site', !existsSync(join(root3, 'route.json')))
}

// 4) 有技能服务：技能注册 + 缺技能时门禁拒绝
{
  const { ctx, tools, registeredSkills } = makeCtx({ skills: {} })
  apply(ctx, { root })
  check('skill registered at runtime', registeredSkills.some((s) => s.name === 'webclass-zhs-answer' && s.source === 'bundled'))
  const skill = registeredSkills.find((s) => s.name === 'webclass-zhs-answer')
  check('skill content has frontmatter stripped', typeof skill?.content === 'string' && !skill.content.startsWith('---'))

  const { ctx: ctx2, tools: tools2 } = makeCtx({ skills: {} })
  apply(ctx2, { root, skillsDir: join(root, 'no-such-skills') })
  const gate = await tools2
    .get('site_gate')
    .execute({ url: urlOk })
  check('gate asks user when skill missing', gate.decision === 'ask_user' && gate.reason.startsWith('skill_missing'), JSON.stringify(gate))
}

// 5) 配置：bridge off 不组合、gate disabled 直接放行
{
  const { ctx, tools } = makeCtx()
  apply(ctx, { root, gate: { enabled: false } })
  const gate = await tools.get('site_gate').execute({ url: 'https://example.com/x' })
  check('gate disabled passes through', gate.decision === 'allow' && gate.reason === 'gate_disabled', JSON.stringify(gate))
}

console.log(failed === 0 ? 'ALL PASS' : `FAILED=${failed}`)
process.exit(failed === 0 ? 0 : 1)
