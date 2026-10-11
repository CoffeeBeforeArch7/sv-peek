/**
 * OpenAI 兼容端点的单次调用。不流式——hover 内容是快照，边流边刷会闪，
 * 答案又限死 2-4 行，非流式 ~1s 就回来了，没必要。
 *
 * 这里的两条分支是真实 API 报错换来的，不是猜的：
 *   1. 参数名是 max_completion_tokens，不是 max_tokens。gpt-5 系列收到 max_tokens
 *      直接 400「Use max_completion_tokens instead」，而 gpt-4.1 两个都收——
 *      所以无条件用前者。
 *   2. temperature 没这么好运，只能按模型名认。gpt-5.6 实测回
 *      「Unsupported value: 'temperature'」，gpt-5.4-mini 和 gpt-4.1 都收。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as log from './log';

export class LLMError extends Error {}

/** 这些模型收到 temperature 会 400，名单按前缀匹配 */
const NO_TEMPERATURE = ['gpt-5.6', 'gpt-6', 'o1', 'o3', 'o4'];

function rejectsTemperature(model: string): boolean {
  const m = model.toLowerCase();
  return NO_TEMPERATURE.some((p) => m.startsWith(p));
}

/**
 * key 来源，按优先级：设置里写死 > 环境变量 > key 文件（JSON，路径留空就不读）。
 *
 * 环境变量这条在 GUI 启动的 VSCode 里多半是空的——从 Dock 点开的进程不继承
 * 你 shell 里 export 的东西。不想把 key 明文写进 settings.json，就用 key 文件。
 */
export function resolveApiKey(cfg: vscode.WorkspaceConfiguration): string {
  const inSettings = (cfg.get<string>('apiKey', '') || '').trim();
  if (inSettings) return inSettings;

  const envName = cfg.get<string>('apiKeyEnv', 'OPENAI_API_KEY');
  const fromEnv = (process.env[envName] || '').trim();
  if (fromEnv) return fromEnv;

  const file = cfg.get<string>('apiKeyFile', '');
  const field = cfg.get<string>('apiKeyFileField', 'llm_api_key');
  if (!file) return '';
  const abs = file.startsWith('~') ? path.join(os.homedir(), file.slice(1)) : file;
  try {
    const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (data && typeof data === 'object') {
      const v = data[field];
      if (typeof v === 'string') return v.trim();
    }
  } catch {
    // 文件不存在 / 不是 JSON / 没这个字段，都当"没拿到"，由调用方报错
  }
  return '';
}

export interface AskResult {
  text: string;
  ms: number;
  /** 输入 token */
  inTok: number;
  /** 其中命中前缀缓存的部分。同一个文件连问时这个数会很大 */
  cachedTok: number;
  /** 输出 token */
  outTok: number;
}

export interface Msg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function ask(
  cfg: vscode.WorkspaceConfiguration,
  system: string,
  user: string,
  token?: vscode.CancellationToken,
): Promise<AskResult> {
  return askMessages(cfg, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], token);
}

/**
 * 多轮版本。追问面板用这个——把整段对话发回去，模型才知道「它」指的是什么。
 *
 * 顺带一个好处：前面那些轮次是不变的前缀，追问时整段对话都能吃到前缀缓存，
 * 所以追问的边际成本比看上去低得多。
 */
export async function askMessages(
  cfg: vscode.WorkspaceConfiguration,
  messages: Msg[],
  token?: vscode.CancellationToken,
): Promise<AskResult> {
  const key = resolveApiKey(cfg);
  if (!key) {
    // env.remoteName 只在 workspace 扩展宿主里有值。有值 = 这个扩展被装到远程去了，
    // 那它读的是远程服务器的家目录，当然找不到本机那把 key
    const onRemote = !!vscode.env.remoteName;
    throw new LLMError(
      '没拿到 API key。三选一：设置里填 `svPeek.apiKey`、' +
        '导出环境变量 `OPENAI_API_KEY`、或在 `svPeek.apiKeyFile` 里填一个 JSON 文件的路径、' +
        '文件里放 `llm_api_key`。' +
        (onRemote
          ? `\n\n**注意：这个扩展正跑在远程（${vscode.env.remoteName}）上**，` +
            '读的是远程服务器的家目录，不是你本机的。' +
            '正常应该跑在本地——去扩展面板把「SSH: ...」那一侧的 SV Peek 卸载掉，' +
            '只保留「本地 - 已安装」里的那个。'
          : ''),
    );
  }

  const model = cfg.get<string>('model', 'gpt-5.4-mini');
  const baseUrl = cfg.get<string>('baseUrl', 'https://api.openai.com/v1').replace(/\/+$/, '');

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    // 追问要展开讲，不能被 hover 那条 300 的上限卡住
    max_completion_tokens: cfg.get<number>('maxTokens', 300) * (messages.length > 2 ? 3 : 1),
  };
  const temperature = cfg.get<number | null>('temperature', 0.2);
  if (temperature !== null && temperature !== undefined && !rejectsTemperature(model)) {
    body['temperature'] = temperature;
  }

  log.log(`   → POST ${baseUrl}/chat/completions  model=${model}  body=${JSON.stringify(body).length} 字符`);
  const ac = new AbortController();
  const timeoutMs = cfg.get<number>('timeoutMs', 20000);
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const cancelSub = token?.onCancellationRequested(() => ac.abort());
  const t0 = Date.now();

  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });

    log.log(`   ← 响应头 ${Date.now() - t0}ms  HTTP ${r.status}`);
    if (!r.ok) {
      const detail = (await r.text().catch(() => '')).slice(0, 300);
      throw new LLMError(`HTTP ${r.status} ${r.statusText}\n\n${detail}`);
    }

    const body0 = Date.now();
    const data = (await r.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    log.log(`   ← 读完 body +${Date.now() - body0}ms`);
    const choice = data.choices?.[0];
    const text = (choice?.message?.content ?? '').trim();
    if (!text) {
      // 空回复最常见的原因是 max_completion_tokens 被推理 token 吃光了
      const why = choice?.finish_reason ? `（finish_reason: ${choice.finish_reason}）` : '';
      throw new LLMError(`模型返回空内容${why}。试试把 \`svPeek.maxTokens\` 调大。`);
    }
    return {
      text,
      ms: Date.now() - t0,
      inTok: data.usage?.prompt_tokens ?? 0,
      cachedTok: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outTok: data.usage?.completion_tokens ?? 0,
    };
  } catch (e) {
    if (e instanceof LLMError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new LLMError(token?.isCancellationRequested ? '已取消' : `超时（${timeoutMs}ms）`);
    }
    throw new LLMError(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    cancelSub?.dispose();
  }
}

export function modelLabel(cfg: vscode.WorkspaceConfiguration): string {
  return cfg.get<string>('model', 'gpt-5.4-mini');
}
