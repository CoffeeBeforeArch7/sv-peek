/**
 * 追问面板。
 *
 * 为什么要它：hover 的生命周期归编辑器管——滚动、移开鼠标、切焦点都会关掉，
 * 扩展没有 API 能覆盖；hover 又只吃 markdown，sanitizer 会把输入框剥掉。
 * 「常驻不消失」和「能打字追问」这两件事，hover 都做不到。
 *
 * 分工：hover 做快速路径（词表 0ms，看一眼就走），面板做深聊（常驻、多轮）。
 * 面板是单例——开一堆面板只会让人找不到刚才那个。
 */
import * as vscode from 'vscode';
import { Msg, askMessages, modelLabel } from './llm';
import { AUTO_ASK, SYSTEM, buildUser } from './prompt';

export interface Seed {
  fileName: string;
  languageId: string;
  snippet: string;
  context: string;
  whole: boolean;
  line: number;
  /** hover 里已经答过的话，直接带过来，省一次调用 */
  answer?: string;
}

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** 用户那一轮显示成「选中的片段」而不是一整段 prompt */
  label?: string;
}

let panel: vscode.WebviewPanel | undefined;
let messages: Msg[] = [];
let turns: Turn[] = [];
let busy = false;

function ensure(ctx: vscode.ExtensionContext, cfg: vscode.WorkspaceConfiguration) {
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      'svPeek.ask',
      'SV Peek 追问',
      // 不 preserveFocus：点了「追问」就是想打字，还要再点一下输入框太别扭
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.onDidDispose(() => {
      panel = undefined;
      messages = [];
      turns = [];
    }, null, ctx.subscriptions);
    panel.webview.onDidReceiveMessage(
      (m: { type: string; text?: string }) => {
        if (m.type === 'ask' && m.text?.trim()) void followUp(cfg, m.text.trim());
      },
      null,
      ctx.subscriptions,
    );
    panel.webview.html = html();
  }
}

export function open(ctx: vscode.ExtensionContext, cfg: vscode.WorkspaceConfiguration, seed: Seed) {
  ensure(ctx, cfg);

  // 换了片段就重开一轮对话。同一片段就保留上下文，接着追问
  const fresh = !messages.length || turns[0]?.label !== seed.snippet;
  if (fresh) {
    messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUser(seed) },
    ];
    turns = [{ role: 'user', text: seed.snippet, label: seed.snippet }];
    if (seed.answer) {
      messages.push({ role: 'assistant', content: seed.answer });
      turns.push({ role: 'assistant', text: seed.answer });
    }
  }

  push();
  panel?.reveal(vscode.ViewColumn.Beside, false);
  if (fresh && !seed.answer) void followUp(cfg, AUTO_ASK, true);
}

/** 接管内联框交过来的对话：消息原样搬过来，显示用的 turns 从消息重建 */
export function adopt(
  ctx: vscode.ExtensionContext,
  cfg: vscode.WorkspaceConfiguration,
  conv: { messages: Msg[]; label: string },
) {
  ensure(ctx, cfg);
  messages = conv.messages.slice();
  turns = [{ role: 'user', text: conv.label, label: conv.label }];
  // 跳过 system 和第一条（那是塞了整个文件的 prompt，不是人说的话），
  // 也跳过开场的自动提问
  for (const m of messages.slice(2)) {
    if (m.role === 'user' && m.content === AUTO_ASK) continue;
    if (m.role === 'system') continue;
    turns.push({ role: m.role === 'user' ? 'user' : 'assistant', text: m.content });
  }
  push();
  panel?.reveal(vscode.ViewColumn.Beside, false);
}

async function followUp(cfg: vscode.WorkspaceConfiguration, text: string, silent = false) {
  if (!panel || busy) return;
  busy = true;
  if (!silent) turns.push({ role: 'user', text });
  push(true);
  try {
    messages.push({ role: 'user', content: text });
    const res = await askMessages(cfg, messages);
    messages.push({ role: 'assistant', content: res.text });
    turns.push({ role: 'assistant', text: res.text });
  } catch (e) {
    turns.push({ role: 'assistant', text: `**出错了**：${e instanceof Error ? e.message : String(e)}` });
  } finally {
    busy = false;
    push();
  }
}

