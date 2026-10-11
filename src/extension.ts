/**
 * SV Peek —— 敲一下键，解释弹在光标旁。
 *
 * 三层，越靠前越快：
 *   1. 本地词表 glossary.ts  —— 0ms、0 成本、0 网络
 *   2. 答案缓存 cache.ts     —— 0ms，跨窗口跨会话保留
 *   3. 模型 llm.ts           —— ~1s，答案限死 2-4 行
 *
 * 为什么用 hover 而不是自己画浮窗：VSCode 没有把任意内容放到光标处的公开 API，
 * hover 是唯一的原生机制。做法是把解释挂成某个 range 的 hover 内容，然后程序化触发
 * `editor.action.showHover`——它在光标处弹出，而光标刚好就在你选中/点中的代码上。
 *
 * 没有裸注册 hover provider 让鼠标悬停自动触发：鼠标每停一次打一次模型 = 烧钱 + 卡顿。
 * 必须快捷键显式触发，hover provider 只负责回读已经算好的内容。
 */
import * as vscode from 'vscode';
import * as cache from './cache';
import { lookup, size as glossarySize, GlossaryHit } from './glossary';
import * as log from './log';
import { AskResult, ask, LLMError, modelLabel } from './llm';
import * as panel from './panel';
import * as thread from './thread';
import { SYSTEM, buildUser } from './prompt';
import { COLOR, bullet, footer, interviewNote, newMd, para, tint } from './render';

interface Note {
  range: vscode.Range;
  md: vscode.MarkdownString;
}

/** 每个文档挂着的解释。key 是 uri.toString() */
const notes = new Map<string, Note[]>();
const MAX_NOTES_PER_DOC = 40;

/**
 * 同一段代码正在问的时候复用那个请求，别重复发车（连敲两下快捷键很容易触发）。
 * 存 promise 而不是存 key：后来的调用要能等到同一个结果并在自己的编辑器里渲染，
 * 直接 return 的话，万一先发的那次回来时用户已经切走，就谁也看不到结果。
 */
const inFlight = new Map<string, Promise<AskResult>>();

