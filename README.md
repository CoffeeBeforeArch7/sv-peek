# SV Peek

SV Peek is a VS Code extension for reading SystemVerilog and UVM code.
Put the cursor on a word and press one key.
A short explanation pops up next to the cursor.
You do not need to open a chat panel or type a prompt.

- Answers for common SV/UVM constructs come from a built-in glossary. These answers show up at once and cost nothing.
- Other code goes to an OpenAI-compatible model. Each answer is cached, so a repeat question is instant.
- For follow-up questions, open a thread next to the line or a panel on the side.

The UI text and the answers are in Chinese for now. 中文说明在下方。

## Install

1. Download `sv-peek-<version>.vsix` from the Releases page of this repository.
2. Install it:

   ```bash
   code --install-extension sv-peek-<version>.vsix
   ```

3. Reload VS Code. You need VS Code 1.85 or newer.

To build the `.vsix` yourself, run `npm install` and then `npm run package`.

## Keys

| Key | When | What it does |
|---|---|---|
| `` Alt+` `` (`` ⌥` `` on a Mac) | Any time | Explains the word or line at the cursor. If text is selected, it explains the selection. |
| `` ` `` (backtick) | Only when text is selected | Explains the selected code. With no selection, the key types a backtick as usual. |
| `` Alt+Shift+` `` | Any time | Opens a follow-up thread for the code at the cursor. |

## API key

The extension needs a key for an OpenAI-compatible API.
It checks three places, in this order:

1. The `svPeek.apiKey` setting. VS Code keeps it as plain text in `settings.json`. Keep that file out of git.
2. An environment variable. The default name is `OPENAI_API_KEY`. Change the name with `svPeek.apiKeyEnv`.
   On macOS, VS Code does not see your shell variables if you start it from the Dock.
3. A JSON key file. Set `svPeek.apiKeyFile` to its path. Put the key in the `llm_api_key` field,
   like this: `{"llm_api_key": "sk-..."}`. The setting is empty by default. An empty value turns the key file off.

Privacy: glossary answers need no network.
For other code, the extension sends your code to the `svPeek.baseUrl` endpoint.
By default it sends the whole file if the file has 24,000 characters or fewer.

## Main settings

| Setting | Default | What it does |
|---|---|---|
| `svPeek.model` | `gpt-5.4-mini` | Model name. Any model on an OpenAI-compatible endpoint works. |
| `svPeek.baseUrl` | `https://api.openai.com/v1` | API endpoint. Change it for a proxy or a self-hosted server. |
| `svPeek.contextMode` | `auto` | How much code to send. `auto` sends the whole file up to 24,000 characters. For a bigger file it sends 20 lines before and after the selection. `file` always sends the whole file. `window` always sends only those nearby lines. |
| `svPeek.temperature` | `0.2` | Set it to `null` to leave it out of the request. Some models reject this field. |
| `svPeek.askUi` | `inline` | Where follow-ups go. `inline` opens a thread next to the code. `panel` opens a panel on the right. |
| `svPeek.interviewLine` | `true` | Shows an interview tip on some glossary entries. |

You can find all settings under "SV Peek" in the VS Code Settings UI.

---

# sv-peek — 敲一下键，代码旁边弹出解释

读 SystemVerilog / UVM 代码时撞到不懂的语法，**光标点上去，敲一下键**，
解释直接弹在光标旁。不用开聊天窗、不用选中、不用打「这段是干嘛的」。

```
点一下代码 ──▶ 敲 ⌥`  ──▶ 词表命中？ ──是──▶ 0ms 弹出
                            │
                            否 ──▶ 缓存命中？ ──是──▶ 0ms 弹出
                                      │
                                      否 ──▶ 问模型 ~2.6s
