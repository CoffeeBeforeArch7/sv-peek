// SV Peek 试手感用的样例。
//
// 玩法：把光标点进下面任意一个高亮的词里，按 ⌥` （不用选中）
//       或者选中一段，直接按 `（反引号，Tab 上面那个键）
//
// 带 ← 的行是词表命中（0ms），其它行会问模型（要先配好 API key，见 README），
// 两种手感对比着试。

`timescale 1ns/1ps
`include "uvm_macros.svh"

interface my_if (input logic clk, input logic rst_n);   // ← logic
  logic        valid;
  logic [31:0] data;

  clocking cb @(posedge clk);                           // ← clocking
    default input #1step output #1;
    output valid, data;
  endclocking

  modport tb (clocking cb, input clk, rst_n);           // ← modport
endinterface


class my_item extends uvm_sequence_item;
  `uvm_object_utils(my_item)                            // ← `uvm_object_utils

  rand bit        kind;                                 // ← rand
  rand bit [3:0]  len;                                  // ← rand
  randc bit [2:0] id;                                   // ← randc

  constraint c_len {                                    // ← constraint
    kind -> len == 0;
    solve kind before len;                              // ← solve before
  }

  function new(string name = "my_item");
    super.new(name);
  endfunction
endclass


class my_driver extends uvm_driver #(my_item);
  `uvm_component_utils(my_driver)                       // ← `uvm_component_utils

  virtual my_if vif;                                    // ← virtual interface

  function void build_phase(uvm_phase phase);
    super.build_phase(phase);                           // ← super.build_phase
    if (!uvm_config_db#(virtual my_if)::get(this, "", "vif", vif))  // ← uvm_config_db
      `uvm_fatal("NOVIF", "没拿到 virtual interface")   // ← `uvm_fatal
  endfunction

  task run_phase(uvm_phase phase);
    forever begin
      seq_item_port.get_next_item(req);
      `uvm_info("DRV", $sformatf("drive %0d", req.len), UVM_HIGH)   // ← `uvm_info
      fork                                              // ← fork / join_none
        automatic my_item cloned = req;                 // ← automatic
        drive_one(cloned);
      join_none
      seq_item_port.item_done();
    end
  endtask
endclass


class my_test extends uvm_test;
  task run_phase(uvm_phase phase);
    phase.raise_objection(this);                        // ← raise_objection
    // ... 跑 sequence ...
    phase.drop_objection(this);
  endtask
endclass


module checker (input logic clk, rst_n, req, gnt);
  // ← assert property / disable iff
  assert property (@(posedge clk) disable iff (!rst_n) req |=> gnt);

  covergroup cg @(posedge clk);                         // ← covergroup
    cp_req : coverpoint req { bins hi = {1}; bins lo = {0}; }   // ← bins
    x      : cross cp_req;                              // ← cross
  endgroup
endmodule