function push(thinking = false) {
  panel?.webview.postMessage({ type: 'render', turns, thinking });
  if (panel) panel.title = `SV Peek · ${turns[0]?.label ?? '追问'}`;
}

/** 追问入口活不活，取决于有没有拿到过片段 */
export function isOpen(): boolean {
  return !!panel;
}

export function modelName(cfg: vscode.WorkspaceConfiguration): string {
  return modelLabel(cfg);
}

function html(): string {
  // 全部用 VSCode 的 CSS 变量，主题换了自动跟着换。
  // 不引外部资源，省掉 CSP 和离线的麻烦；markdown 也是自己渲染的——
  // 输出格式是我们自己 prompt 规定的，只要认 bullet / 粗体 / 行内代码三样就够。
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex; flex-direction: column; height: 100vh;
  }
  #log { flex: 1; overflow-y: auto; padding: 12px 14px; }
  .turn { margin-bottom: 14px; }
  .you {
    color: var(--vscode-charts-blue);
    font-weight: 600;
    border-left: 2px solid var(--vscode-charts-blue);
    padding-left: 8px;
  }
  .turn ul { margin: 4px 0; padding-left: 18px; }
  .turn li { margin: 2px 0; line-height: 1.5; }
  .turn p { margin: 4px 0; line-height: 1.5; }
  code {
    font-family: var(--vscode-editor-font-family);
    background: var(--vscode-textCodeBlock-background);
    border-radius: 3px; padding: 0 3px;
  }
  .interview { color: var(--vscode-charts-orange); font-weight: 600; }
  .thinking { color: var(--vscode-descriptionForeground); font-style: italic; }
  #bar {
    display: flex; gap: 6px; padding: 8px 10px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
  }
  #q {
    flex: 1; resize: none; min-height: 28px; max-height: 120px;
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px; padding: 5px 7px;
  }
  #q:focus { outline: 1px solid var(--vscode-focusBorder); }
  button {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: none; border-radius: 3px; padding: 5px 12px; cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style></head>
<body>
  <div id="log"></div>
  <div id="bar">
    <textarea id="q" rows="1" placeholder="追问… （Enter 发送，Shift+Enter 换行）"></textarea>
    <button id="send">发送</button>
  </div>
<script>
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const q = document.getElementById('q');

  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const inline = (s) =>
    esc(s)
      .replace(/\`\`([^\`]+)\`\`/g, (_, c) => '<code>' + c.trim() + '</code>')
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

  function md(text) {
    const out = [];
    let ul = null;
    for (const raw of text.split('\\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = /^[-*\\u2022]\\s+(.*)$/.exec(line);
      const iv = /^(?:\\*\\*)?面试(?:\\*\\*)?\\s*[:：]\\s*(.*)$/.exec(m ? m[1] : line);
      const body = iv ? '<span class="interview">面试</span> ' + inline(iv[1]) : inline(m ? m[1] : line);
      if (m || iv) {
        if (!ul) { ul = document.createElement('ul'); out.push(ul); }
        const li = document.createElement('li');
        li.innerHTML = body;
        ul.appendChild(li);
      } else {
        ul = null;
        const p = document.createElement('p');
        p.innerHTML = body;
        out.push(p);
      }
    }
    return out;
  }

  window.addEventListener('message', (e) => {
    const { turns, thinking } = e.data;
    log.textContent = '';
    for (const t of turns) {
      const div = document.createElement('div');
      div.className = 'turn';
      if (t.role === 'user') {
        div.innerHTML = '<div class="you">' + inline(t.text) + '</div>';
      } else {
        md(t.text).forEach((n) => div.appendChild(n));
      }
      log.appendChild(div);
    }
    if (thinking) {
      const d = document.createElement('div');
      d.className = 'thinking';
      d.textContent = '思考中…';
      log.appendChild(d);
    }
    log.scrollTop = log.scrollHeight;
    if (!thinking) q.focus();
  });

  function send() {
    const text = q.value.trim();
    if (!text) return;
    q.value = '';
    vscode.postMessage({ type: 'ask', text });
  }
  document.getElementById('send').addEventListener('click', send);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
</script>
</body></html>`;
}