```

> 要**继续开发**看 `docs/PROGRESS.md`：设计决策的理由、踩过的坑、TODO。
> 本文件只讲怎么用。

---

## 跑起来

```bash
cd sv-peek
npm install
npm run compile
```

VSCode 打开 `sv-peek` 文件夹，按 **F5**。弹出的新窗口（扩展开发宿主）里
自动打开 `samples/demo.sv`，照文件里的注释试。

F5 只需要按一次——那个窗口开出来之后是个正常 VSCode，随便开别的工程都行。
只有改了扩展源码才需要重按 F5（或在调试窗口里 `⌘R` 重载）。

想装成常驻的，直接装 GitHub Releases 页上的 `.vsix`，或者自己打包：

```bash
npm run package
code --install-extension sv-peek-<版本号>.vsix
```

`npm run install-local` 把这两步合成一条（打包 + 安装 + 覆盖）。

## 三个键

| 键 | 生效条件 | 干什么 |
|---|---|---|
| `` ⌥` `` | 任何时候 | 解释光标所在的词/整行，**不用选中** |
| `` ` ``（Tab 上面那个） | **有选中文本时** | 解释选中的片段 |
| `` ⌥⇧` `` | 任何时候 | 开追问（也可以点 hover 底部的「追问」） |

**建议把这三条也写进自己的 `keybindings.json`**（macOS 在 `~/Library/Application Support/Code/User/`，
`when` 条件照抄 `package.json`）。和扩展自己声明的重复，是故意的：用户级绑定由 VSCode 本体注册，
跟扩展有没有加载无关。`` ⌥` `` 在 macOS 上是死键（输入重音符），扩展没接管时它会落进编辑器直接改代码，
有选中文本时选区整个被替换。多这一层，扩展没跑起来的窗口里这个键会被"吃掉"而不是改代码。

换机器时这份用户级绑定也要带过去。

`` ` `` 加了 `editorHasSelection` 的门：**没选中时它照常打字**，
所以 `` `include ``、`` `uvm_info `` 这些 SV 编译器指令和 UVM 宏一点不受影响。

## hover 和追问的分工

hover 快，但**它的生死归编辑器管**：滚动、鼠标移开、切焦点都会关掉，扩展没有 API 能覆盖。
它也只吃 markdown，塞不进输入框。

所以追问是另一个界面。默认 `inline`：直接展开在**那行代码下面**，自带输入框，
滚动不消失，要关得自己点右上角的 ×。

| | hover | 追问（inline） |
|---|---|---|
| 出现位置 | 光标旁浮窗 | 贴着那行代码展开 |
| 速度 | 词表 0ms | ~1s |
| 会不会自己消失 | 滚一下就没 | **不关就一直在** |
| 能不能追问 | 不能 | **能，多轮** |

看一眼就走用 hover；想追着问就点「追问」。答得不合意就点「重问」——
它绕过词表和缓存直接问模型，否则那两层给的是固定答案，再按多少次都一样。

> 为什么不是真正的浮窗：VSCode 扩展 API 没有「在光标处放一个自由浮动的 webview」这种东西。
> `createWebviewPanel` 只能落在编辑器分栏，`WebviewView` 只能进侧边栏。
> Comment Thread 是公开 API 里唯一同时做到「贴着代码 + 有输入框 + 滚动不消失」的。
> 代价是它长得像代码评审的评论框，而且会把下方代码往下顶。
>
> 想一开始就用右侧独立窗口，把 `svPeek.askUi` 改成 `panel`。

### 内联框会不会挡住下面的代码

**不会挡，是把下面的代码往下顶**——没有任何一行被遮住，只是位置挪了。
但框一高，下面的代码确实会被顶出屏幕。三件事一起解决这个：

1. **框默认挂在那行代码的上方**（`svPeek.inlinePosition`）。位移量两种挂法一样，
   但挂下方会把你问的那行和它后面的逻辑劈成两半；挂上方是
   「答案 → 那一行 → 后面的代码」连成一片，接着往下读不断层。
2. **框的标题栏有个「挪到侧边」按钮**，一键把当前对话原样搬到右侧面板，
   代码立刻回到原位。对话历史不丢，接着问就行。
3. **点标题栏可以折叠**，留着会话但不占地方，想看的时候再展开。

