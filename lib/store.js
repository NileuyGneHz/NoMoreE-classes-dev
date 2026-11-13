// 台账：纯 JSONL，只追加，不改写（与 webclass-zhs-drive 的 trace 同规矩）
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function paths(root) {
  return {
    outline: join(root, 'outline.json'),
    ledger: join(root, 'results.jsonl'),
    answers: join(root, 'answers.json'),
  }
}

export function ensureDir(file) {
  mkdirSync(dirname(file), { recursive: true })
}

export function loadOutline(root) {
  const p = paths(root).outline
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8'))
}

export function readLedger(root) {
  const p = paths(root).ledger
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try { return JSON.parse(line) } catch { return null }
    })
    .filter(Boolean)
}

export function appendLedger(root, record) {
  const p = paths(root).ledger
  ensureDir(p)
  const line = JSON.stringify({ at: new Date().toISOString(), ...record })
  appendFileSync(p, line + '\n', 'utf8')
  return line
}

export function writeOutline(root, outline) {
  const p = paths(root).outline
  ensureDir(p)
  writeFileSync(p, JSON.stringify(outline, null, 2), 'utf8')
}

export function flatten(outline) {
  const out = []
  for (const mod of outline?.modules ?? []) {
    for (const unit of mod.units ?? []) {
      for (const point of unit.points ?? []) {
        out.push({ module: mod.name, unit: unit.name, point: typeof point === 'string' ? point : point.name })
      }
    }
  }
  return out
}
