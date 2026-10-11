/**
 * 内联追问：用 Comment Thread 做的。
 *
 * 为什么是它：VSCode 扩展 API 里没有「在光标处放一个自由浮动的 webview」这种东西。
 * createWebviewPanel 只能落在编辑器分栏，WebviewView 只能进侧边栏。有个 editorInsets
 * 提案 API 能做到，但只在 --enable-proposed-api 的开发宿主里有效，打包成 .vsix 就废了。
 *
 * Comment Thread 是公开 API 里唯一同时满足三件事的：**嵌在代码行下方**（不是侧栏）、
 * **自带输入框**、**滚动不消失**（它是编辑器内容流的一部分，跟着代码一起滚）。
 * 代价是它长得像代码评审的评论框，以及会把下方代码往下顶。
 *
 * 和 hover 的分工没变：hover 是快速路径，看一眼就走；这个是要接着聊的时候才开。
 */
import * as vscode from 'vscode';
import { Msg, askMessages } from './llm';
import { AUTO_ASK, SYSTEM, buildUser } from './prompt';
import type { Seed } from './panel';

let controller: vscode.CommentController | undefined;
let thread: vscode.CommentThread | undefined;
let messages: Msg[] = [];
let label = '';
let busy = false;

/** 一次只留一个会话。开一堆内联框只会把代码顶得七零八落 */
function ensureController(ctx: vscode.ExtensionContext): vscode.CommentController {
  if (!controller) {
    controller = vscode.comments.createCommentController('svPeek', 'SV Peek');
    // 不给 commentingRangeProvider：不希望每行左边都冒出一个「加评论」的加号，
    // 这个 controller 只服务于我们自己创建的那一个会话
    controller.options = { placeHolder: '追问…', prompt: '接着问点什么' };
    ctx.subscriptions.push(controller);
  }
  return controller;
}

/**
 * 内联框挂在哪一行。
 *
 * 默认挂在**上一行**，也就是显示在你问的那行**上方**。原因：控件是「顶开」代码而不是
 * 「盖住」代码，位移量两种挂法都一样，但挂下方会把你问的那行和它后面的逻辑劈成两半，
 * 而看懂一行往往正要接着看它下面几行。挂上方则是「答案 → 那行 → 后面的代码」连成一片。
 */
function anchor(cfg: vscode.WorkspaceConfiguration, range: vscode.Range): vscode.Range {
  if (cfg.get<string>('inlinePosition', 'above') !== 'above' || range.start.line === 0) {
    return range;
  }
  const line = range.start.line - 1;
  return new vscode.Range(line, 0, line, 0);
}

/** thread 还在不在。没有 onDidDispose 可用，只能靠摸一下属性试探 */
function alive(): boolean {
  if (!thread) return false;
  try {
    void thread.comments;
    return true;
  } catch {
    thread = undefined;
    return false;
  }
}

function comment(text: string, who: 'you' | 'ai'): vscode.Comment {
  const body = new vscode.MarkdownString(text);
  body.supportThemeIcons = true;
  // 正文里有模型输出，不开 isTrusted：这里也不需要任何 command 链接
  body.isTrusted = false;
  return {
    body,
    mode: vscode.CommentMode.Preview,
    author: { name: who === 'you' ? '你' : 'SV Peek' },
  };
}

export function open(
  ctx: vscode.ExtensionContext,
  cfg: vscode.WorkspaceConfiguration,
  seed: Seed,
  uri: vscode.Uri,
  range: vscode.Range,
) {
  const ctrl = ensureController(ctx);

  // 换了片段就重开一轮。同一片段重复按就保留上下文，接着追问。
  // alive() 是必要的：用户点 VSCode 自带的关闭把 thread 销毁掉时没有回调通知我们，
  // 手里的引用还在，往销毁掉的对象上写属性会抛。
  const same =
    alive() &&
    thread!.uri.toString() === uri.toString() &&
    messages[1]?.content === buildUser(seed);
  if (!same) {
    thread?.dispose();
    messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUser(seed) },
    ];
    thread = ctrl.createCommentThread(uri, anchor(cfg, range), []);
    label = seed.snippet.replace(/\s+/g, ' ').slice(0, 40);
    thread.label = `SV Peek · ${label}`;
    thread.canReply = true;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    if (seed.answer) {
      messages.push({ role: 'assistant', content: seed.answer });
      thread.comments = [comment(seed.answer, 'ai')];
    }
  }

  try {
    thread!.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  } catch {
    // 已经被销毁了，当作没这回事，下次按键会重建
    thread = undefined;
    return;
  }
  if (!seed.answer && thread!.comments.length === 0) void send(cfg, AUTO_ASK, true);
}

/** 输入框里点「发送」走这里。VSCode 把输入的文字放在 reply.text 里给我们 */
export async function reply(cfg: vscode.WorkspaceConfiguration, r: vscode.CommentReply) {
  if (!thread || r.thread !== thread) return;
  const text = r.text.trim();
  if (!text) return;
  await send(cfg, text);
}

async function send(cfg: vscode.WorkspaceConfiguration, text: string, silent = false) {
  if (!alive() || busy) return;
  // 先抓一份局部引用：await 之后 thread 可能已经被换掉或销毁了
  const t = thread!;
  busy = true;
  t.comments = [
    ...t.comments,
    ...(silent ? [] : [comment(text, 'you')]),
    comment('$(sync~spin) 思考中…', 'ai'),
  ];
  try {
    messages.push({ role: 'user', content: text });
    const res = await askMessages(cfg, messages);
    messages.push({ role: 'assistant', content: res.text });
    if (alive()) thread!.comments = [...thread!.comments.slice(0, -1), comment(res.text, 'ai')];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (alive()) {
      thread!.comments = [...thread!.comments.slice(0, -1), comment(`**出错了**\n\n${msg}`, 'ai')];
    }
  } finally {
    busy = false;
  }
}

/**
 * 把当前对话交出去（给侧边面板），并收掉内联框。
 * 读下面一大段逻辑时，内联框顶开代码这件事就变成纯负担，这时候一键挪到侧边最省事。
 */
export function takeOver(): { messages: Msg[]; label: string } | undefined {
  if (!messages.length) return undefined;
  const out = { messages: messages.slice(), label };
  close();
  return out;
}

export function close(target?: vscode.CommentThread) {
  if (target && target !== thread) {
    target.dispose();
    return;
  }
  thread?.dispose();
  thread = undefined;
  messages = [];
}

export function dispose() {
  close();
  controller?.dispose();
  controller = undefined;
}
