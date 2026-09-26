"use strict";
/*
 * 見守りモード（保護者）の概要「今日の記録」カードが、子どものデータ＋LEAP自動記録で描き直されることのテスト。
 * 以前は loadWatchData() が renderRecords() しか呼ばず、起動時の空データの「0 / 0 クエスト完了」が残っていた。
 * index.html の実際の関数（renderResults / loadWatchData）をソースから取り出して、最小のDOMスタブで動かす。
 * 実行方法: node --test tests/*.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const L = require("../dq-leap-auto.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
// "function name(" から対応する閉じ括弧までを取り出す
function extractFunction(name){
  var start = html.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + " が見つからない");
  var i = html.indexOf("{", start), depth = 0;
  for(; i < html.length; i++){
    if(html[i] === "{")depth++;
    else if(html[i] === "}"){ depth--; if(depth === 0)break; }
  }
  return html.slice(start, i + 1);
}

function makeEl(){ return { textContent: "", innerHTML: "", style: {}, className: "", setAttribute: function(){} }; }
function makeContext(store, leapAuto, today){
  var els = {};
  ["questCount", "resultHeadline", "ringValue", "ringFill", "ringDot", "homeSummary", "watchSyncNote"].forEach(function(id){ els[id] = makeEl(); });
  var calls = [];
  var ctx = {
    document: { getElementById: function(id){ return els[id] || null; } },
    Math: Math, JSON: JSON, DQLeapAuto: L,
    store: store, leapAuto: leapAuto, eikomiAuto: {}, kyotsuMathAuto: {}, activeDate: today, watchMode: false,
    dayData: function(k){ return ctx.store.days[k] || { events: [], eventDone: {}, quests: [] }; },
    todaySystemKey: function(){ return today; },
    parseKey: function(k){ var a = k.split("-"); return new Date(+a[0], +a[1] - 1, +a[2]); },
    renderRecords: function(){ calls.push("renderRecords"); },
    renderProgressCard: function(){ calls.push("renderProgressCard"); },
    persist: function(){ calls.push("persist"); },
    calls: calls, els: els
  };
  ctx.dispItems = function(k){ return L.displayItems(ctx.dayData(k).quests, ctx.leapAuto, k); };
  ctx.setLeapAuto = function(raw){ ctx.leapAuto = L.normalizeLeapAuto(raw); };
  ctx.setEikomiAuto = function(raw){ ctx.eikomiAuto = L.sources.eikomi.normalize(raw); };
  ctx.setKyotsuMathAuto = function(raw){ ctx.kyotsuMathAuto = L.sources.kyotsuMath.normalize(raw); };
  vm.createContext(ctx);
  vm.runInContext(extractFunction("renderResults"), ctx);
  return ctx;
}

const TODAY = "2026-09-24";
const LEAP = { "2026-09-24": { date: "2026-09-24", source: "leap", count: 43, updatedAt: 1 } };

test("見守り：子どものデータ（通常クエスト0件）＋LEAP自動記録1件 →「今日の記録」は 1 / 1（0 / 0 のまま残らない）", async function(){
  var ctx = makeContext({ days: {} }, {}, TODAY);
  ctx.els.resultHeadline.textContent = "0 / 0";          // 起動時の空データで描かれた状態
  var child = { days: {}, appStartDate: "2026-07-09" };
  ctx.FirebaseSync = { CHILD_UID: "child", pullLogs: function(){ return Promise.resolve({ data: JSON.stringify(child), leapAuto: LEAP }); } };
  ctx.window = { FirebaseSync: ctx.FirebaseSync };
  vm.runInContext("var calView,heatmapView,selectedRecordDate,store;", ctx);
  ctx.store = { days: {} };
  vm.runInContext(extractFunction("loadWatchData"), ctx);
  await vm.runInContext("loadWatchData()", ctx);
  await new Promise(function(r){ setImmediate(r); });
  assert.equal(ctx.els.resultHeadline.textContent, "1 / 1");
  assert.equal(ctx.els.questCount.textContent, "1 / 1 クリア");
  assert.equal(ctx.els.ringValue.textContent, "100%");
  assert.deepEqual(ctx.calls.filter(function(c){ return c !== "persist"; }), ["renderRecords", "renderProgressCard"], "記録画面と今日の記録カードだけを描き直す（全面再描画しない）");
});

test("見守り：通常クエスト1件（未完了）＋LEAP自動記録1件 → 1 / 2、通常クエスト完了なら 2 / 2", function(){
  var store = { days: {} };
  store.days[TODAY] = { events: [], eventDone: {}, quests: [{ label: "数学ワーク", done: false }] };
  var ctx = makeContext(store, L.normalizeLeapAuto(LEAP), TODAY);
  vm.runInContext("renderResults()", ctx);
  assert.equal(ctx.els.resultHeadline.textContent, "1 / 2");
  assert.equal(ctx.els.ringValue.textContent, "50%");
  store.days[TODAY].quests[0].done = true;
  vm.runInContext("renderResults()", ctx);
  assert.equal(ctx.els.resultHeadline.textContent, "2 / 2");
});

test("通常モードの表示フローは変えない（renderHome は従来どおり renderResults/renderProgressCard を呼ぶ）", function(){
  var home = extractFunction("renderHome");
  assert.match(home, /renderQuests\(\);\n  renderResults\(\);\n  renderProgressCard\(\);/);
  var watch = extractFunction("loadWatchData");
  assert.match(watch, /renderRecords\(\);[\s\S]*renderResults\(\);\n    renderProgressCard\(\);/);
  assert.doesNotMatch(watch, /renderAllScreens\(\)|renderHome\(\)/, "見守りで全面再描画しない");
});
