// 技能注册：把包内 skills/<name>/SKILL.md 注册成运行时技能。
// 这样技能随插件走，不需要用户手工拷到 ~/.agents/skills。
import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'

/** 解析 SKILL.md 的 frontmatter；返回 { name, description, content } 或 undefined。 */
export function parseSkill(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) return undefined
  const fields = {}
  for (const line of match[1].split('\n')) {
    const field = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line.replace(/\r+$/, ''))
    if (!field) continue
    let value = field[2].trim()
    if (value.length >= 2
      && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    fields[field[1]] = value
  }
  if (typeof fields.name !== 'string' || fields.name.length === 0) return undefined
  if (typeof fields.description !== 'string' || fields.description.length === 0) return undefined
  return { name: fields.name, description: fields.description, content: match[2].trim() }
}

/** 读取 skillsDir 下的全部技能；frontmatter 非法或名字与目录不符的跳过。 */
export function loadSkills(skillsDir) {
  const skills = []
  let entries = []
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
  } catch {
    return skills
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(skillsDir, entry.name)
    try {
      const parsed = parseSkill(readFileSync(join(dir, 'SKILL.md'), 'utf8'))
      if (parsed === undefined || parsed.name !== entry.name) continue
      skills.push({ ...parsed, dir })
    } catch {
      // 读不了就跳过；verify 脚本会报出来
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/** 把技能注册进调用方的 skills 服务（需在 ctx.inject(['skills']) 内调用）。 */
export function registerSkill(skillCtx, skill, { source = 'bundled', provider = 'dsh-webclass-zhs' } = {}) {
  return skillCtx.effect(
    () => skillCtx.skills.register({
      name: skill.name,
      description: skill.description,
      content: skill.content,
      source,
      provider,
      invocation: { modelInvocable: true, userInvocable: true },
      resourceBase: { kind: 'directory', path: skill.dir.split(sep).join('/') },
    }),
    `dsh-webclass-zhs: skill ${skill.name}`,
  )
}