顺带一提：**模型本来就看得到下面的代码**。默认 `contextMode: auto` 发的是整个文件，
不是只发你选中的那几行，所以「要结合下文才能理解」的问题它答得了，
上面说的只是你自己想同时看到的问题。

## API key

按优先级找，找到一个就用：

1. 设置里的 `svPeek.apiKey`（明文存进 settings.json，别提交到 git）
2. 环境变量，默认 `OPENAI_API_KEY`（变量名用 `svPeek.apiKeyEnv` 改）。
   注意从 Dock 点开的 VSCode **不继承** shell 里 export 的变量
3. key 文件：`svPeek.apiKeyFile` 填一个 JSON 文件的路径，key 放在 `llm_api_key` 字段
   （字段名用 `svPeek.apiKeyFileField` 改）。默认留空，不读文件。
   几个工具想共用一把 key、轮换时只改一处，就都指向同一个文件

## 三层，越靠前越快

| 层 | 来源 | 延迟 | 成本 |
|---|---|---|---|
| 1 | 本地词表 `src/glossary.ts`（29 条） | **0ms** | 0 |
| 2 | 答案缓存（globalState，跨窗口跨会话） | **0ms** | 0 |
| 3 | 模型 | ~1s | 约 $0.0004/次 |

默认 `auto` 模式会把**整个文件**发给模型（不超过 24000 字符），这样「这个信号在哪声明的、
被谁驱动」这类问题才答得准。文件放在 prompt 最前面，成为可缓存的稳定前缀——
实测同一个文件连问，从第二问起 **91% 的输入走缓存**，续问反而比只发 ±20 行更便宜。

**$5 大约够 13000 次**（一个文件问 10 处的混合估算）。再算上前两层吃掉的重复查询，基本花不完。
确切单价没核对过，以 OpenAI 定价页为准。

词表 29 条里有 15 条带一行**面试提示**，标出哪些属于「教材标准写法但真实环境没人用」
（比如 `program` block），省得在不考的 mechanics 上耗时间。

**只有词表带这一行，模型的答案永远不带。** 因为实测模型做不到「只在值得时才写」——
它会照着模板填，然后给任何东西编个理由，结果就是每条都带、等于没带。
想要模型的面试角度，在追问里直接问一句就行。

## 设置

| 项 | 默认 | 说明 |
|---|---|---|
| `svPeek.model` | `gpt-5.4-mini` | 实测比 `gpt-4.1-mini` 慢 0.8s，但答案明显更具体 |
| `svPeek.baseUrl` | `https://api.openai.com/v1` | 换自建/中转改这里 |
| `svPeek.maxTokens` | 300 | 发出去是 `max_completion_tokens` |
| `svPeek.temperature` | 0.2 | 设 `null` 则不发该参数 |
| `svPeek.timeoutMs` | 20000 | 单次请求超时 |
| `svPeek.contextMode` | `auto` | `auto` 不超过上限就发整个文件 / `file` 总是整个文件 / `window` 只发前后各若干行 |
| `svPeek.fileContextMaxChars` | 24000 | `auto` 下超过就退回窗口模式，约 7k token |
| `svPeek.contextLines` | 20 | 窗口模式下选区前后各取多少行 |
| `svPeek.maxChars` | 2000 | 选区截断上限，防手滑全选整个文件 |
| `svPeek.askUi` | `inline` | `inline` 贴着代码展开 / `panel` 开在右侧窗口 |
| `svPeek.inlinePosition` | `above` | 内联框挂在那行的上方还是下方 |
| `svPeek.interviewLine` | `true` | 词表条目显示「面试」提示行（只影响词表） |
| `svPeek.showPending` | `false` | 先弹「正在问模型…」占位。**不建议开**，hover 刷不掉，会显示成永远转圈 |
| `svPeek.showMeta` | `false` | hover 底部显示模型名/耗时/token。调试用 |

命令面板里还有 **SV Peek: 清空答案缓存**（词表不受影响）。