/** 光标没选中东西时，往外扩到一个词。带上反引号，`uvm_info 才能整个取到 */
const SV_TOKEN = /`?[A-Za-z_]\w*/;

let ctx: vscode.ExtensionContext;

/** 刚答过的那一条。点「追问」时拿来给面板开场，省掉重复的第一次调用 */
let lastAnswer: { snippet: string; text: string } | undefined;

export function activate(context: vscode.ExtensionContext) {
  ctx = context;
  log.init(context);
  log.log(`SV Peek 启动 · remoteName=${vscode.env.remoteName ?? '(本地)'} · appHost=${vscode.env.appHost}`);
  context.subscriptions.push(
    vscode.commands.registerCommand('svPeek.explain', () => explain()),
    vscode.commands.registerCommand('svPeek.refresh', () => explain({ force: true })),
    vscode.commands.registerCommand('svPeek.showLog', () => log.show()),
    vscode.commands.registerCommand('svPeek.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local.sv-peek'),
    ),
    vscode.commands.registerCommand('svPeek.clear', clearActive),
    vscode.commands.registerCommand('svPeek.clearCache', clearCache),
    vscode.commands.registerCommand('svPeek.ask', askPanel),
    vscode.commands.registerCommand('svPeek.reply', (r: vscode.CommentReply) =>
      thread.reply(vscode.workspace.getConfiguration('svPeek'), r),
    ),
    vscode.commands.registerCommand('svPeek.closeThread', (t?: vscode.CommentThread) =>
      thread.close(t),
    ),
    vscode.commands.registerCommand('svPeek.toSide', () => {
      const conv = thread.takeOver();
      if (conv) panel.adopt(ctx, vscode.workspace.getConfiguration('svPeek'), conv);
    }),

    // selector 用 '*'：读代码的地方不一定被识别成 systemverilog（日志、diff、无扩展名的文件都可能）。
    // 没挂 note 的位置直接返回 undefined，等于零开销。
    vscode.languages.registerHoverProvider('*', {
      provideHover(doc, pos) {
        const hit = (notes.get(doc.uri.toString()) ?? []).find((n) => n.range.contains(pos));
        return hit ? new vscode.Hover(hit.md, hit.range) : undefined;
      },
    }),

    // 文档一改，存下来的 range 就对不上了，整篇丢掉。读代码不改文件，正常用不会触发。
    vscode.workspace.onDidChangeTextDocument((e) => notes.delete(e.document.uri.toString())),
    vscode.workspace.onDidCloseTextDocument((d) => notes.delete(d.uri.toString())),
  );
}

export function deactivate() {
  notes.clear();
  inFlight.clear();
  thread.dispose();
}

// ------------------------------------------------------------------ 主流程

/**
 * @param force 绕过词表和缓存直接问模型。「重问」用——答案不合意时总得有条退路，
 *              否则词表和缓存给的是固定答案，再按多少次都一样。
 */
async function explain(opts: { force?: boolean } = {}) {
  const ed = vscode.window.activeTextEditor;
  if (!ed) {
    // 静默 return 是上一版的毛病：按了键什么都不发生，分不清是没触发还是插件坏了
    hint('SV Peek：当前没有打开的编辑器');
    return;
  }

  const target = pickTarget(ed);
  if (!target) {
    hint('SV Peek：光标不在任何词上（空行或纯符号），换个位置或选中一段再试');
    return;
  }

  const t = log.timer(`explain「${target.text.replace(/\s+/g, ' ').slice(0, 30)}」${opts.force ? ' [重问]' : ''}`);
  const cfg = vscode.workspace.getConfiguration('svPeek');
  const snippet = target.text.slice(0, cfg.get<number>('maxChars', 2000));
  t.mark('取片段');

  // 第 1 层：词表。命中就是 0ms，连 await 都没有。
  const hit = opts.force ? undefined : lookup(snippet);
  if (hit) {
    lastAnswer = { snippet, text: hitAsText(hit) };
    show(ed, target.range, renderHit(hit));
    t.mark('词表命中，弹出完成');
    return;
  }
  t.mark('词表未命中');

  const model = modelLabel(cfg);
  const context = buildContext(ed.document, target.range, cfg);
  t.mark('取上下文', `${context.whole ? '整文件' : '窗口'} ${context.text.length} 字符`);
  // 整文件模式下答案会引用本文件别处的代码，缓存不能跨文件共用；
  // 指纹带上文件内容，文件一改这条缓存自然作废
  const scope = context.whole
    ? `${ed.document.uri.toString()}#${cache.fingerprint(context.text)}`
    : '';
  const key = cache.cacheKey(model, snippet, scope);
  t.mark('算缓存 key');

  // 第 2 层：答案缓存。
  const cached = opts.force ? undefined : cache.get(ctx, key);
  if (cached) {
    lastAnswer = { snippet, text: cached };
    t.mark('缓存命中');
    show(ed, target.range, renderAnswer(cached, `缓存命中 · 0ms · ${model}`));
    return;
  }

  // 第 3 层：模型。
  //
  // 「先弹个占位再替换」这条路走死了，**默认关闭**：VSCode 1.85 没有关闭 hover 的命令
  // （只有 showHover 和一堆滚动命令），hover 一旦开着，再调一次 showHover 是空操作，
  // 内容不会重画。结果是用户盯着一个永远转圈的旧画面，而请求其实 1 秒就回来了——
  // 比「等 1 秒什么都没有」糟糕得多。实测延迟就 0.9-1.5s，占位本来也没必要。
  if (cfg.get<boolean>('showPending', false)) {
    show(ed, target.range, renderPending(snippet));
    t.mark('弹出「正在问模型」');
  }

  let req = inFlight.get(key);
  if (!req) {
    const user = buildUser({
      fileName: vscode.workspace.asRelativePath(ed.document.uri),
      languageId: ed.document.languageId,
      snippet,
      context: context.text,
      whole: context.whole,
      line: target.range.start.line + 1,
    });
    // withProgress 给的是 Thenable，没有 catch/finally，套一层才好挂收尾
    const fresh = Promise.resolve(
      vscode.window.withProgress(
        {
        location: vscode.ProgressLocation.Window,
        // 带上片段名：状态栏那行是等待期间唯一会动的东西，写清楚在等谁
        title: `$(sync~spin) SV Peek 正在解释 ${snippet.replace(/\s+/g, ' ').slice(0, 24)}…`,
      },
        () => ask(cfg, SYSTEM, user),
      ),
    );
    t.mark('拼 prompt', `${user.length} 字符`);
    inFlight.set(key, fresh);
    // 答案先进缓存再说，哪怕人已经切走了，这次的钱也不白花
    void fresh
      .then((r) => cache.put(ctx, key, r.text))
      .catch(() => undefined)
      .finally(() => inFlight.delete(key));
    req = fresh;
  }

  try {
    const res = await req;
    t.mark('模型返回', `入 ${res.inTok}（缓存 ${res.cachedTok}）出 ${res.outTok}`);
    lastAnswer = { snippet, text: res.text };
    if (!stillThere(ed, target.range)) {
      // 人已经走了。**必须把占位清掉**，否则那条「正在问模型…」会永远挂在
      // 那个 range 上，下次鼠标扫过去还是个转圈，看起来就像卡死了
      dropNote(ed, target.range);
      log.log('   人已离开原位，丢弃结果并清掉占位');
      return;
    }
    show(ed, target.range, renderAnswer(res.text, meta(model, res, context.whole)));
    t.mark('渲染完成');
  } catch (e) {
    const msg = e instanceof LLMError || e instanceof Error ? e.message : String(e);
    log.log(`   失败: ${msg.slice(0, 200)}`);
    if (!stillThere(ed, target.range)) {
      dropNote(ed, target.range);
      return;
    }
    show(ed, target.range, renderError(msg));
    t.mark('渲染错误');
  }
}

