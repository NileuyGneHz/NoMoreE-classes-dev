#!/usr/bin/env node
// 把仓库 skills/ 里的技能同步进插件包（包内 skills/ 是发布副本）。
// 默认源：<repo>/skills，目标：<pkg>/skills。
//   node scripts/sync-skills.mjs            同步
//   node scripts/sync-skills.mjs --check    只校验（CI）
import { createHash } from 'node:crypto'
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSkill } from '../lib/skills.js'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SRC = resolve(PKG, '..', '..', 'skills')
const DEST = join(PKG, 'skills')

/** 只同步这些技能（其余技能依赖未随包提供的 library/，不发布）。 */
const SKILLS = ['webclass-zhs-answer']

function walk(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, base))
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'))
  }
  return out.sort()
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function manifest(root) {
  const result = {}
  for (const file of walk(root)) result[file] = sha256(join(root, file))
  return result
}

function checkSkill(skillDir, problems) {
  const skillFile = join(skillDir, 'SKILL.md')
  if (!existsSync(skillFile)) {
    problems.push(`missing ${skillFile}`)
    return
  }
  const parsed = parseSkill(readFileSync(skillFile, 'utf8'))
  if (parsed === undefined) {
    problems.push(`${skillFile}: invalid frontmatter`)
    return
  }
  if (parsed.name !== skillDir.split(sep).pop()) {
    problems.push(`${skillFile}: name '${parsed.name}' != directory name`)
  }
  const refDir = join(skillDir, 'references')
  if (existsSync(refDir)) {
    for (const file of readdirSync(refDir)) {
      if (!parsed.content.includes(`references/${file}`)) {
        problems.push(`${skillDir}: references/${file} not named in SKILL.md §6`)
      }
    }
  }
}

const checkOnly = process.argv.includes('--check')
const problems = []

for (const skill of SKILLS) {
  const src = join(DEFAULT_SRC, skill)
  if (!existsSync(join(src, 'SKILL.md'))) {
    problems.push(`source skill missing: ${src}`)
    continue
  }
  checkSkill(src, problems)
  if (checkOnly) {
    const dest = join(DEST, skill)
    if (!existsSync(dest)) {
      problems.push(`package copy missing: ${dest}`)
      continue
    }
    const a = manifest(src)
    const b = manifest(dest)
    for (const file of Object.keys(a)) {
      if (a[file] !== b[file]) problems.push(`drift: ${skill}/${file}`)
    }
    for (const file of Object.keys(b)) {
      if (a[file] === undefined) problems.push(`extra: ${skill}/${file}`)
    }
  } else {
    const dest = join(DEST, skill)
    rmSync(dest, { recursive: true, force: true })
    cpSync(src, dest, { recursive: true })
    console.log(`synced ${skill} -> ${relative(PKG, dest)}`)
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`ERROR ${p}`)
  process.exit(1)
}
console.log(checkOnly ? 'skills check OK' : 'skills sync OK')
