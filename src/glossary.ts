/**
 * 本地词表 —— 三层缓存的第一层，命中就是 0ms、0 成本、0 网络。
 *
 * 为什么值得手写：SV/UVM 的关键字集合是有限的，读代码时「这是干嘛的」十有八九
 * 落在这几十个构造上。让模型每次重新生成一遍同样的解释，既慢又花钱，还不稳定。
 *
 * interview 字段不是装饰。DV 面试考的构造和实际写 testbench 常用的构造不是同一
 * 个集合，两边都标出来，才知道哪些该抠细节、哪些知道 why 就够。
 *
 * body 拆成 bullets 数组而不是整段：hover 窗口会横向撑到最长那一行的宽度，
 * 整段长句会把窗口拉得很宽。短 bullet + 渲染时按视觉宽度折行才读得舒服。
 */

export interface GlossaryHit {
  /** 显示用的规范写法，不一定等于用户选中的原文 */
  term: string;
  /** 一句话说清它是干嘛的 */
  gist: string;
  /** 2-4 条要点，每条一个独立事实。讲机制和坑，不复述代码字面意思 */
  bullets: string[];
  /** 面试视角：考不考、怎么考、值不值得抠 */
  interview?: string;
}

const G: Record<string, GlossaryHit> = {
  program: {
    term: 'program block',
    gist: 'SV 官方用来消除 TB/RTL 竞争的语法：块内代码调度到 Reactive region。',
    bullets: [
      'RTL 的 `always` 在 Active region 驱动，program 代码被推到 Reactive region，天然晚一步',
      '所以采到的一定是 RTL 已经稳定的值，不存在「谁先谁后看仿真器心情」的竞争',
      'program 内禁止写 `always`；所有 program 退出后仿真自动结束',
    ],
    interview:
      '概念层高频，但真实 UVM 环境几乎没人用——生命周期归 phase/objection 管，' +
      '采样时序靠 clocking block。**知道 why 就够，别抠 mechanics。**',
  },
  clocking: {
    term: 'clocking block',
    gist: '把一组信号绑到一个时钟上，统一规定什么时候采样、什么时候驱动。',
    bullets: [
      '`input` 在边沿**前** input skew 采样（默认 `1step`，即上一时间片的稳定值）',
      '`output` 在边沿**后** output skew 驱动',
      'TB 读写 `cb.sig` 就自动落在安全时刻，不用自己插 `#1` 之类的魔法延迟',
    ],
    interview:
      '高频且**要抠细节**——它天天用。问 skew 方向、为什么 `#1step` 能采到稳定值。',
  },
  'virtual interface': {
    term: 'virtual interface',
    gist: '指向真实 interface 实例的句柄，让 class 能碰到 module 层次的信号。',
    bullets: [
      'interface 是静态的、属于 module 层次，仿真开始就例化好；class 是运行时 new 出来的',
      '所以 class 里不能直接例化或引用 interface，只能拿句柄',
      'top 用 `uvm_config_db` set 进去，driver/monitor 在 `build_phase` get 出来',
    ],
    interview:
      '极高频。必追问「为什么 class 里不能直接用 interface」——答静态 vs 动态。',
  },
  randc: {
    term: 'randc',
    gist: '循环随机：一轮之内不重复，取值走完一遍才重新洗牌。',
    bullets: [
      '求解器维护一个取值排列，每次 randomize 取下一个，取完一轮重新随机排列',
      '只能用于 `bit` / `enum` 等**有限且位宽小**的类型，因为要显式维护整个取值空间',
    ],
    interview:
      '高频，和 `rand` 对比：rand 每次独立均匀，randc 一轮内不重复且不能用于大位宽。',
  },
  rand: {
    term: 'rand',
    gist: '声明该变量参与随机化，`randomize()` 时由约束求解器赋值。',
    bullets: [
      '每次 `randomize()` 独立求解，不保证不重复',
      '求解器同时满足该对象所有 active 的 `constraint` 块',
      '解不出来时返回 0——记得检查返回值，或写 `assert(obj.randomize())`',
    ],
  },
  'solve before': {
    term: 'solve ... before ...',
    gist: '给约束求解器的顺序提示，只改分布，不改合法解集合。',
    bullets: [
      '默认所有变量一起解、在联合解空间均匀取点，会把某些分支压到极低概率',
      '例：`a -> b == 0` 不加提示时，`a==1` 的概率只有 1/17',
      '写 `solve a before b` 先给 a 取值再解 b，概率回到 50/50',
    ],
    interview:
      '高频。标准答案：**不改合法解集合，只改概率分布**。能举出 1/17 那个例子就很稳。',
  },
  'disable iff': {
    term: 'disable iff',
    gist: 'SVA 的异步取消条件，通常写 `disable iff (!rst_n)`。',
    bullets: [
      '条件为真时，所有**正在评估中**的实例立刻置为 disabled，不 pass 也不 fail',
      '和写进前件不是一回事：`!rst_n |-> ...` 只挡**新开始**的检查',
      '复位来时已经跑到一半的多周期 property，靠前件挡不住，照样 fail',
    ],
    interview: '高频。考点就是上面这个区别——为什么必须用 `disable iff`。',
  },
  uvm_config_db: {
    term: 'uvm_config_db#(T)',
    gist: '跨层次传配置和虚接口的数据库，解决「怎么把东西送到深层组件手里」。',
    bullets: [
      '`set(cntxt, inst_name, field, value)` 写，`get(...)` 读，支持 `*` 通配',
      '典型：top 在 `build_phase` set 虚接口，driver 在 `build_phase` get',
      '能这么配合是因为 **build_phase 自顶向下执行**，父组件一定先于子组件跑完',
    ],
    interview:
      '极高频。追问 phase 顺序（build 是 top-down，connect 是 bottom-up）、get 失败要 `uvm_fatal`。',
  },
  '`uvm_info': {
    term: '`uvm_info(ID, MSG, VERBOSITY)',
    gist: '带 verbosity 等级的打印宏，可在运行时过滤。',
    bullets: [
      '等级 NONE/LOW/MEDIUM/HIGH/FULL/DEBUG，**不高于**当前设定值才打印',
      '命令行加 `+UVM_VERBOSITY=UVM_HIGH` 就能调，不用改代码重编译',
      'ID 是过滤用的标签，别所有地方都写同一个',
    ],
  },
  '`uvm_error': {
    term: '`uvm_error(ID, MSG)',
    gist: '报错并累加错误计数，仿真继续跑。',
    bullets: [
      '和 `` `uvm_fatal `` 的区别是**不终止仿真**',
      '默认超过 `set_max_quit_count` 才停',
      '测试过不过，最终看 report server 统计的 error/fatal 数',
    ],
  },
  '`uvm_component_utils': {
    term: '`uvm_component_utils(T)',
    gist: '把组件类注册进 UVM factory，并生成 `get_type_name` 等样板代码。',
    bullets: [
      '没有它，`T::type_id::create()` 和 factory override 都不工作',
      'factory 靠注册表按名字/类型找构造函数，注册是前提',
      '字段自动化版 `` `uvm_field_* `` 运行期开销大，大环境常手写替代',
    ],
    interview: '高频。接着问 factory override：不改环境代码就换掉某个组件或 transaction。',
  },
  '`uvm_object_utils': {
    term: '`uvm_object_utils(T)',
    gist: '同 `` `uvm_component_utils ``，但用于 uvm_object 派生类。',
    bullets: [
      '用在 sequence_item、sequence、config object 上',
      '构造函数不同：uvm_object 只有 `name`，component 是 `(name, parent)`',
      '两个宏生成的样板不同，用错会编译报错',
    ],
  },
  raise_objection: {
    term: 'raise_objection / drop_objection',
    gist: '挡住当前 phase 结束；所有 objection 归零，phase 才推进。',
    bullets: [
      'run_phase 是并行跑的，没有 objection 它会立刻结束',
      '一般只在**最顶层**的 sequence 或 test 里 raise/drop 一次',
      '层层 raise 会让「谁还没放手」极难排查；忘了 drop 的症状是挂死到 timeout',
    ],
    interview: '高频。问该在哪层 raise、忘了 drop 会怎样、`phase_ready_to_end` 干嘛的。',
  },
  join_none: {
    term: 'fork ... join_none',
    gist: 'fork 出的子进程立刻放行，父进程一行都不等。',
    bullets: [
      '`join` 等全部子进程，`join_any` 等任意一个，`join_none` 一个都不等',
      '配 `wait fork`（等所有后代结束）和 `disable fork`（杀掉所有后代）控制',
      '**经典坑**：循环里 fork 引用循环变量，各线程看到的是最终值，要 `automatic` 拷一份',
    ],
    interview: '高频。三者区别 + `automatic` 捕获坑，基本是成对出现的送分题。',
  },
  automatic: {
    term: 'automatic',
    gist: '每次进入作用域都新建一份变量；SV 里 module 作用域默认是 static。',
    bullets: [
      'class 内的方法默认就是 automatic',
      '但 module / program 里的 task、function 默认 static',
      'static 意味着多次并发调用共享同一份局部变量，会互相踩',
    ],
  },
  covergroup: {
    term: 'covergroup',
    gist: '功能覆盖率的采样容器，里面放 coverpoint / cross。',
    bullets: [
      '要么声明时绑事件自动采，要么手动调 `cg.sample()`',
      '必须 `new()` 出来才会真的采——只声明不例化是「覆盖率一直是 0」的常见原因',
    ],
    interview:
      '必考：功能覆盖率验需求测没测到，代码覆盖率验代码跑没跑到。后者 100% 不代表功能验完。',
  },
  bins: {
    term: 'bins',
    gist: 'coverpoint 的取值分桶，覆盖率 = 命中的 bin 数 / 总 bin 数。',
    bullets: [
      '`bins b[] = {[0:255]}` 自动拆成多个桶；`bins b = {[0:255]}` 只是一个桶',
      '`illegal_bins` 命中直接报错，`ignore_bins` 不计入分母',
    ],
  },
  cross: {
    term: 'cross',
    gist: '两个及以上 coverpoint 的交叉覆盖，验组合情况测没测到。',
    bullets: [
      'bin 数是各维度的乘积，容易爆炸，配 `ignore_bins` 裁掉不可能的组合',
      '交叉覆盖率往往才是真正说明问题的数——单个 coverpoint 全满不代表组合测过',
    ],
  },
  constraint: {
    term: 'constraint',
    gist: '约束块，限制 rand 变量的合法取值。',
    bullets: [
      '块内是**声明式**的，不是顺序执行：所有表达式同时成立',
      '常用 `inside`、`dist`（加权分布）、`->`（蕴含）、`if-else`',
      '`constraint_mode(0)` 临时关掉，`randomize() with {...}` 追加内联约束',
    ],
  },
  always_comb: {
    term: 'always_comb',
    gist: '组合逻辑的意图声明，敏感表自动推导，工具会检查是不是真的组合逻辑。',
    bullets: [
      '比 `always @*` 强：对块内调用的 function 里读到的信号也敏感',
      '在时间 0 自动执行一次',
      '写出锁存器（有路径没赋值）时工具会警告——这正是 `always @*` 抓不到的 bug',
    ],
  },
  always_ff: {
    term: 'always_ff',
    gist: '时序逻辑的意图声明，综合工具会检查是否真的推出触发器。',
    bullets: [
      '敏感表必须显式写：`@(posedge clk or negedge rst_n)`',
      '块内赋值的变量不允许被别的块再驱动，**编译期**就能抓到多驱动',
      '时序块里用非阻塞赋值 `<=`',
    ],
  },
  logic: {
    term: 'logic',
    gist: '四态（0/1/x/z）单驱动数据类型，取代大部分 reg/wire 的场合。',
    bullets: [
      '过程赋值和 `assign` 都能驱动它，不用再纠结 reg 还是 wire',
      '唯一限制是**只能有一个驱动源**',
      '需要多驱动（总线、三态）时才用 `wire` / `tri`',
    ],
    interview: '高频送分题：logic vs reg vs wire。答「单驱动限制」是关键区分点。',
  },
  'assert property': {
    term: 'assert property',
    gist: '并发断言：按时钟逐周期检查一条时序性质。',
    bullets: [
      '和立即断言 `assert()` 不同：在时钟边沿采样，可以跨多个周期',
      '骨架：`@(posedge clk) disable iff (!rst_n) req |=> gnt`',
      '`|->` 同周期蕴含，`|=>` 下一周期蕴含',
    ],
    interview: '高频。`|->` vs `|=>`、断言的采样时刻（Preponed region）都是常考点。',
  },
  '$rose': {
    term: '$rose / $fell / $stable / $past',
    gist: 'SVA 采样值函数，比较当前采样值和上一个时钟的采样值。',
    bullets: [
      '用 **Preponed region 的采样值**，不是实时值，不受同边沿变化干扰',
      '`$past(sig, n)` 取 n 个时钟之前的采样值，做「n 拍之后应该……」这类检查',
    ],
  },
  modport: {
    term: 'modport',
    gist: 'interface 里给不同使用方定义信号方向视图。',
    bullets: [
      '同一束信号，DUT 侧看到的 input 正是 TB 侧的 output',
      'modport 把方向固定下来，接错方向在**编译期**就报错',
      'TB 侧的 modport 常和 clocking block 一起用',
    ],
  },
  interface: {
    term: 'interface',
    gist: '把一束相关信号打包成一个整体，模块之间用一个端口连起来。',
    bullets: [
      '解决两件事：module 端口列表爆炸，以及连线时把信号接错位',
      '里面能放信号、task/function、assertion、`clocking` 块和 `modport`',
      '**interface 是静态的**，class 里只能拿 `virtual interface` 句柄',
    ],
  },
  get_next_item: {
    term: 'get_next_item / item_done',
    gist: 'driver 和 sequencer 之间的握手：取一个 item，处理完回一声。',
    bullets: [
      '`get_next_item(req)` 阻塞等下一个 item，`item_done()` 放行 sequence',
      '**必须成对**，漏掉 `item_done()` 会让 sequence 永远卡住',
      '回读数据用 `item_done(rsp)`；不想阻塞用 `try_next_item`',
    ],
    interview: '高频。问 `get_next_item` vs `try_next_item`，以及 driver 卡死怎么查。',
  },
  start_item: {
    term: 'start_item / finish_item',
    gist: 'sequence 里发一个 item 的标准三步：start_item → 随机化 → finish_item。',
    bullets: [
      '`start_item(req)` 向 sequencer 申请仲裁并阻塞等授权',
      '**拿到授权后才随机化**，放在之前 late randomization 就失去意义',
      '`finish_item(req)` 交给 driver；`` `uvm_do `` 是语法糖，藏了细节',
    ],
    interview: '高频。考点就是「为什么随机化要放在 start_item 之后」。',
  },
  'super.build_phase': {
    term: 'super.build_phase(phase)',
    gist: '调父类的同名 phase，漏掉会导致父类里的初始化不执行。',
    bullets: [
      '它负责自动配置：把 config_db 的值刷进 `` `uvm_field_* `` 注册的字段',
      '不调 super，这套自动化会**静默失效**，还不报错',
    ],
  },
};

