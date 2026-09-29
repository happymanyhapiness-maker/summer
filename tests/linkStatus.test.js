"use strict";
/*
 * 見守り（保護者）の概要「アプリとの連携」：各アプリの最終記録・最終同期を出して、連携が止まっていたら気づけるようにする（表示専用）。
 *   最終記録：leapAuto/eikomiAuto/kyotsuMathAuto の最新の日付と updatedAt
 *   最終同期：英コミュ・数学の要約ドキュメント（eikomi-summary / kyotsu-math-summary）の updatedAt。LEAPには無い
 *   72時間以上同期が無い（英コミュ・数学）ときだけ黄色。学習していないだけの場合もあるので文言は断定しない
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
  var start = html.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + " が見つからない");
  var i = html.indexOf("{", start), depth = 0;
  for(; i < html.length; i++){
    if(html[i] === "{")depth++;
    else if(html[i] === "}"){ depth--; if(depth === 0)break; }
  }
  return html.slice(start, i + 1);
}

const H = 3600 * 1000;
// JST → epoch ms
const jst = function(y, m, d, hh, mm){ return Date.UTC(y, m - 1, d, hh - 9, mm || 0); };
const NOW = jst(2026, 9, 29, 22, 30);
const maps = function(o){
  o = o || {};
  return {
    leap: L.sources.leap.normalize(o.leap || {}),
    eikomi: L.sources.eikomi.normalize(o.eikomi || {}),
    kyotsuMath: L.sources.kyotsuMath.normalize(o.kyotsuMath || {})
  };
};
const rowOf = function(rows, key){ return rows.filter(function(r){ return r.key === key; })[0]; };

// ---- 純関数 ----
test("①最終記録：各アプリの最新の日付と、その中で最も新しい updatedAt。並びは LEAP → 英コミュ → 数学", function(){
  var m = maps({
    leap: { "2026-09-24": { count: 43, updatedAt: 100 }, "2026-09-25": { count: 4, updatedAt: 500 } },
    eikomi: { "2026-09-25": { count: 3, updatedAt: 700 }, "2026-09-28": { count: 1, updatedAt: 600 } },   // 日付が新しい方が updatedAt は小さくてもよい（各々の最大を取る）
    kyotsuMath: { "2026-09-28": { count: 8, updatedAt: 900 } }
  });
  var rows = L.summarizeLinks(m, {}, NOW);
  assert.deepEqual(rows.map(function(r){ return r.key; }), ["leap", "eikomi", "kyotsuMath"]);
  assert.deepEqual(rows.map(function(r){ return r.label; }), ["LEAP単語帳", "英コミュ", "数学"]);
  assert.equal(rowOf(rows, "leap").lastRecordDate, "2026-09-25");
  assert.equal(rowOf(rows, "leap").lastRecordAt, 500);
  assert.equal(rowOf(rows, "eikomi").lastRecordDate, "2026-09-28");
  assert.equal(rowOf(rows, "eikomi").lastRecordAt, 700);
  assert.equal(rowOf(rows, "kyotsuMath").lastRecordDate, "2026-09-28");
});
test("②記録がまだ無いアプリ・入力が空でも壊れない", function(){
  var rows = L.summarizeLinks(undefined, undefined, NOW);
  rows.forEach(function(r){ assert.equal(r.lastRecordDate, ""); assert.equal(r.lastRecordAt, 0); assert.equal(r.stale, false); });
  var rows2 = L.summarizeLinks({ leap: null, eikomi: {}, kyotsuMath: undefined }, { eikomi: null }, NOW);
  assert.equal(rows2.length, 3);
});
test("③最終同期は英コミュ・数学だけ（LEAPには無い）。ハートビートが無い・不正なら 0（不明）で、警告は出さない", function(){
  var rows = L.summarizeLinks(maps(), { eikomi: NOW - H, kyotsuMath: null, leap: NOW - 1 }, NOW);
  assert.equal(rowOf(rows, "leap").hasSync, false);
  assert.equal(rowOf(rows, "leap").lastSyncAt, 0, "LEAPのハートビートは見ない");
  assert.equal(rowOf(rows, "eikomi").lastSyncAt, NOW - H);
  assert.equal(rowOf(rows, "kyotsuMath").hasSync, true);
  assert.equal(rowOf(rows, "kyotsuMath").lastSyncAt, 0);
  assert.equal(rowOf(rows, "kyotsuMath").stale, false, "不明は警告しない");
  var bad = L.summarizeLinks(maps(), { eikomi: "x", kyotsuMath: -5 }, NOW);
  assert.equal(rowOf(bad, "eikomi").lastSyncAt, 0);
  assert.equal(rowOf(bad, "kyotsuMath").lastSyncAt, 0);
});
test("④警告（stale）は最終同期が72時間以上前の英コミュ・数学だけ。ちょうど72時間は警告、71時間59分は警告なし", function(){
  assert.equal(L.LINK_STALE_MS, 72 * H);
  var rows = L.summarizeLinks(maps(), { eikomi: NOW - 72 * H, kyotsuMath: NOW - 72 * H + 60000 }, NOW);
  assert.equal(rowOf(rows, "eikomi").stale, true);
  assert.equal(rowOf(rows, "kyotsuMath").stale, false);
  // LEAPは最終記録が何日前でも警告しない（学習していないだけかもしれない）
  var old = L.summarizeLinks(maps({ leap: { "2026-06-29": { count: 1, updatedAt: 1 } } }), {}, NOW);
  assert.equal(rowOf(old, "leap").stale, false);
  // 記録が古くても、同期が最近なら警告しない（アプリは動いている）
  var fresh = L.summarizeLinks(maps({ eikomi: { "2026-09-01": { count: 1, updatedAt: 1 } } }), { eikomi: NOW - H }, NOW);
  assert.equal(rowOf(fresh, "eikomi").stale, false);
});
test("⑤時刻の表記：JST固定「M/D HH:MM（◯前）」。1分未満・未来はたった今、分・時間・日", function(){
  var t = jst(2026, 9, 29, 22, 4);
  assert.equal(L.linkTimeText(t, NOW), "9/29 22:04（26分前）");
  assert.equal(L.linkTimeText(t, t + 30 * 1000), "9/29 22:04（たった今）");
  assert.equal(L.linkTimeText(t, t - 5 * 60000), "9/29 22:04（たった今）", "端末の時計が遅れて未来になっても崩れない");
  assert.equal(L.linkTimeText(t, t + 3 * H + 10 * 60000), "9/29 22:04（3時間前）");
  assert.equal(L.linkTimeText(t, t + 23 * H + 59 * 60000), "9/29 22:04（23時間前）");
  assert.equal(L.linkTimeText(t, t + 24 * H), "9/29 22:04（1日前）");
  assert.equal(L.linkTimeText(t, t + 100 * H), "9/29 22:04（4日前）");
  assert.equal(L.linkTimeText(jst(2026, 10, 1, 0, 5), NOW), "10/1 00:05（たった今）", "JSTの日付またぎ（UTCでは前日）");
  assert.equal(L.linkTimeText(0, NOW), "");
  assert.equal(L.linkTimeText("x", NOW), "");
});

// ---- 実際の画面関数（index.html） ----
function makeScreen(o){
  o = o || {};
  var el = { innerHTML: "" };
  var ctx = {
    document: { getElementById: function(id){ return id === "linkStatusList" ? el : null; } },
    Date: { now: function(){ return NOW; } }, JSON: JSON, Promise: Promise,
    DQLeapAuto: L, leapAuto: {}, eikomiAuto: {}, kyotsuMathAuto: {}, linkHeartbeats: {}, el: el
  };
  var m = maps(o.maps);
  ctx.leapAuto = m.leap; ctx.eikomiAuto = m.eikomi; ctx.kyotsuMathAuto = m.kyotsuMath;
  if(o.heartbeats) ctx.linkHeartbeats = o.heartbeats;
  ctx.window = { FirebaseSync: o.sync };
  vm.createContext(ctx);
  vm.runInContext("var linkHeartbeats = " + JSON.stringify(ctx.linkHeartbeats) + ";", ctx);
  vm.runInContext(extractFunction("renderLinkStatus") + "\n" + extractFunction("loadLinkHeartbeats"), ctx);
  return ctx;
}
const REC = {
  leap: { "2026-09-25": { count: 4, updatedAt: jst(2026, 9, 25, 7, 55) } },
  eikomi: { "2026-09-28": { count: 1, updatedAt: jst(2026, 9, 29, 22, 4) } },
  kyotsuMath: { "2026-09-28": { count: 8, updatedAt: jst(2026, 9, 29, 22, 4) } }
};
test("⑥表示：アプリごとに1行。英コミュ・数学は最終同期＋最終記録、LEAPは最終記録だけ", function(){
  var s = makeScreen({ maps: REC, heartbeats: { eikomi: jst(2026, 9, 29, 22, 4), kyotsuMath: jst(2026, 9, 29, 22, 6) } });
  vm.runInContext("renderLinkStatus()", s);
  var out = s.el.innerHTML;
  assert.match(out, /LEAP単語帳<\/b>[\s\S]*最終記録 9\/25 07:55（4日前）/);
  assert.ok(!/LEAP単語帳<\/b>[\s\S]{0,300}最終同期/.test(out.split("英コミュ")[0]), "LEAPに最終同期は出ない");
  assert.match(out, /英コミュ<\/b>[\s\S]*最終同期 9\/29 22:04（26分前）<br>最終記録 9\/29 22:04（26分前）/);
  assert.match(out, /数学<\/b>[\s\S]*最終同期 9\/29 22:06（24分前）/);
  assert.ok(!/同期の記録がありません/.test(out), "警告なし");
});
test("⑦記録もハートビートも無い → 「記録はまだありません」「最終同期 不明」。警告なし", function(){
  var s = makeScreen({});
  vm.runInContext("renderLinkStatus()", s);
  assert.equal((s.el.innerHTML.match(/記録はまだありません/g) || []).length, 3);
  assert.equal((s.el.innerHTML.match(/最終同期 不明/g) || []).length, 2, "英コミュ・数学だけ");
  assert.ok(!/同期の記録がありません/.test(s.el.innerHTML));
});
test("⑧72時間以上同期が無いアプリだけ黄色＋文言（断定しない）。LEAPは対象外", function(){
  var s = makeScreen({ maps: REC, heartbeats: { eikomi: NOW - 80 * H, kyotsuMath: NOW - H } });
  vm.runInContext("renderLinkStatus()", s);
  var out = s.el.innerHTML;
  assert.match(out, /英コミュ：3日以上、同期の記録がありません（学習していない場合は問題ありません）/);
  assert.ok(!/数学：3日以上/.test(out) && !/LEAP単語帳：3日以上/.test(out));
  var s2 = makeScreen({ maps: REC, heartbeats: { eikomi: NOW - 80 * H, kyotsuMath: NOW - 90 * H } });
  vm.runInContext("renderLinkStatus()", s2);
  assert.match(s2.el.innerHTML, /英コミュ・数学：3日以上、同期の記録がありません/);
});
test("⑨要約ドキュメントを読む：updatedAt をハートビートにして描き直す。取れない・エラーでも例外にならず最終記録は残る", async function(){
  var pulled = [];
  var s = makeScreen({ maps: REC, sync: {
    pullEikomiSummary: function(){ pulled.push("eikomi"); return Promise.resolve({ updatedAt: jst(2026, 9, 29, 22, 4), todayCount: 0 }); },
    pullKyotsuMathSummary: function(){ pulled.push("math"); return Promise.resolve({ updatedAt: jst(2026, 9, 29, 22, 6) }); }
  } });
  await vm.runInContext("loadLinkHeartbeats()", s);
  assert.deepEqual(pulled, ["eikomi", "math"]);
  assert.match(s.el.innerHTML, /英コミュ<\/b>[\s\S]*最終同期 9\/29 22:04/);
  assert.match(s.el.innerHTML, /数学<\/b>[\s\S]*最終同期 9\/29 22:06/);

  var s2 = makeScreen({ maps: REC, sync: {
    pullEikomiSummary: function(){ return Promise.resolve(null); },                       // ドキュメント無し／権限で読めない
    pullKyotsuMathSummary: function(){ return Promise.reject(new Error("network")); }
  } });
  vm.runInContext("renderLinkStatus()", s2);
  await vm.runInContext("loadLinkHeartbeats()", s2);
  assert.match(s2.el.innerHTML, /最終記録 9\/29 22:04/, "最終記録は出たまま");
  assert.equal((s2.el.innerHTML.match(/最終同期 不明/g) || []).length, 2);

  var s3 = makeScreen({ maps: REC, sync: undefined });                                     // FirebaseSync 無し
  await vm.runInContext("loadLinkHeartbeats()", s3);
});
test("⑩見守り（保護者）だけに出る／読み込みは loadWatchData から。表示専用で保存しない", function(){
  assert.match(html, /#linkStatusCard\{ display:none; \}\n\s*body\.role-admin #linkStatusCard\{ display:block; \}/);
  var watch = extractFunction("loadWatchData");
  assert.match(watch, /renderProgressCard\(\);\n    renderLinkStatus\(\);\n    loadLinkHeartbeats\(\);/);
  var body = extractFunction("renderLinkStatus") + extractFunction("loadLinkHeartbeats");
  assert.ok(!/persist\(|setDoc|pushLogs|localStorage/.test(body), "何も書き込まない");
});
test("⑪cache bust：dq-leap-auto.js の version（v=5）", function(){
  assert.match(html, /<script src="dq-leap-auto\.js\?v=5"><\/script>/);
});
