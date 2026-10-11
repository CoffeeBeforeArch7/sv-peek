/**
 * 第 2 层缓存：模型答案按归一化片段做 key，存 globalState，跨窗口跨会话都留着。
 *
 * 词表（第 1 层）解决的是"这个构造人人都问"，这一层解决的是"这个工程里的这段代码
 * 我上周问过"。两层加起来，真正付钱的调用没几次。
 */
import * as vscode from 'vscode';

const KEY = 'svPeek.answers.v1';
const MAX_ENTRIES = 500;
/** LRU 的时间戳不用那么精确。每次读都回写 500 条的整个 store 是白费的磁盘活 */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
/** key 里分隔模型名和片段用，普通代码和模型名里都不会出现 */
const SEP = ' >>> ';

interface Entry {
  a: string;
  /** 最后一次用到的时间，用来按 LRU 裁剪 */
  t: number;
}

type Store = Record<string, Entry>;

/**
 * key 要把无关差异抹掉，但不能抹掉语义。
 *
 * scope 是给整文件模式用的：那种模式下答案会引用这个文件里别处的代码，
 * 换个文件同样的片段就是另一个答案，不能共用。窗口模式传空串，
 * 让常见片段能跨文件复用。
 */
export function cacheKey(model: string, snippet: string, scope = ''): string {
  return model + SEP + scope + SEP + snippet.trim().replace(/\s+/g, ' ');
}

/** 文件内容的指纹。只是用来在文件改了以后让缓存失效，不需要抗碰撞 */
export function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + '.' + text.length.toString(36);
}

export function get(ctx: vscode.ExtensionContext, key: string): string | undefined {
  const store = ctx.globalState.get<Store>(KEY, {});
  const hit = store[key];
  if (!hit) return undefined;
  // 读也算用过一次，否则常用条目会被当成旧条目裁掉。
  // 但不必每次都回写——只有时间戳确实旧了才落盘。
  const now = Date.now();
  if (now - hit.t > TOUCH_INTERVAL_MS) {
    hit.t = now;
    void ctx.globalState.update(KEY, store);
  }
  return hit.a;
}

export function put(ctx: vscode.ExtensionContext, key: string, answer: string): void {
  const store = ctx.globalState.get<Store>(KEY, {});
  store[key] = { a: answer, t: Date.now() };

  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((x, y) => (store[x]?.t ?? 0) - (store[y]?.t ?? 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete store[k]);
  }
  void ctx.globalState.update(KEY, store);
}

export function clear(ctx: vscode.ExtensionContext): number {
  const n = Object.keys(ctx.globalState.get<Store>(KEY, {})).length;
  void ctx.globalState.update(KEY, {});
  return n;
}

export function size(ctx: vscode.ExtensionContext): number {
  return Object.keys(ctx.globalState.get<Store>(KEY, {})).length;
}