/**
 * 别名：选中的词和词条 key 不一样，但问的是同一件事。
 * 比如选中 `join_any`，想知道的就是 fork/join 三兄弟的区别。
 */
const ALIAS: Record<string, string> = {
  fork: 'join_none',
  join: 'join_none',
  join_any: 'join_none',
  'wait fork': 'join_none',
  'disable fork': 'join_none',
  coverpoint: 'covergroup',
  illegal_bins: 'bins',
  ignore_bins: 'bins',
  inside: 'constraint',
  dist: 'constraint',
  constraint_mode: 'constraint',
  '$fell': '$rose',
  '$stable': '$rose',
  '$past': '$rose',
  always_latch: 'always_comb',
  'always @*': 'always_comb',
  wire: 'logic',
  reg: 'logic',
  bit: 'logic',
  '`uvm_fatal': '`uvm_error',
  '`uvm_warning': '`uvm_error',
  uvm_fatal: '`uvm_error',
  uvm_info: '`uvm_info',
  uvm_error: '`uvm_error',
  uvm_component_utils: '`uvm_component_utils',
  uvm_object_utils: '`uvm_object_utils',
  type_id: '`uvm_component_utils',
  drop_objection: 'raise_objection',
  objection: 'raise_objection',
  property: 'assert property',
  assert: 'assert property',
  cover: 'assert property',
  solve: 'solve before',
  vif: 'virtual interface',
  'clocking block': 'clocking',
  cb: 'clocking',
  endinterface: 'interface',
  item_done: 'get_next_item',
  try_next_item: 'get_next_item',
  finish_item: 'start_item',
  '`uvm_do': 'start_item',
  uvm_do: 'start_item',
};