/** 把挂在这个 range 上的内容撤掉。占位不清会留下一个永远转圈的假象 */
function dropNote(ed: vscode.TextEditor, range: vscode.Range) {
  const key = ed.document.uri.toString();
  const rest = (notes.get(key) ?? []).filter((n) => !n.range.isEqual(range));
  if (rest.length) notes.set(key, rest);
  else notes.delete(key);
}

/**
 * 等模型的两三秒里人可能已经走了。还在原地才把答案弹出来——
 * 否则会在人家正在读的另一处代码上突然冒个弹窗出来。
 */
function stillThere(ed: vscode.TextEditor, range: vscode.Range): boolean {
  return vscode.window.activeTextEditor === ed && range.contains(ed.selection.active);
}

/** 非模态提示，3 秒后自己消失。不用 showInformationMessage——那个要手动关，太吵 */
function hint(msg: string) {
  vscode.window.setStatusBarMessage(msg, 3000);
}

/**
 * 打开追问面板。不收参数——只认当前编辑器的光标/选区，
 * 所以 hover 里那个 command 链接哪怕是模型吐出来的，也做不了别的事。
 */
function askPanel() {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return;
  const target = pickTarget(ed);
  if (!target) return;
  const cfg = vscode.workspace.getConfiguration('svPeek');
  const snippet = target.text.slice(0, cfg.get<number>('maxChars', 2000));
  const context = buildContext(ed.document, target.range, cfg);
  const seed = {
    fileName: vscode.workspace.asRelativePath(ed.document.uri),
    languageId: ed.document.languageId,
    snippet,
    context: context.text,
    whole: context.whole,
    line: target.range.start.line + 1,
    answer: lastAnswer?.snippet === snippet ? lastAnswer.text : undefined,
  };
  if (cfg.get<string>('askUi', 'inline') === 'panel') {
    panel.open(ctx, cfg, seed);
  } else {
    thread.open(ctx, cfg, seed, ed.document.uri, target.range);
  }
}

