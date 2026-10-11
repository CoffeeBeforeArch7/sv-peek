/**
 * 一个输出通道，专门记每一步耗时。
 *
 * 加它的原因很具体：用户报「十几秒还没出来」，而独立脚本量下来网络 850ms、
 * 24000 字符的整文件请求 1.2s。也就是说慢在扩展内部某一步，但**光看现象猜不出是哪步**。
 * 与其继续猜，不如把每一步的 ms 打出来。
 */
import * as vscode from 'vscode';

let ch: vscode.OutputChannel | undefined;

export function init(ctx: vscode.ExtensionContext) {
  ch = vscode.window.createOutputChannel('SV Peek');
  ctx.subscriptions.push(ch);
}

export function show() {
  ch?.show(true);
}

function stamp(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds(),
  ).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export function log(msg: string) {
  ch?.appendLine(`${stamp()}  ${msg}`);
}

/** 分段计时器：每调一次 mark 就打出「距上一步」和「距开头」两个数 */
export function timer(label: string) {
  const t0 = Date.now();
  let last = t0;
  log(`── ${label}`);
  return {
    mark(step: string, extra = '') {
      const now = Date.now();
      log(`   ${String(now - last).padStart(6)}ms (+${String(now - t0).padStart(6)}ms)  ${step}${extra ? '  ' + extra : ''}`);
      last = now;
    },
    total() {
      return Date.now() - t0;
    },
  };
}