/**
 * 按整段形状匹配。token 拆分对付不了「virtual my_if vif;」这种——
 * 首 token 是 `virtual`，但裸 `virtual` 又可能是 virtual function，不能直接做别名。
 */
const PATTERNS: [RegExp, string][] = [
  // virtual my_if vif;  /  virtual interface my_if vif;   但不吃 virtual function/task
  [/^virtual\s+(?:interface\s+)?\w+\s+\w+\s*;?$/, 'virtual interface'],
];

/**
 * 结构性关键字：它们出现在片段里只是语法骨架，不会是「想问的那个词」。
 * 不排除掉的话，选中整行 `if (!uvm_config_db#(...)::get(...))` 会卡在 `if` 上，
 * 漏掉真正想问的 `uvm_config_db`。
 */
const STOP = new Set([
  'if', 'else', 'for', 'while', 'do', 'begin', 'end', 'this', 'super', 'return',
  'void', 'new', 'null', 'function', 'endfunction', 'task', 'endtask',
  'module', 'endmodule', 'class', 'endclass', 'package', 'import', 'export',
  'int', 'integer', 'byte', 'shortint', 'longint', 'real', 'time', 'string',
  'parameter', 'localparam', 'typedef', 'enum', 'struct', 'union',
  'case', 'casez', 'casex', 'endcase', 'default', 'initial', 'final',
  'forever', 'repeat', 'foreach', 'break', 'continue',
  'posedge', 'negedge', 'edge', 'input', 'output', 'inout', 'ref',
  'const', 'static', 'extends', 'implements', 'pure', 'extern',
  'local', 'protected', 'public', 'assign', 'and', 'or', 'not',
]);