/** 词表条目转成纯文本，喂给面板当对话的第一轮回答 */
function hitAsText(hit: GlossaryHit): string {
  const lines = [`${hit.term} — ${hit.gist}`, ...hit.bullets.map((b) => `- ${b}`)];
  if (hit.interview) lines.push(`面试：${hit.interview}`);
  return lines.join('\n');
}

function clearActive() {
  const ed = vscode.window.activeTextEditor;
  if (ed) notes.delete(ed.document.uri.toString());
}

function clearCache() {
  const n = cache.clear(ctx);
  void vscode.window.showInformationMessage(`SV Peek：清掉 ${n} 条缓存答案（词表不受影响）`);
}

/**
 * 要解释的是哪段：有选中就用选中的；没选中就取光标所在的词；
 * 词也取不到（光标停在空白/符号上）就退回整行。
 *
 * 「不用选中也能问」是这个工具省交互成本的一半——选中本身就是最慢的一步。
 */
function pickTarget(ed: vscode.TextEditor): { range: vscode.Range; text: string } | undefined {
  const doc = ed.document;

  if (!ed.selection.isEmpty) {
    const range = new vscode.Range(ed.selection.start, ed.selection.end);
    return { range, text: doc.getText(range) };
  }

  const word = doc.getWordRangeAtPosition(ed.selection.active, SV_TOKEN);
  if (word) return { range: word, text: doc.getText(word) };

  const line = doc.lineAt(ed.selection.active.line);
  if (!line.text.trim()) return undefined;
  return { range: line.range, text: line.text };
}

interface Ctx {
  text: string;
  /** 是不是整个文件 */
  whole: boolean;
}

/**
 * 送给模型的上下文。
 *
 * 整文件贵，但换来两样东西：一是「这个信号在哪声明的、被谁驱动」这类问题才答得准；
 * 二是文件正文成了逐字不变的 prompt 前缀，同一个文件连问时从第二问起走缓存，
 * 边际成本反而比每次都发一段不同的窗口更低。
 *
 * auto：文件不大就整个发，大文件退回窗口，免得一次几万 token。
 */
function buildContext(doc: vscode.TextDocument, range: vscode.Range, cfg: vscode.WorkspaceConfiguration): Ctx {
  const mode = cfg.get<string>('contextMode', 'auto');
  if (mode !== 'window') {
    const full = doc.getText();
    if (mode === 'file' || full.length <= cfg.get<number>('fileContextMaxChars', 24000)) {
      return { text: full, whole: true };
    }
  }
  const lines = cfg.get<number>('contextLines', 20);
  const from = Math.max(0, range.start.line - lines);
  const to = Math.min(doc.lineCount - 1, range.end.line + lines);
  return { text: doc.getText(new vscode.Range(from, 0, to, doc.lineAt(to).text.length)), whole: false };
}

/** 词表的面试提示要不要显示。模型那边无论如何都不显示 */
function showInterview(): boolean {
  return vscode.workspace.getConfiguration('svPeek').get<boolean>('interviewLine', true);
}

function showMeta(): boolean {
  return vscode.workspace.getConfiguration('svPeek').get<boolean>('showMeta', false);
}

/** 调试用：这次花了什么。默认不显示：上下文范围、耗时、token。心里有数才敢用整文件模式 */
function meta(model: string, res: AskResult, whole: boolean): string {
  const scope = whole ? '整文件' : '窗口';
  const cached = res.cachedTok ? `（缓存 ${res.cachedTok}）` : '';
  return `${model} · ${scope} · ${res.ms}ms · ${res.inTok}${cached}→${res.outTok} tok`;
}

