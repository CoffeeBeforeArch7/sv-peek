/**
 * hover 的排版。两件事：上色，和控制宽度。
 *
 * 上色：VSCode 的 markdown sanitizer 只放行 <span> 上的 color / background-color，
 * 且值必须是 #RRGGBB 或 var(--vscode-xxx)（实测 1.85 的白名单正则）。用主题变量而不是
 * 写死色值，亮色/暗色主题下都能跟着走。需要 markdown.supportHtml = true。
 *
 * 宽度：hover 窗口会横向撑到最长那一行，长句会把它拉得很宽，眼睛要横着扫。
 * 所以按**视觉宽度**（汉字算 2、ASCII 算 1）折行，并且不在 `代码` 和 **粗体** 中间断开
 * ——断在中间 markdown 标记就废了，会把 ** 原样显示出来。
 */
import * as vscode from 'vscode';

/**
 * 一行的视觉宽度上限。72 ≈ 36 个汉字。
 *
 * 这是横向和纵向的取舍：窄了每条要点折成两三行，hover 变高就要滚轮翻；
 * 宽了眼睛要横着扫。72 能让大部分要点落在一行内，纵向就压下来了。
 */
const WIDTH = 72;

const CJK =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

/** 能断行的位置：标点和闭合符号之后。不在词中间硬切 */
const BREAKABLE = /[，、；。：！？,;)\]}」』】）\s]/;

/**
 * 原子块：从中间断开 markdown 就废了，会把标记原样显示出来。
 * 双反引号必须排在单反引号前面——词表里 `` `uvm_field_* `` 这种写法（内含反引号的
 * 代码片段）只能用双反引号包，先匹配单个的话会从中间切开。
 */
const ATOMIC = /(<\/?span[^>]*>|``[\s\S]*?``|`[^`\n]+`|\*\*[^*\n]+\*\*)/;

/** <span> 标签是标记，不是内容：不占可见宽度，也绝不能从中间断开 */
const TAG = /^<\/?span[^>]*>$/;

function charWidth(ch: string): number {
  return CJK.test(ch) ? 2 : 1;
}

function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

interface Atom {
  s: string;
  w: number;
  /** 这个原子之后可以断行 */
  breakAfter: boolean;
}

function atomize(text: string): Atom[] {
  const out: Atom[] = [];
  for (const part of text.split(ATOMIC).filter(Boolean)) {
    if (TAG.test(part)) {
      // style 属性里有分号和逗号，不特判的话会断在标签中间，把 HTML 整个弄废
      out.push({ s: part, w: 0, breakAfter: false });
    } else if (ATOMIC.test(part) && /^(``|`|\*\*)/.test(part)) {
      out.push({ s: part, w: visualWidth(part), breakAfter: false });
    } else {
      for (const ch of part) {
        out.push({ s: ch, w: charWidth(ch), breakAfter: BREAKABLE.test(ch) });
      }
    }
  }
  return out;
}

/**
 * 贪心折行：超宽时**回退到本行最后一个可断点**，而不是继续找下一个标点。
 * 后者会让「超宽之后很久才出现标点」的句子一路拖到很长——这是第一版的 bug。
 */
export function wrap(text: string, width = WIDTH): string[] {
  const lines: string[] = [];
  let cur: Atom[] = [];
  let cw = 0;
  let lastBreak = -1;

  for (const a of atomize(text)) {
    cur.push(a);
    cw += a.w;
    if (a.breakAfter) lastBreak = cur.length - 1;

    if (cw > width && lastBreak >= 0) {
      lines.push(
        cur
          .slice(0, lastBreak + 1)
          .map((x) => x.s)
          .join('')
          .trim(),
      );
      cur = cur.slice(lastBreak + 1);
      cw = cur.reduce((n, x) => n + x.w, 0);
      lastBreak = -1;
    }
  }
  const tail = cur
    .map((x) => x.s)
    .join('')
    .trim();
  if (tail) lines.push(tail);
  return lines.filter(Boolean);
}

/** 折行后的续行缩进两格，才算同一个 bullet 里的内容 */
export function bullet(text: string): string {
  return '- ' + wrap(text).join('  \n  ');
}

export function para(text: string): string {
  return wrap(text).join('  \n');
}

// ------------------------------------------------------------------ 颜色

/** 只有这几个变量名是安全的：sanitizer 的正则不接受带数字的 var 名 */
export const COLOR = {
  term: 'var(--vscode-charts-blue)',
  interview: 'var(--vscode-charts-orange)',
  dim: 'var(--vscode-descriptionForeground)',
  error: 'var(--vscode-errorForeground)',
} as const;

/** 注意：color: 后面不能有空格，结尾必须有分号，否则整条 style 被丢掉 */
export function tint(color: string, text: string): string {
  return `<span style="color:${color};">${text}</span>`;
}

export function newMd(): vscode.MarkdownString {
  const m = new vscode.MarkdownString();
  // 内容里混进了模型输出，不能开全量 isTrusted——那会让任意 command: 链接可点，
  // 而模型读的是不可信的代码文件，一句注入就能变成可点的命令。
  // 只白名单放行我们自己的几个命令，而且它们**都不收参数**、只认当前编辑器的光标位置，
  // 所以哪怕模型真的吐出一个这样的链接，最坏结果也只是打开追问面板 / 重问一次。
  m.isTrusted = { enabledCommands: ['svPeek.ask', 'svPeek.refresh', 'svPeek.openSettings'] };
  m.supportHtml = true;
  m.supportThemeIcons = true;
  return m;
}

/**
 * 底部只留一个有用的东西：追问入口。
 *
 * 原来这里显示模型名/耗时/token，对读代码的人没有价值——想知道这些的只有调试的时候，
 * 所以降级成 `svPeek.showMeta` 开关，默认不显示。不画 `---` 分隔线：它上下各带一段
 * 外边距，白占两行高。
 */
export function footer(m: vscode.MarkdownString, meta?: string, refresh = false): void {
  const parts = ['[$(comment-discussion) 追问](command:svPeek.ask)'];
  // 「重问」只在答案可能不合意时才给：词表和缓存都是固定答案，绕过它们直接问模型
  if (refresh) parts.push('[$(refresh) 重问](command:svPeek.refresh)');
  if (meta) parts.push(tint(COLOR.dim, meta));
  m.appendMarkdown(`\n\n${parts.join('　')}`);
}

/**
 * 面试提示做成列表的最后一条，而不是 blockquote。
 * blockquote 自带上下外边距和左边框，单独占掉两三行高度；
 * 混在同一个紧凑列表里零额外高度，颜色已经够把它区分开了。
 */
export function interviewNote(text: string): string {
  return bullet(`${tint(COLOR.interview, '**面试**')} ${text}`);
}
