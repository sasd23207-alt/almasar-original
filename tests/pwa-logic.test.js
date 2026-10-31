"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const pure = html.match(/\/\/ <pure-logic>([\s\S]*?)\/\/ <\/pure-logic>/);
assert.ok(pure, "pure-logic block must exist");
const start = html.indexOf("const CURRENCY_WORDS =");
const end = html.indexOf("const BATCH_SIZE =", start);
assert.ok(start >= 0 && end > start, "local extractor section must exist");
const context = {};
vm.runInNewContext(pure[1] + "\n" + html.slice(start, end) + "\nglobalThis.__api = { localExtract };", context);
const extract = context.__api.localExtract;
const at = "2026-10-31T10:00:00";

test("recipient wording is classified as received", () => {
  const [item] = extract([{ id: "m1", at, sender: "Merchant", text: "حولتلي 300 دينار" }], ["Salem"]);
  assert.ok(item);
  assert.equal(item.direction, "received");
  assert.equal(item.amount, "300");
});

test("five thousand wording scales the amount", () => {
  const [item] = extract([{ id: "m2", at, sender: "Merchant", text: "حولتلي 5 الف دينار" }], ["Salem"]);
  assert.ok(item);
  assert.equal(item.amount, "5000");
  assert.equal(item.direction, "received");
});

test("ambiguous 1000 thousand is not proposed", () => {
  const items = extract([{ id: "m3", at, sender: "Merchant", text: "حولتلي 1000 الف دينار" }], ["Salem"]);
  assert.equal(items.length, 0);
});

test("two thousand word is normalized", () => {
  const [item] = extract([{ id: "m4", at, sender: "Merchant", text: "حولتلي الفين دينار" }], ["Salem"]);
  assert.ok(item);
  assert.equal(item.amount, "2000");
});