function show(ed: vscode.TextEditor, range: vscode.Range, md: vscode.MarkdownString) {
  const key = ed.document.uri.toString();

  // 同一块代码重问，旧的要让位。intersection 对「刚好挨着」的两个 range 返回空 range
  // （不是 undefined），所以要额外判 isEmpty，否则会把相邻的旧解释误删。
  const kept = (notes.get(key) ?? []).filter((n) => {
    const overlap = n.range.intersection(range);
    return !overlap || overlap.isEmpty;
  });
  kept.push({ range, md });
  notes.set(key, kept.slice(-MAX_NOTES_PER_DOC));

  // 光标此刻就在 range 里（选中时在端点，未选中时在词上），所以 hover 弹在正确的位置
  void vscode.commands.executeCommand('editor.action.showHover');
}

// ------------------------------------------------------------------ 渲染

/** term 里有反引号（`uvm_info）和下划线，直接塞进 markdown 会被当成语法标记 */
function escapeMd(s: string): string {
  return s.replace(/([`*_])/g, '\\$1');
}

function renderHit(hit: GlossaryHit): vscode.MarkdownString {
  const m = newMd();
  // 标题和一句话摘要并到一行：分成两段会多一个段落外边距，白占高度
  m.appendMarkdown(para(`${tint(COLOR.term, `**${escapeMd(hit.term)}**`)} ${hit.gist}`));
  const items = hit.bullets.map(bullet);
  if (hit.interview && showInterview()) items.push(interviewNote(hit.interview));
  m.appendMarkdown(`\n\n${items.join('\n')}`);
  footer(m, showMeta() ? `词表 · 0ms · 共 ${glossarySize} 条` : undefined, true);
  return m;
}

function renderAnswer(text: string, meta: string): vscode.MarkdownString {
  const m = newMd();
  const { points } = splitAnswer(sanitize(text));
  m.appendMarkdown(points.map(bullet).join('\n'));
  footer(m, showMeta() ? meta : undefined, true);
  return m;
}

function renderPending(snippet: string): vscode.MarkdownString {
  const one = snippet.replace(/\s+/g, ' ').trim();
  const m = newMd();
  m.appendMarkdown(
    `$(sync~spin) ${tint(COLOR.dim, '正在问模型…')}\n\n${para(`\`${one.slice(0, 60)}\``)}`,
  );
  return m;
}

function renderError(msg: string): vscode.MarkdownString {
  const m = newMd();
  m.appendMarkdown(`${tint(COLOR.error, '$(error) **SV Peek 调用失败**')}\n\n`);
  m.appendMarkdown(para(msg));
  m.appendMarkdown(
    '\n\n[$(gear) 打开设置](command:svPeek.openSettings)　[$(refresh) 重试](command:svPeek.refresh)',
  );
  return m;
}

const INTERVIEW_LOOSE = /^(?:[-*\u2022]\s*)?(?:\*\*)?\s*面试\s*(?:\*\*)?\s*[:：]/;

/**
 * 模型输出里的「面试：」行，一律丢掉。
 *
 * 这一行只在真有信息量时才该出现——每次都出现的提示等于没有提示。但**靠 prompt
 * 管不住**：实测三种写法都失败（软指令「不常考就不写」→ 5 个片段 4 个该省的没省；
 * 收紧标准 + 给反面示例 → 没改善；要求先认领「教材陷阱/反直觉」标签再写 →
 * 它给 `$sformatf` 也贴了「反直觉」）。mini 模型会照着模板填，然后给任何东西编个理由。
 *
 * 所以不归它管：面试提示只由**人工挑过的词表**提供，模型这边整行丢弃。
 * 想要模型的面试角度，直接在追问里问一句就是了——那是用户主动要的，
 * 本来就 100% 有信号。
 */
function splitAnswer(text: string): { points: string[] } {
  const points: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // 丢掉，也不要让它退化成一条普通要点
    if (INTERVIEW_LOOSE.test(line)) continue;
    points.push(line.replace(/^[-*\u2022]\s+/, ''));
  }
  return { points };
}

/** 模型偶尔会把整个答案包进代码块，那样 hover 里全是等宽字体，读着难受 */
function sanitize(text: string): string {
  const t = text.trim();
  const fenced = /^```[a-z]*\n([\s\S]*)\n```$/i.exec(t);
  return (fenced?.[1] ?? t).trim();
}
