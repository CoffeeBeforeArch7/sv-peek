/**
 * 指令写死在这里，是整个工具的立身之本——省掉的最大一步交互就是
 * "每次重新告诉 AI 我想要什么"。既然写死了，就能调到比通用聊天面板更准。
 */

/** 开场那句自动提问。它只是引子，不该显示在对话记录里 */
export const AUTO_ASK = '解释这个片段。';

export const SYSTEM = `你是 SystemVerilog / UVM 验证专家，帮人在读代码时快速看懂一个语法构造。

内容要求：
- 只解释「选中片段」，不要去解释上下文本身。
- 如果给的是整个文件，就**用上它**：该信号在哪声明、被谁驱动、这个句柄从哪来、
  这个宏展开后跟文件里哪段配合——这些跨行的联系正是单看一行想不明白的地方，
  有就说，并指明是文件里的哪一处。没有跨行联系就别硬凑。
- 说清它是干嘛的、机制上为什么要这么写、有什么坑。不要复述代码字面意思。
- 不要开场白、不要客套、不要「这段代码...」这种引子。

格式要求（严格遵守，输出会被直接渲染成弹窗）：
- 输出 2-4 条要点，每条独占一行、以「- 」开头。
- **每条不超过 25 个汉字**。说不完就拆成两条，不要写长句。
- 关键标识符用反引号包起来。不要用标题、不要嵌套列表、不要代码块。

- **不要写「面试：」开头的行，一行都不要。** 那类提示由本地词表负责，
  词表里的条目是人工挑过的，确实值得提醒才写。你这边只管把片段解释清楚。

示例输出：
- $sformatf 按格式串拼出一个 string 并返回
- 和 $display 的区别是它不打印，只给字符串
- 常用来拼日志宏的消息体`;

export interface UserOpts {
  fileName: string;
  languageId: string;
  snippet: string;
  context: string;
  /** context 是不是整个文件 */
  whole: boolean;
  /** 片段所在行号，1 起。整文件模式下靠它定位 */
  line: number;
}

/**
 * 整文件模式下，**文件内容必须排在最前面**。
 *
 * OpenAI 对 >=1024 token 的 prompt 前缀自动缓存，命中部分的输入便宜很多也快很多。
 * 同一个文件连着问好几处时，system + 文件正文这一大段是逐字不变的前缀，从第二问起
 * 就走缓存；把问题写在最后，变化的只有那几十个 token。
 *
 * 顺序反过来（问题在前、文件在后）前缀就每次都变，缓存一次都命中不了。
 */
export function buildUser(o: UserOpts): string {
  if (!o.whole) {
    return [
      `文件：${o.fileName}（languageId: ${o.languageId}）`,
      '',
      '它所在的上下文：',
      '```systemverilog',
      o.context,
      '```',
      '',
      '选中片段：',
      '```systemverilog',
      o.snippet,
      '```',
    ].join('\n');
  }

  return [
    `以下是文件 ${o.fileName} 的完整内容（languageId: ${o.languageId}）：`,
    '```systemverilog',
    o.context,
    '```',
    '',
    '---',
    '',
    `现在只解释第 ${o.line} 行里的这个片段，需要时可以引用文件里别处的声明、连接和调用：`,
    '```systemverilog',
    o.snippet,
    '```',
  ].join('\n');
}
