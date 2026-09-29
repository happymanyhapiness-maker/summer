"use strict";
/*
 * LEAP・数学の自動記録にも内訳アイコンを出す（英コミュと同じ方式）。
 *   LEAP：🆕=新規（復習以外の学習） / 🔁=復習     breakdown:{new, review}
 *   数学：📘=通常 / 🔁=復習                        breakdown:{normal, review}
 *   0の項目は省略。breakdown が無い旧データ・壊れている・合計が count と合わない・別アプリの形は「◯問」のみ（従来どおり）。
 *   単位は「問」のまま。クエスト数・達成数は変わらない。
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

const DAY = "2026-09-28";
const entry = function(count, breakdown){
  var e = { date: DAY, source: "x", count: count, updatedAt: 1 };
  if(breakdown !== undefined) e.breakdown = breakdown;
  return e;
};
const item = function(def, count, breakdown){
  var map = def.normalize({ [DAY]: entry(count, breakdown) });
  return def.displayItems([], map, DAY)[0];
};
const LEAP = L.sources.leap, MATH = L.sources.kyotsuMath, EIKOMI = L.sources.eikomi;

// ---- LEAP ----
test("①LEAP：内訳あり「55問 🆕30 🔁25」。0の項目は省略。単位は「問」のまま", function(){
  assert.equal(item(LEAP, 55, { new: 30, review: 25 }).label, "LEAP単語帳（自動記録） 55問 🆕30 🔁25");
  assert.equal(item(LEAP, 12, { new: 12, review: 0 }).label, "LEAP単語帳（自動記録） 12問 🆕12");
  assert.equal(item(LEAP, 7, { new: 0, review: 7 }).label, "LEAP単語帳（自動記録） 7問 🔁7");
});
test("②LEAP：title と コピー用テキスト", function(){
  var it = item(LEAP, 55, { new: 30, review: 25 });
  assert.match(it.labelHtml, /<span class="auto-detail" title="新規（復習以外の学習）"[^>]*>🆕30<\/span>/);
  assert.match(it.labelHtml, /<span class="auto-detail" title="復習"[^>]*>🔁25<\/span>/);
  assert.equal(it.textLabel, "LEAP単語帳（自動記録） 55問（新規30・復習25）");
});
test("③LEAP：breakdown無しの旧データ・壊れた値・合計不一致・他アプリの形（q/listen、normal/review）は「◯問」のみ", function(){
  var bad = [undefined, { new: 30, review: 20 }, { new: -1, review: 56 }, { new: 30.5, review: 24.5 }, { new: "30", review: 25 },
             { new: 55 }, { review: 55 }, {}, { q: 30, listen: 25 }, { normal: 30, review: 25 }, null, "x", []];
  bad.forEach(function(b){
    var map = LEAP.normalize({ [DAY]: entry(55, b) });
    assert.equal(map[DAY].breakdown, undefined, JSON.stringify(b));
    var it = LEAP.displayItems([], map, DAY)[0];
    assert.equal(it.label, "LEAP単語帳（自動記録） 55問", JSON.stringify(b));
    assert.equal(it.labelHtml, undefined);
    assert.equal(it.textLabel, undefined);
  });
});

// ---- 数学 ----
test("④数学：内訳あり「8問 📘6 🔁2」。0の項目は省略。title と テキスト", function(){
  var it = item(MATH, 8, { normal: 6, review: 2 });
  assert.equal(it.label, "kyotsu-math（自動記録） 8問 📘6 🔁2");
  assert.match(it.labelHtml, /<span class="auto-detail" title="通常"[^>]*>📘6<\/span>/);
  assert.match(it.labelHtml, /<span class="auto-detail" title="復習"[^>]*>🔁2<\/span>/);
  assert.equal(it.textLabel, "kyotsu-math（自動記録） 8問（通常6・復習2）");
  assert.equal(item(MATH, 8, { normal: 8, review: 0 }).label, "kyotsu-math（自動記録） 8問 📘8");
  assert.equal(item(MATH, 3, { normal: 0, review: 3 }).label, "kyotsu-math（自動記録） 3問 🔁3");
});
test("⑤数学：旧データ・壊れた値・合計不一致・他アプリの形（new/review、q/listen）は「◯問」のみ", function(){
  [undefined, { normal: 5, review: 2 }, { normal: 8 }, { new: 6, review: 2 }, { q: 6, listen: 2 }, { normal: -2, review: 10 }, null, 8].forEach(function(b){
    var it = item(MATH, 8, b);
    assert.equal(it.label, "kyotsu-math（自動記録） 8問", JSON.stringify(b));
    assert.equal(it.labelHtml, undefined);
  });
});

// ---- 共通 ----
test("⑥英コミュには LEAP・数学の形は効かない（内訳の定義はアプリごと）", function(){
  assert.equal(item(EIKOMI, 8, { new: 6, review: 2 }).label, "英コミュ（自動記録） 8件");
  assert.equal(item(EIKOMI, 8, { normal: 6, review: 2 }).label, "英コミュ（自動記録） 8件");
});
test("⑦3アプリが同日に内訳つきで並んでも、項目は1アプリ1つ・達成数は変わらない。旧記録（data内autoSource）の入れ替えも従来どおり", function(){
  var maps = {
    leap: LEAP.normalize({ [DAY]: entry(55, { new: 30, review: 25 }) }),
    eikomi: EIKOMI.normalize({ [DAY]: entry(3, { q: 2, listen: 1 }) }),
    kyotsuMath: MATH.normalize({ [DAY]: entry(8, { normal: 6, review: 2 }) })
  };
  function run(m){
    return L.mergeSources([{ def: LEAP, map: m.leap }, { def: EIKOMI, map: m.eikomi }, { def: MATH, map: m.kyotsuMath }])
      .displayItems([{ label: "手動", done: false }, { label: "kyotsu-math（自動記録）（本日5問）", done: true, tag: "数学", autoSource: "kyotsu-math" }], DAY);
  }
  var items = run(maps);
  assert.deepEqual(items.map(function(x){ return x.label; }), [
    "手動",
    "LEAP単語帳（自動記録） 55問 🆕30 🔁25", "英コミュ（自動記録） 3件 📝2 🎤1", "kyotsu-math（自動記録） 8問 📘6 🔁2"
  ], "旧 autoSource:kyotsu-math は新記録があるので出ない");
  var plain = run({ leap: LEAP.normalize({ [DAY]: entry(55) }), eikomi: EIKOMI.normalize({ [DAY]: entry(3) }), kyotsuMath: MATH.normalize({ [DAY]: entry(8) }) });
  assert.equal(items.length, plain.length);
  assert.equal(items.filter(function(x){ return x.done; }).length, plain.filter(function(x){ return x.done; }).length);
});

// ---- 実際の画面関数（index.html） ----
function makeScreen(o){
  var els = { questList: { innerHTML: "", querySelectorAll: function(){ return []; } }, recordDayDetail: { innerHTML: "", querySelectorAll: function(){ return []; } } };
  var ctx = {
    document: { getElementById: function(id){ return els[id] || null; } },
    Math: Math, JSON: JSON, Date: Date, Number: Number, String: String, Object: Object, Array: Array, Set: Set,
    DQLeapAuto: L, WD_JP: ["月", "火", "水", "木", "金", "土", "日"], PERIOD_LABEL: { am: "午前", pm: "午後", night: "夜" }, UNTAGGED: "未分類",
    store: { appName: "デイリークエスト", appStartDate: DAY, days: {} },
    leapAuto: LEAP.normalize(o.leap || {}), eikomiAuto: EIKOMI.normalize(o.eikomi || {}), kyotsuMathAuto: MATH.normalize(o.math || {}),
    activeDate: DAY, selectedRecordDate: DAY, watchMode: !!o.watchMode,
    checkSVG: function(){ return ""; }, eventLabel: function(e){ return e.label; },
    toggleQuestState: function(){}, ensureDay: function(){ return { quests: [] }; }, persist: function(){}, renderResults: function(){}, afterQuestChange: function(){}, openAddModal: function(){},
    els: els
  };
  ctx.dayData = function(k){ return ctx.store.days[k] || { events: [], eventDone: {}, quests: [] }; };
  vm.createContext(ctx);
  ["pad", "toKey", "parseKey", "keyOf", "addDays", "dayDiff", "weekdayIdx", "fmtJP", "mergedAutoSources", "dispQuests", "dispItems", "allDayKeys", "dayQuestStats",
   "renderQuests", "renderRecordDayDetail", "generateLogText"].forEach(function(n){ vm.runInContext(extractFunction(n), ctx); });
  return ctx;
}
const ALL = { leap: { [DAY]: entry(55, { new: 30, review: 25 }) }, eikomi: { [DAY]: entry(3, { q: 2, listen: 1 }) }, math: { [DAY]: entry(8, { normal: 6, review: 2 }) } };

test("⑧ホーム・記録詳細（子ども／見守り）・コピー用テキストに、3アプリの内訳が出る。クエスト数は3のまま", function(){
  var s = makeScreen(ALL);
  vm.runInContext("renderQuests()", s);
  var home = s.els.questList.innerHTML;
  assert.match(home, /LEAP単語帳（自動記録） 55問 <span class="auto-detail" title="新規（復習以外の学習）"[^>]*>🆕30<\/span> <span class="auto-detail" title="復習"[^>]*>🔁25<\/span>/);
  assert.match(home, /kyotsu-math（自動記録） 8問 <span class="auto-detail" title="通常"[^>]*>📘6<\/span> <span class="auto-detail" title="復習"[^>]*>🔁2<\/span>/);
  assert.equal((home.match(/quest-auto/g) || []).length, 3);

  [false, true].forEach(function(watchMode){
    var w = makeScreen(Object.assign({ watchMode: watchMode }, ALL));
    vm.runInContext("renderRecordDayDetail()", w);
    var out = w.els.recordDayDetail.innerHTML;
    assert.match(out, /🆕30/); assert.match(out, /📝2/); assert.match(out, /📘6/);
    assert.match(out, /クエスト 3\/3 完了/, "watchMode=" + watchMode);
  });

  var text = vm.runInContext("generateLogText()", makeScreen(ALL));
  assert.match(text, /LEAP単語帳（自動記録） 55問（新規30・復習25）/);
  assert.match(text, /kyotsu-math（自動記録） 8問（通常6・復習2）/);
  assert.ok(!/🆕|🔁|📘|📝|🎤|<span/.test(text));
});
test("⑨内訳の文字列はstore（保存対象）に混ざらない", function(){
  var s = makeScreen(ALL);
  vm.runInContext("renderQuests(); renderRecordDayDetail(); generateLogText();", s);
  assert.ok(!/🆕|🔁|📘|auto-detail/.test(JSON.stringify(s.store)));
});
