#!/usr/bin/env node
// 发布前总门禁：包形状 + 门禁二进制 + 技能 + vendor + 文档。
//   node scripts/verify.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSkill } from '../lib/skills.js'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const notes = []

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    problems.push(`cannot parse ${file}: ${error.message}`)
    return undefined
  }
}

function runNode(script, args) {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out }
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

function runGate(args) {
  try {
    const out = execFileSync(join(PKG, 'bin', 'win32-x64', 'site_gate.exe'), args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out }
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

// 1) package.json
const pkg = readJson(join(PKG, 'package.json'))
if (pkg !== undefined) {
  if (pkg.private === true) problems.push('package.json: private must be removed before publishing')
  if (pkg.name !== 'dsh-webclass-zhs') problems.push(`package.json: unexpected name ${pkg.name}`)
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) problems.push('package.json: version must be semver')
  if (pkg.engines?.dsh !== '^0.2.1-rc.5') problems.push('package.json: engines.dsh must pin ^0.2.1-rc.5')
  if (pkg.dsh?.manifestVersion !== 1) problems.push('package.json: dsh.manifestVersion must be 1')
  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') problems.push('package.json: dsh.bundle.patch must point at ./cordis.patch.yml')
  for (const entry of ['lib', 'gate', 'skills', 'vendor', 'bin', 'scripts', 'cordis.patch.yml', 'README.md', 'NOTICE', 'LICENSE']) {
    if (!Array.isArray(pkg.files) || !pkg.files.includes(entry)) problems.push(`package.json: files missing '${entry}'`)
  }
}

// 2) cordis patch
try {
  const patch = readFileSync(join(PKG, 'cordis.patch.yml'), 'utf8')
  if (!patch.includes('dsh-webclass-zhs')) problems.push('cordis.patch.yml: missing dsh-webclass-zhs row')
} catch {
  problems.push('cordis.patch.yml: missing')
}

// 3) gate binary
const gateBin = join(PKG, 'bin', 'win32-x64', 'site_gate.exe')
if (!existsSync(gateBin)) {
  problems.push(`gate binary missing: ${gateBin}`)
} else {
  const validate = runGate(['--validate', '--sites', join(PKG, 'gate', 'sites.json'), '--tree', join(PKG, 'gate', 'gate.tree.json')])
  if (!validate.ok || !validate.out.includes('"ok":true')) problems.push(`gate --validate failed: ${validate.out.trim()}`)
  const cases = runGate(['--cases', join(PKG, 'gate', 'tests', 'cases.json'), '--sites', join(PKG, 'gate', 'sites.json'), '--tree', join(PKG, 'gate', 'gate.tree.json')])
  if (!cases.ok || !cases.out.includes('ALL PASS')) problems.push(`gate --cases failed: ${cases.out.trim()}`)
  else notes.push(`gate cases: ${(cases.out.match(/^PASS /gm) ?? []).length} passed`)
}

// 4) skills
const skillsDir = join(PKG, 'skills')
if (!existsSync(skillsDir)) {
  problems.push('skills/ missing')
} else {
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(skillsDir, entry.name)
    const parsed = parseSkill(readFileSync(join(dir, 'SKILL.md'), 'utf8'))
    if (parsed === undefined) {
      problems.push(`skills/${entry.name}: invalid SKILL.md`)
      continue
    }
    if (parsed.name !== entry.name) problems.push(`skills/${entry.name}: name mismatch (${parsed.name})`)
    const refDir = join(dir, 'references')
    if (existsSync(refDir)) {
      for (const file of readdirSync(refDir)) {
        if (!parsed.content.includes(`references/${file}`)) problems.push(`skills/${entry.name}: references/${file} not named`)
      }
    }
  }
}

// 5) README 引用置顶 + 标题必须英文
try {
  const readme = readFileSync(join(PKG, 'README.md'), 'utf8')
  const lines = readme.split('\n')
  const headingIndex = lines.findIndex((line) => /^##\s/.test(line))
  const head = lines.slice(0, headingIndex < 0 ? 12 : headingIndex + 1).join('\n')
  if (!/引用|Attribution/.test(head)) problems.push('README.md: attribution section must be the first section after the title')
  if (!/@yuxianglin\/dsh-bridge-browser/.test(readme)) problems.push('README.md: missing bridge attribution')
  if (!/MIT/.test(readme)) problems.push('README.md: missing MIT mention')
  for (const line of lines) {
    if (/^#{2,3}\s/.test(line) && /[\u4e00-\u9fa5]/.test(line)) {
      problems.push(`README.md: section headings must be English: ${line.trim()}`)
    }
  }
} catch {
  problems.push('README.md: missing')
}

// 6) LICENSE/NOTICE
try {
  if (!/MIT License/.test(readFileSync(join(PKG, 'LICENSE'), 'utf8'))) problems.push('LICENSE: expected MIT text')
} catch {
  problems.push('LICENSE: missing')
}
try {
  const notice = readFileSync(join(PKG, 'NOTICE'), 'utf8')
  for (const needle of ['@yuxianglin/dsh-bridge-browser', 'MIT License', 'Yuxiang Lin', 'VermiIIi0n']) {
    if (!notice.includes(needle)) problems.push(`NOTICE: missing '${needle}'`)
  }
} catch {
  problems.push('NOTICE: missing')
}

// 7) vendor manifest
const vendorCheck = runNode(join(PKG, 'scripts', 'vendor-pin.mjs'), ['--check'])
if (!vendorCheck.ok) problems.push(`vendor check failed: ${vendorCheck.out.trim()}`)
else notes.push('vendor manifest OK')

// 8) skills drift
const skillsCheck = runNode(join(PKG, 'scripts', 'sync-skills.mjs'), ['--check'])
if (!skillsCheck.ok) problems.push(`skills check failed: ${skillsCheck.out.trim()}`)
else notes.push('skills drift OK')

// 9) 绝对路径扫描（只能出现在文档示例与 licenses 之外）
for (const sub of ['lib', 'gate', 'skills']) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const text = readFileSync(full, 'utf8')
        if (/[A-Z]:[\\/](WebClass-dev|Users[\\/]saber)/.test(text)) problems.push(`absolute path in ${full.split(sep).slice(-3).join('/')}`)
      }
    }
  }
  if (existsSync(join(PKG, sub))) walk(join(PKG, sub))
}

for (const note of notes) console.log(`OK ${note}`)
if (problems.length > 0) {
  for (const p of problems) console.error(`ERROR ${p}`)
  process.exit(1)
}
console.log(`verify OK (${pkg?.name}@${pkg?.version})`)
