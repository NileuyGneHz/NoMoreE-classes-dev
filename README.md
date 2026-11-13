# dsh-webclass-zhs

## Attribution

> **本包基于以下上游项目构建与再分发，使用前请阅读其许可证：**

| 上游 | 版本 | 许可证 | 版权 | 本包如何使用 |
|---|---|---|---|---|
| [`@yuxianglin/dsh-bridge-browser`](https://github.com/Lum1104/dsh-browser) | 0.0.7 | MIT | Copyright (c) Yuxiang Lin | 浏览器桥 **构建产物原样再分发** 于 `vendor/bridge-browser/`，由本插件在宿主未安装上游插件时代为挂载 |
| dsh-browser-extension（Chrome MV3） | 0.1.4 | MIT | Copyright (c) Yuxiang Lin | 扩展 **构建产物原样再分发** 于 `vendor/browser-extension/`，仍需用户在 `chrome://extensions` 手工加载 |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) | 0.2.1-rc.5 | — | © DeepSeek | 插件宿主；本包只调用公开 seam（tools / skills / systemPrompt） |
| [fuckZHS](https://github.com/VermiIIi0n/fuckZHS) | master | MIT | Copyright (c) VermiIIi0n | **仅参考**智慧树页面结构与术语，未再分发其代码 |
| 扩展构建内含：marked / DOMPurify / tldts / react | 上游版本 | MIT / MPL-2.0 OR Apache-2.0 | 各自作者 | 由上游扩展打包，见 `NOTICE` 与上游仓库 |

- **非官方项目**：与智慧树 / 知到平台无隶属关系；使用须遵守平台服务条款与所在学校的规定。
- 第三方许可证全文见 `NOTICE`；上游代码的修改权与再分发条件以各自 LICENSE 为准。
- **开源免费**：本插件不收费；引用 / 转载 / 再分发请保留本节的 attribution 与原作者署名。

---

## Motivation

把「网页任务先认站点、再进技能」做成**插件级门禁**：

```
用户请求 → site_gate({url}) → C++ 行为树决策 ─┬─ allow   → 进入该站点技能（如 webclass-zhs-answer）
                                              ├─ ask_user → 停下来问用户（站点未登记 / 页面未就绪 / 技能缺失）
                                              └─ deny    → 明确拒绝
```

- 门禁是 **fail-closed**：exe 缺失、超时、崩溃、输出不合法，一律降级为 `ask_user`，不会放行。
- `zhs_*` 工具受 `route.json` **硬校验**：未放行直接拒绝；`browser_*` 由 system-prompt 纪律约束（见 “Boundary”）。

## Installation

```powershell
# 1) 装插件（从 npm；内网可换 registry）
dsh plugin --profile desktop add dsh-webclass-zhs

# 2) 加载浏览器扩展：让 agent 调 zhs_extension_path，或手动打开该目录
#    chrome://extensions → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 vendor/browser-extension

# 3) 重启 DSH，自检：
#    - 工具列表出现 site_gate / zhs_* / browser_*
#    - 技能目录出现 webclass-zhs-answer
```

本机（本仓库）验证时也可以直接装目录：

```powershell
dsh plugin --profile desktop add F:\WebClass-dev\plugins\dsh-webclass-zhs
```

## Quick Start (First Run)

> 前提：dsh 已装、插件已装、电脑上有 Chrome（或 Edge，见 “Browser Support”）。

1. **拿到扩展目录**：在 dsh 里说「调用 zhs_extension_path，把扩展目录告诉我」。
   也可以自己去这个位置找：
   `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-webclass-zhs\vendor\browser-extension`。
2. **加载扩展**：Chrome 地址栏输 `chrome://extensions` → 右上角打开「开发者模式」→
   左上「加载已解压的扩展程序」→ 选第 1 步的目录 → 出现「dsh 浏览器助手」。
   （建议点工具栏拼图图标，把它固定到工具栏。）
3. **打开网课页面并登录**，只留这一个该平台的标签页；不要同时开多个同平台页面。
4. **点工具栏的扩展图标** → 右侧弹出「dsh 浏览器助手」侧栏：
   - 正常情况下自动连上本机 dsh；
   - 显示「后台连接已断开」→ 侧栏「设置」→「自动检测」；
   - 问「助手跟随当前页面 / 使用当前页面」→ 选 **使用当前页面**。
5. **回 dsh 主窗口说任务**（可直接抄）：

   > 我打开了智慧树网课页面（把网址粘在这里），帮我做这个知识点的「去提升」练习：
   > 答完并提交；掌握度低于 90 就重做；跑完把台账和判题结果发我。

之后 agent 会先过 `site_gate`：

- 停下来问「这个站点没登记」→ 网址不在 `gate/sites.json`，把平台名/网址发它，或按 “Adding a Site” 加一条；
- 问「是否提交」→ 你确认后它才会点「提交作业」；
- 说「浏览器操作已暂停」→ 通常是切了标签页或关掉了受控页，回到那个页面再让它继续。

## Browser Support

| 浏览器 | 能否用 | 说明 |
|---|---|---|
| Chrome | ✅ | 本包内置的就是 Chrome 构建 |
| Edge / 其他 Chromium（Brave、Vivaldi 等） | ✅ | 同为 Chromium 内核，可直接加载 Chrome 构建 |
| Firefox | ⚠️ 需自建 | 上游有 `build:firefox` 构建，但**本包不带 Firefox 版**；新手不建议折腾 |
| Safari | ❌ | 不支持 |

## C++ Gate (Minimal Behavior Tree)

- 引擎：`gate/src/{json.h,bt.h,bt.cpp,gate.cpp}`，自带最小 JSON 与 **Sequence / Selector / Cond / Act** 四类节点；
  不依赖 BehaviorTree.CPP，单 tick 同步、无线程，兼容 `MinGW Thread model: win32`。
- 预编译：`bin/win32-x64/site_gate.exe`；其他平台用 `scripts/build-gate.ps1 -Gxx <g++>` 自建，或保持 fail-closed。
- 协议（一行 JSON 进 / 一行出）：

```text
echo {"url":"https://.../studentReviewTestOrExam/1","skills":["webclass-zhs-answer"],
      "sites":{...},"tree":{...}} | site_gate --json
→ {"decision":"allow","site":"zhihuishu","skill":"webclass-zhs-answer",
   "allowedTools":[...],"reason":"allowed","reasons":["url_known: zhihuishu",...]}
```

- 自检：`site_gate --validate --sites gate/sites.json --tree gate/gate.tree.json`、
  `site_gate --cases gate/tests/cases.json --sites ... --tree ...`。

### Adding a Site (No Code Changes)

1. 在 `gate/sites.json` 的 `sites[]` 加一条：`id`、`skill`、`match.hosts` / `match.pathPrefixes`、`tools` 白名单；
2. 在包内 `skills/<skill>/SKILL.md` 放对应技能；
3. `node scripts/sync-skills.mjs --check` + `node scripts/verify.mjs` 复跑。

## Tools

| 工具 | 作用 |
|---|---|
| `site_gate {url, pageReady?}` | **网页任务第一步**：识别站点并放行 / 问人 / 拒绝 |
| `zhs_status` | 诊断装配：技能是否注册、route 状态、门禁路径、桥模式 |
| `zhs_extension_path` | 返回扩展目录绝对路径（供用户加载） |
| `zhs_outline_set {outline}` | 写入课程大纲 `outline.json` |
| `zhs_next_section {root?, skip?}` | 下一个未作答小节 + 进度 |
| `zhs_precheck {point, questionCount, answered}` | 提交前漏答校验，`ok=false` 不要提交 |
| `zhs_record_result {point, answers, correct, total, mastery}` | 追加结果台账 `results.jsonl` |

## Skills

| 技能 | 说明 |
|---|---|
| `webclass-zhs-answer` | 智慧树复习 / 考试页作答闭环：怎么选、逐项点选与校验、提交与判分核对、`去提升` 循环；随插件运行时注册，无需拷到 `~/.agents/skills` |

> 同名优先级（dsh 技能注册表）：`project`(100/200) > `runtime`(250，即本插件) > `custom`(300) > `user`(400/500)。
> 若你在 `<工作区>/.agents/skills` 或 `~/.agents/skills` 里还留着同名旧副本，project 层会盖住插件版；
> 想用包内版本就删掉旧副本（或反过来，把包内 `skills: false` 关掉）。

## Configuration

```yaml
# cordis.patch.yml 里的 config（也可在 profile 里覆盖）
bridge: auto              # auto=宿主已有桥就跳过；on=强制组合；off=不组合
site: zhihuishu           # zhs_* 工具归属站点
skills: true              # 是否注册包内技能
gate:
  enabled: true
  timeoutMs: 2000
  routeTtlMinutes: 30
  binPath: ''             # 缺省用包内 bin/win32-x64/site_gate.exe
  gateDir: ''             # 缺省用包内 gate/
extensionDir: ''          # 缺省用包内 vendor/browser-extension
root: ''                  # 缺省=进程 cwd；outline.json/results.jsonl/route.json 落点
```

## Troubleshooting

| 症状 | 处置 |
|---|---|
| `site_gate` 返回 `ask_user` + `unknown_site` | URL 不在 `sites.json`；按 “Adding a Site” 加条目，不要硬闯 |
| 返回 `gate_timeout` / `gate_spawn_failed` | 检查 `bin/win32-x64/site_gate.exe` 是否存在、是否被杀软拦截；缺 exe 时门禁恒为 ask_user |
| 返回 `skill_missing` | 包内 `skills/` 缺失该技能，或 `skills: false`；跑 `scripts/sync-skills.mjs` |
| `zhs_*` 报「未通过 site_gate」 | 先 `site_gate({url})`；放行 30 分钟后过期需重调 |
| `browser_*` 工具不存在 | 宿主未装上游桥且 `bridge: off`，或 `vendor/bridge-browser` 缺失 |
| Chrome 侧连不上 | 扩展未加载 / 未连接；`zhs_extension_path` 取目录后按 “Quick Start” 第 2 步加载 |
| 侧栏「为避免操作错页，浏览器操作已暂停」 | 切回受控标签页，或在侧栏选「使用当前页面」 |
| 侧栏「无法绑定当前标签页」 | 当前标签是 `chrome://` 等受限页；换到网课页再连 |

## Boundary

- `browser_*` 没有工具层硬门禁：本包只能通过 system-prompt 纪律要求先过 `site_gate`；
  真正的硬门禁覆盖 `zhs_*`。要收紧可接 `@deepseek-ai/dsh-hook-protocol`（下一迭代）。
- 门禁只认 URL 与站点表，不做账号 / 权限判断。
- 提交类动作不可逆：插件不会替你点「提交作业」；授权规则写在技能里。

## Release Checklist

```powershell
node scripts/verify.mjs          # 包形状 + 门禁用例 + 技能 + vendor + 文档
npm pack --dry-run               # 看 tarball 内容（需 npm）
npm publish
```
