#!/usr/bin/env node
// 把上游浏览器桥与扩展的构建产物钉进 vendor/，并记录每个文件的 sha256。
//   node scripts/vendor-pin.mjs          重新钉（覆盖 vendor/）
//   node scripts/vendor-pin.mjs --check  校验 vendor/ 与记录一致（CI）
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = join(PKG, 'vendor')
const MANIFEST = join(VENDOR, 'VENDORED.json')

/** 上游来源与要复制的部分。 */
const ENTRIES = [
  {
    target: 'bridge-browser',
    name: '@yuxianglin/dsh-bridge-browser',
    version: '0.0.7',
    license: 'MIT',
    copyright: 'Copyright (c) Yuxiang Lin',
    source: 'F:/dsh_plugins/dsh-browser/packages/browser/bridge-browser',
    include: ['lib', 'locale', 'cordis.patch.yml', 'package.json', 'icon.svg', 'README.md'],
  },
  {
    target: 'browser-extension',
    name: 'dsh-browser-extension',
    version: '0.1.4',
    license: 'MIT',
    copyright: 'Copyright (c) Yuxiang Lin',
    source: 'F:/dsh-home/browser-extension',
    include: ['.'],
  },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function collectFiles(root) {
  return walk(root)
    .map((file) => ({ path: relative(root, file).split(sep).join('/'), sha256: sha256(file), size: readFileSync(file).length }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function pinEntry(entry) {
  const dest = join(VENDOR, entry.target)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  for (const item of entry.include) {
    const from = join(entry.source, item)
    if (!existsSync(from)) {
      throw new Error(`missing upstream path: ${from}`)
    }
    const to = item === '.' ? dest : join(dest, item)
    cpSync(from, to, { recursive: true })
  }
  return {
    name: entry.name,
    version: entry.version,
    license: entry.license,
    copyright: entry.copyright,
    source: entry.source,
    target: `vendor/${entry.target}`,
    files: collectFiles(dest),
  }
}

function checkEntry(entry) {
  const dest = join(PKG, entry.target)
  const problems = []
  if (!existsSync(dest)) {
    problems.push(`missing vendor dir: ${dest}`)
    return problems
  }
  const current = collectFiles(dest)
  const recorded = new Map(entry.files.map((f) => [f.path, f.sha256]))
  for (const file of current) {
    if (recorded.get(file.path) !== file.sha256) problems.push(`drift: ${entry.target}/${file.path}`)
    recorded.delete(file.path)
  }
  for (const leftover of recorded.keys()) problems.push(`removed: ${entry.target}/${leftover}`)
  return problems
}

const checkOnly = process.argv.includes('--check')
const problems = []

if (checkOnly) {
  if (!existsSync(MANIFEST)) {
    console.error('ERROR vendor/VENDORED.json missing; run sync first')
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  for (const entry of manifest.entries) problems.push(...checkEntry(entry))
  if (problems.length > 0) {
    for (const p of problems) console.error(`ERROR ${p}`)
    process.exit(1)
  }
  console.log('vendor check OK')
  process.exit(0)
}

rmSync(VENDOR, { recursive: true, force: true })
mkdirSync(VENDOR, { recursive: true })
const pinned = ENTRIES.map((entry) => pinEntry(entry))
writeFileSync(
  MANIFEST,
  `${JSON.stringify({ schemaVersion: 1, pinnedAt: new Date().toISOString(), entries: pinned }, null, 2)}\n`,
  'utf8',
)
for (const entry of pinned) console.log(`pinned ${entry.name}@${entry.version} (${entry.files.length} files)`)