/**
 * 把选中的原文归一化成若干个候选 key，从最具体到最宽松依次尝试。
 * 例：`uvm_config_db#(virtual my_if)::set(null,"*","vif",vif);` → uvm_config_db
 */
export function candidates(raw: string): string[] {
  let s = raw.trim().toLowerCase();
  s = s.replace(/\s*#\s*\([^()]*\)/g, ''); // 去参数化 #(...)
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/[;,]+$/, '');
  const out = [s];

  const noArgs = s.replace(/\s*\([^()]*\)/g, '').replace(/[;,]+$/, '').trim();
  out.push(noArgs);

  const toks = noArgs.match(/`?[a-z_]\w*/g) ?? [];
  const first = toks[0];
  if (first) {
    out.push(first);
    if (first.startsWith('`')) out.push(first.slice(1));
    const second = toks[1];
    if (second) out.push(`${first} ${second}`);
    // solve a before b → "solve before"；fork ... join_none → "fork join_none"
    const third = toks[2];
    if (third) out.push(`${first} ${third}`);
  }
  // 最后兜底：逐个 token 试，跳过结构关键字。
  // 排在组合候选之后，所以「solve before」这种更具体的形状仍然优先命中。
  for (const t of toks) {
    if (!STOP.has(t)) out.push(t);
  }
  return [...new Set(out.filter(Boolean))];
}

export function lookup(raw: string): GlossaryHit | undefined {
  const flat = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const [re, key] of PATTERNS) {
    const entry = G[key];
    if (entry && re.test(flat)) return entry;
  }
  for (const key of candidates(raw)) {
    const direct = G[key];
    if (direct) return direct;
    const aliased = ALIAS[key];
    if (aliased && G[aliased]) return G[aliased];
  }
  return undefined;
}

export const size = Object.keys(G).length;
