"use strict";
/*
 * Autoフィールド移行の安全性の追加確認。
 * 1. 旧autoSourceと新Autoが同日にある場合、表示上は新Auto側の内容（件数）が正本になること
 * 2. Auto読み込み後、Plannerが保存するdata（JSON.stringify(store)相当）へAuto本体・
 *    Autoから合成した表示用questが混入しないこと。appStartDateの繰り上げだけは許容。
 * 実際にindex.htmlから setEikomiAuto/setKyotsuMathAuto/dispItems/dispQuests を
 * VMで取り出して実行し、mockではなく実関数で確認する。
 * 実行方法: node --test tests/*.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const L = require("../dq-leap-auto.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");

function extractFunction(name){
  const start = html.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + " が見つからない");
  let i = html.indexOf("{", start), depth = 0;
  for(; i < html.length; i++){
    if(html[i] === "{") depth++;
    else if(html[i] === "}"){ depth--; if(depth === 0) break; }
  }
  return html.slice(start, i + 1);
}

function makeContext(store){
  const persistCalls = [];
  const ctx = {
    DQLeapAuto: L,
    store: store,
    watchMode: false,
    leapAuto: {}, eikomiAuto: {}, kyotsuMathAuto: {},
    localStorage: { getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} },
    dayData: function(k){ return ctx.store.days[k] || { events: [], eventDone: {}, quests: [] }; },
    persist: function(){ persistCalls.push(true); }, // 実persist()の中身（cloud push含む）は今回のテスト対象外。呼ばれた回数だけ見る
    persistCalls: persistCalls
  };
  vm.createContext(ctx);
  ["setLeapAuto", "setEikomiAuto", "setKyotsuMathAuto", "mergedAutoSources", "dispQuests", "dispItems"].forEach(function(name){
    vm.runInContext(extractFunction(name), ctx);
  });
  return ctx;
}

function day(quests){ return { events: [], eventDone: {}, quests: quests }; }

// ---- 1. 旧autoSourceと新Autoが同日にある場合、新Auto側が表示上の正本になる ----

test("①eikomi：旧autoSource(3件相当)＋新eikomiAuto(count:8)が同日 → 表示は新Auto(8件相当)になり、dataは変更されない", function(){
  const store = {
    days: { "2026-09-26": day([
      { label: "英コミュ（自動記録）（本日3問）", done: true, tag: "英語", autoSource: "eikomi" },
      { label: "手動クエスト", done: false }
    ]) },
    appStartDate: "2026-08-01"
  };
  const ctx = makeContext(store);
  vm.runInContext("setEikomiAuto({ '2026-09-26': { count: 8, updatedAt: 100 } }, false);", ctx);
  const items = vm.runInContext("dispItems('2026-09-26')", ctx);

  assert.deepEqual(items.map(x => x.label), ["手動クエスト", "英コミュ（自動記録） 8問"], "表示は新Auto(8問)が正本になり、旧(3問)は出ない");
  assert.equal(items.filter(x => /英コミュ/.test(x.label)).length, 1, "英コミュ関連の表示は1件だけ（二重表示なし）");

  // data自体（store.days）は削除・変更されていないこと
  assert.deepEqual(store.days["2026-09-26"].quests, [
    { label: "英コミュ（自動記録）（本日3問）", done: true, tag: "英語", autoSource: "eikomi" },
    { label: "手動クエスト", done: false }
  ], "旧autoSourceエントリを含め、data(quests配列)は一切変更されない");
});

test("②kyotsu-math：旧autoSource(25件相当)＋新kyotsuMathAuto(count:40)が同日 → 表示は新Auto(40件相当)になり、dataは変更されない", function(){
  const store = {
    days: { "2026-09-26": day([
      { label: "kyotsu-math（自動記録）（本日25問）", done: true, tag: "数学", autoSource: "kyotsu-math" }
    ]) },
    appStartDate: "2026-08-01"
  };
  const ctx = makeContext(store);
  vm.runInContext("setKyotsuMathAuto({ '2026-09-26': { count: 40, updatedAt: 100 } }, false);", ctx);
  const items = vm.runInContext("dispItems('2026-09-26')", ctx);

  assert.deepEqual(items.map(x => x.label), ["kyotsu-math（自動記録） 40問"], "表示は新Auto(40問)が正本になり、旧(25問)は出ない");
  assert.deepEqual(store.days["2026-09-26"].quests, [
    { label: "kyotsu-math（自動記録）（本日25問）", done: true, tag: "数学", autoSource: "kyotsu-math" }
  ], "旧autoSourceエントリを含め、data(quests配列)は一切変更されない");
});

// ---- 2. Auto読み込み後、保存対象のdataへAuto本体・合成後questが混入しないこと ----

test("③eikomiAuto/kyotsuMathAutoを読み込んで表示合成しても、保存対象(JSON.stringify(store)相当)にAutoも合成questも混入しない", function(){
  const store = {
    days: {
      "2026-09-26": day([{ label: "手動クエスト", done: false }])
    },
    eventTypes: [{ id: "t1", label: "既存タイプ" }],
    presets: [{ id: "p1", label: "既存プリセット" }],
    appStartDate: "2026-08-01",
    _updatedAt: 12345
  };
  const beforeDaysJson = JSON.stringify(store.days);
  const beforePresetsJson = JSON.stringify(store.presets);
  const beforeAppStartDate = store.appStartDate;

  const ctx = makeContext(store);
  vm.runInContext("setEikomiAuto({ '2026-09-26': { count: 5, updatedAt: 1 } }, false);", ctx);
  vm.runInContext("setKyotsuMathAuto({ '2026-09-26': { count: 7, updatedAt: 1 } }, false);", ctx);
  // 表示合成（画面が実際に呼ぶのと同じ関数）を呼んでおく。呼んだだけでdataに影響しないことを確認する
  vm.runInContext("dispQuests('2026-09-26')", ctx);
  vm.runInContext("dispItems('2026-09-26')", ctx);

  // Plannerの実際の保存処理と同じシリアライズ（pushStoreSnapshot内: JSON.stringify(store)）
  const savedDataJson = JSON.stringify(store);

  assert.ok(!savedDataJson.includes("eikomiAuto"), "保存対象にeikomiAuto文字列が混入しない");
  assert.ok(!savedDataJson.includes("kyotsuMathAuto"), "保存対象にkyotsuMathAuto文字列が混入しない");
  assert.ok(!savedDataJson.includes("英コミュ（自動記録）"), "Autoから合成した表示用questのラベルが保存対象に混入しない");
  assert.ok(!savedDataJson.includes("kyotsu-math（自動記録）"), "Autoから合成した表示用questのラベルが保存対象に混入しない");

  // appStartDateの繰り上げは既存日付より新しいのでそもそも起きない（許容される繰り上げの範囲外＝不変であることを確認）
  assert.equal(store.appStartDate, beforeAppStartDate, "appStartDateより新しいAutoの日付では繰り上げが起きない");
  // 手動quest・presets・days本体はAuto読み込み・表示合成だけでは一切変化しない
  assert.equal(JSON.stringify(store.days), beforeDaysJson, "daysはAuto読み込み・表示合成だけでは変化しない（手動quest・done状態を含む）");
  assert.equal(JSON.stringify(store.presets), beforePresetsJson, "presetsはAuto読み込み・表示合成だけでは変化しない");
});

test("④appStartDateの繰り上げは、LEAPと同じ仕様でeikomiAuto/kyotsuMathAutoでも許容される（それ以外は不変）", function(){
  const store = {
    days: { "2026-09-26": day([{ label: "手動クエスト", done: false }]) },
    presets: [{ id: "p1", label: "既存プリセット" }],
    appStartDate: "2026-08-01",
    _updatedAt: 1
  };
  const beforeDaysJson = JSON.stringify(store.days);
  const beforePresetsJson = JSON.stringify(store.presets);

  const ctx = makeContext(store);
  // Autoの最古日がappStartDateより前 → appStartDateの繰り上げだけは許容される（LEAPと同じ仕様）
  vm.runInContext("setEikomiAuto({ '2026-07-01': { count: 2, updatedAt: 1 } }, false);", ctx);

  assert.equal(store.appStartDate, "2026-07-01", "eikomiAutoの最古日にappStartDateが繰り上がる（LEAPと同一仕様）");
  assert.equal(ctx.persistCalls.length, 1, "appStartDate変更に伴いpersist()が1回呼ばれる（watchModeでないため）");

  const savedDataJson = JSON.stringify(store);
  assert.ok(!savedDataJson.includes("eikomiAuto"), "appStartDate繰り上げ後もeikomiAuto本体は保存対象に混入しない");
  assert.equal(JSON.stringify(store.days), beforeDaysJson, "appStartDate以外のdaysは変化しない");
  assert.equal(JSON.stringify(store.presets), beforePresetsJson, "presetsは変化しない");
});
