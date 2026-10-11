/**
 * 词表匹配的回归用例。纯 node，不引框架——就三十来条断言，不值得为它装一套测试库。
 *
 * 跑法：npm test（会先编译）
 *
 * 负例和正例一样重要：用户自定义的代码必须 miss，miss 才会走模型。
 * 误命中比没命中糟得多——它会理直气壮地答错。
 */
const { lookup, size } = require('../out/glossary.js');

const CASES = [
  // ---- 单词直命中
  ['program', 'program block'],
  ['randc bit [2:0] id;', 'randc'],
  ['automatic', 'automatic'],
  ['always_comb', 'always_comb'],
  ['logic [31:0] data;', 'logic'],
  ['covergroup cg @(posedge clk);', 'covergroup'],
  ['clocking cb @(posedge clk);', 'clocking block'],
  ['interface my_if (input logic clk);', 'interface'],

  // ---- 别名
  ['`uvm_fatal', '`uvm_error(ID, MSG)'],
  ['join_none', 'fork ... join_none'],
  ['for (int i = 0; i < N; i++) fork', 'fork ... join_none'],
  ['$past(sig, 2)', '$rose / $fell / $stable / $past'],

  // ---- 多词形状（组合候选要优先于单 token）
  ['solve kind before len;', 'solve ... before ...'],
  ['disable iff (!rst_n)', 'disable iff'],
  ['assert property (@(posedge clk) disable iff (!rst_n) req |=> gnt);', 'assert property'],

  // ---- 参数化 / 作用域 / 成员调用要能剥干净
  ['uvm_config_db#(virtual my_if)::get(this, "", "vif", vif)', 'uvm_config_db#(T)'],
  ['`uvm_info("DRV", "x", UVM_HIGH)', '`uvm_info(ID, MSG, VERBOSITY)'],
  ['`uvm_component_utils(my_driver)', '`uvm_component_utils(T)'],
  ['phase.raise_objection(this);', 'raise_objection / drop_objection'],
  ['seq_item_port.get_next_item(req);', 'get_next_item / item_done'],
  ['start_item(req);', 'start_item / finish_item'],
  ['super.build_phase(phase);', 'super.build_phase(phase)'],

  // ---- 结构关键字不能挡住真正想问的词
  ['if (!uvm_config_db#(virtual my_if)::get(this, "", "vif", vif))', 'uvm_config_db#(T)'],

  // ---- PATTERNS：声明形状要认，但不能吃掉 virtual function/task
  ['virtual my_if vif;', 'virtual interface'],
  ['virtual interface my_if m_vif;', 'virtual interface'],
  ['virtual function void do_copy(uvm_object rhs);', null],
  ['virtual task body();', null],

  // ---- 负例：用户自己的代码必须 miss
  ['my_custom_task(a, b, c);', null],
  ['function void build_phase(uvm_phase phase);', null],
  ['drv = my_driver::type_id::create("drv", this);', '`uvm_component_utils(T)'],
];

let failed = 0;
for (const [input, want] of CASES) {
  const hit = lookup(input);
  const got = hit ? hit.term : null;
  if (got !== want) {
    failed++;
    console.log(`FAIL  ${JSON.stringify(input)}\n      want ${want}\n      got  ${got}`);
  }
}

// 每个词条都得有 term/gist/bullets，interview 可选
const { lookup: _l } = require('../out/glossary.js');
for (const [input] of CASES) {
  const hit = _l(input);
  if (!hit) continue;
  if (!hit.term || !hit.gist || !Array.isArray(hit.bullets) || !hit.bullets.length) {
    failed++;
    console.log(`FAIL  词条结构不完整: ${hit.term}`);
  }
}

console.log(`${CASES.length} 条用例，词表 ${size} 条 —— ${failed ? `${failed} 条失败` : '全部通过'}`);
process.exit(failed ? 1 : 0);
