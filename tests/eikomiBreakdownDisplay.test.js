"use strict";
/*
 * 英コミュ自動記録（eikomiAuto）の内訳表示：「英コミュ（自動記録） 3件 📝2 🎤1」（📝=問題、🎤=音読。title つき）。
 *   ・0の項目は省略（音読だけ「1件 🎤1」、問題だけ「3件 📝3」）
 *   ・breakdown が無い旧データ・壊れている・合計が count と合わない場合は「◯件」だけ（従来どおり）
 *   ・クエストの数・達成数には影響しない（自動記録は1日1項目のまま）
 *   ・表示は 1)ホームのクエスト一覧 2)記録タブの日別詳細（保護者の見守りでも同じ関数） 3)ログのコピー用テキスト（絵文字でなく「（問題2・音読1）」）
 * index.html の実際の関数をソースから取り出して、最小のDOMスタブで動かす。
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
  var e = { date: DAY, source: "eikomi", count: count, updatedAt: 1 };
  if(breakdown !== undefined) e.breakdown = breakdown;
  return e;
};
const label = function(count, breakdown){
  var map = L.sources.eikomi.normalize({ [DAY]: entry(count, breakdown) });
  return L.sources.eikomi.displayItems([], map, DAY)[0];
};

// ---- 1. 表示ルール ----
test("①内訳あり：「3件 📝2 🎤1」", function(){
  assert.equal(label(3, { q: 2, listen: 1 }).label, "英コミュ（自動記録） 3件 📝2 🎤1");
});
test("②0の項目は省略：音読だけ「1件 🎤1」、問題だけ「3件 📝3」", function(){
  assert.equal(label(1, { q: 0, listen: 1 }).label, "英コミュ（自動記録） 1件 🎤1");
  assert.equal(label(3, { q: 3, listen: 0 }).label, "英コミュ（自動記録） 3件 📝3");
});
test("③breakdownが無い旧データは今までどおり「◯件」のみ（HTML・テキスト用ラベルも作らない）", function(){
  var it = label(3);
  assert.equal(it.label, "英コミュ（自動記録） 3件");
  assert.equal(it.labelHtml, undefined);
  assert.equal(it.textLabel, undefined);
});
test("④壊れた breakdown・合計が count と合わない → 内訳を出さず「◯件」のみ（normalizeも捨てる）", function(){
  var bad = [
    { q: -1, listen: 4 }, { q: 1.5, listen: 1.5 }, { q: "2", listen: 1 }, { q: 2 }, { listen: 3 }, {},
    { q: 2, listen: 2 },          // 合計4 ≠ count 3
    { q: 0, listen: 0 },          // 合計0 ≠ count 3
    { q: NaN, listen: 3 }, { q: Infinity, listen: 0 }, "x", 5, null, []
  ];
  bad.forEach(function(b){
    var map = L.sources.eikomi.normalize({ [DAY]: entry(3, b) });
    assert.equal(map[DAY].breakdown, undefined, "normalizeは無効なbreakdownを捨てる: " + JSON.stringify(b));
    var it = L.sources.eikomi.displayItems([], map, DAY)[0];
    assert.equal(it.label, "英コミュ（自動記録） 3件", JSON.stringify(b));
    assert.equal(it.labelHtml, undefined);
  });
  // normalizeを通さずに autoQuest へ直接渡されても、同じ検証で内訳を出さない
  assert.equal(L.sources.eikomi.autoQuest({ count: 3, breakdown: { q: 9, listen: 9 } }).label, "英コミュ（自動記録） 3件");
});
test("⑤normalizeは有効なbreakdownを残す（{q, listen}だけ・余計なキーは持たない）", function(){
  var map = L.sources.eikomi.normalize({ [DAY]: entry(3, { q: 2, listen: 1, extra: 99 }) });
  assert.deepEqual(map[DAY], { date: DAY, source: "eikomi", count: 3, updatedAt: 1, breakdown: { q: 2, listen: 1 } });
});

// ---- 2. title（📝=問題／🎤=音読）とテキスト用ラベル ----
test("⑥画面用HTML：絵文字ごとに title（問題／音読）が付く。0の項目は出さない", function(){
  var both = label(3, { q: 2, listen: 1 }).labelHtml;
  assert.match(both, /<span class="auto-detail" title="問題"[^>]*>📝2<\/span>/);
  assert.match(both, /<span class="auto-detail" title="音読"[^>]*>🎤1<\/span>/);
  assert.ok(both.startsWith("英コミュ（自動記録） 3件 "));
  var listenOnly = label(1, { q: 0, listen: 1 }).labelHtml;
  assert.ok(!/title="問題"/.test(listenOnly) && /title="音読"/.test(listenOnly));
  var qOnly = label(3, { q: 3, listen: 0 }).labelHtml;
  assert.ok(/title="問題"/.test(qOnly) && !/title="音読"/.test(qOnly));
});
test("⑦コピー用テキスト：絵文字でなく「（問題2・音読1）」。0の項目は省略", function(){
  assert.equal(label(3, { q: 2, listen: 1 }).textLabel, "英コミュ（自動記録） 3件（問題2・音読1）");
  assert.equal(label(1, { q: 0, listen: 1 }).textLabel, "英コミュ（自動記録） 1件（音読1）");
  assert.equal(label(3, { q: 3, listen: 0 }).textLabel, "英コミュ（自動記録） 3件（問題3）");
});

// ---- 3. 他のソース・件数への影響なし ----
test("⑧LEAP・kyotsu-mathは、breakdownが来ても内訳を出さず「問」のまま。normalizeも捨てる", function(){
  var raw = { [DAY]: { count: 3, updatedAt: 1, breakdown: { q: 2, listen: 1 } } };
  var leap = L.sources.leap.normalize(raw), math = L.sources.kyotsuMath.normalize(raw);
  assert.equal(leap[DAY].breakdown, undefined);
  assert.equal(math[DAY].breakdown, undefined);
  assert.equal(L.sources.leap.displayItems([], leap, DAY)[0].label, "LEAP単語帳（自動記録） 3問");
  assert.equal(L.sources.kyotsuMath.displayItems([], math, DAY)[0].label, "kyotsu-math（自動記録） 3問");
});
test("⑨クエスト数・達成数は変わらない（内訳の有無にかかわらず自動記録は1項目・done）", function(){
  var quests = [{ label: "手動A", done: true }, { label: "手動B", done: false }];
  function stats(eikomiMap){
    var items = L.mergeSources([
      { def: L.sources.leap, map: {} }, { def: L.sources.eikomi, map: eikomiMap }, { def: L.sources.kyotsuMath, map: {} }
    ]).displayItems(quests, DAY);
    return { total: items.length, done: items.filter(function(x){ return x.done; }).length, tags: items.map(function(x){ return x.tag; }) };
  }
  var withB = stats(L.sources.eikomi.normalize({ [DAY]: entry(3, { q: 2, listen: 1 }) }));
  var without = stats(L.sources.eikomi.normalize({ [DAY]: entry(3) }));
  assert.deepEqual(withB, without);
  assert.deepEqual({ total: withB.total, done: withB.done }, { total: 3, done: 2 });
});
test("⑩旧autoSource:\"eikomi\"クエストと新記録（内訳つき）が同日 → 新記録だけが1項目で出る（二重にならない）", function(){
  var legacy = { label: "英コミュ（自動記録）（本日3問）", done: true, tag: "英語", autoSource: "eikomi" };
  var map = L.sources.eikomi.normalize({ [DAY]: entry(3, { q: 2, listen: 1 }) });
  var items = L.sources.eikomi.displayItems([{ label: "手動", done: true }, legacy], map, DAY);
  assert.deepEqual(items.map(function(x){ return x.label; }), ["手動", "英コミュ（自動記録） 3件 📝2 🎤1"]);
});

// ---- 4. 実際の画面関数（index.html）で表示を確認 ----
function makeScreen(opts){
  opts = opts || {};
  var els = { questList: { innerHTML: "", querySelectorAll: function(){ return []; } },
              recordDayDetail: { innerHTML: "", querySelectorAll: function(){ return []; } } };
  var ctx = {
    document: { getElementById: function(id){ return els[id] || null; } },
    Math: Math, JSON: JSON, Date: Date, Number: Number, String: String, Object: Object, Array: Array, Set: Set,
    DQLeapAuto: L, WD_JP: ["月", "火", "水", "木", "金", "土", "日"], PERIOD_LABEL: { am: "午前", pm: "午後", night: "夜" }, UNTAGGED: "未分類",
    store: { appName: "デイリークエスト", appStartDate: DAY, days: opts.days || {} },
    leapAuto: {}, eikomiAuto: L.sources.eikomi.normalize(opts.eikomi || {}), kyotsuMathAuto: {},
    activeDate: DAY, selectedRecordDate: DAY, watchMode: !!opts.watchMode,
    checkSVG: function(){ return "<svg></svg>"; }, eventLabel: function(e){ return e.label; },
    toggleQuestState: function(){}, ensureDay: function(){ return { quests: [] }; }, persist: function(){}, renderResults: function(){}, afterQuestChange: function(){}, openAddModal: function(){},
    els: els
  };
  ctx.dayData = function(k){ return ctx.store.days[k] || { events: [], eventDone: {}, quests: [] }; };
  vm.createContext(ctx);
  ["pad", "toKey", "parseKey", "keyOf", "addDays", "dayDiff", "weekdayIdx", "fmtJP", "mergedAutoSources", "dispQuests", "dispItems", "allDayKeys", "dayQuestStats",
   "renderQuests", "renderRecordDayDetail", "generateLogText"].forEach(function(n){ vm.runInContext(extractFunction(n), ctx); });
  return ctx;
}
const BOTH = { [DAY]: entry(3, { q: 2, listen: 1 }) };

test("⑪ホームのクエスト一覧：内訳つきで出る（title付き）。読み取り専用のまま（削除ボタンなし）", function(){
  var s = makeScreen({ eikomi: BOTH, days: { [DAY]: { events: [], eventDone: {}, quests: [{ label: "数学ワーク", done: false }] } } });
  vm.runInContext("renderQuests()", s);
  var out = s.els.questList.innerHTML;
  assert.match(out, /英コミュ（自動記録） 3件 <span class="auto-detail" title="問題"[^>]*>📝2<\/span> <span class="auto-detail" title="音読"[^>]*>🎤1<\/span>/);
  assert.equal((out.match(/quest-auto/g) || []).length, 1, "自動記録は1項目");
  assert.equal((out.match(/class="quest-item/g) || []).length, 2, "通常クエスト1＋自動記録1（内訳で項目は増えない）");
  var autoBlock = out.slice(out.indexOf("quest-auto"), out.indexOf("</div>", out.indexOf("quest-label")) + 6);
  assert.ok(!/data-del/.test(autoBlock), "自動記録に削除ボタンは付かない");
});
test("⑫ホーム：breakdownの無い旧データは「◯件」のみ（auto-detailなし）", function(){
  var s = makeScreen({ eikomi: { [DAY]: entry(3) } });
  vm.runInContext("renderQuests()", s);
  assert.match(s.els.questList.innerHTML, /英コミュ（自動記録） 3件</);
  assert.ok(!/auto-detail/.test(s.els.questList.innerHTML));
});
test("⑬記録タブの日別詳細：子どもでも保護者の見守り（watchMode）でも同じ内訳表示。クエスト数は 1/1 のまま", function(){
  [false, true].forEach(function(watchMode){
    var s = makeScreen({ eikomi: BOTH, watchMode: watchMode });
    vm.runInContext("renderRecordDayDetail()", s);
    var out = s.els.recordDayDetail.innerHTML;
    assert.match(out, /\[英語\]<\/span>英コミュ（自動記録） 3件 <span class="auto-detail" title="問題"[^>]*>📝2<\/span> <span class="auto-detail" title="音読"[^>]*>🎤1<\/span>/, "watchMode=" + watchMode);
    assert.match(out, /クエスト 1\/1 完了/, "達成数の表示は変わらない");
    assert.match(out, /record-quest-auto/);
    assert.equal(/recordAddQuestBtn/.test(out), !watchMode, "追加ボタンは見守りでは出ない（従来どおり）");
  });
});
test("⑭日別詳細：内訳が0の項目は出さない（音読だけ）", function(){
  var s = makeScreen({ eikomi: { [DAY]: entry(1, { q: 0, listen: 1 }) }, watchMode: true });
  vm.runInContext("renderRecordDayDetail()", s);
  var out = s.els.recordDayDetail.innerHTML;
  assert.match(out, /英コミュ（自動記録） 1件 <span class="auto-detail" title="音読"[^>]*>🎤1<\/span>/);
  assert.ok(!/title="問題"/.test(out));
});
test("⑮ログのコピー用テキスト：「（問題2・音読1）」。絵文字・HTMLは入らない。旧データは「◯件」のみ", function(){
  var s = makeScreen({ eikomi: BOTH });
  var text = vm.runInContext("generateLogText()", s);
  assert.match(text, /\[済\]英コミュ（自動記録） 3件（問題2・音読1）/);
  assert.ok(!/📝|🎤|<span/.test(text));
  assert.match(text, /クエスト達成: 1\/1（100%）/);
  var old = vm.runInContext("generateLogText()", makeScreen({ eikomi: { [DAY]: entry(3) } }));
  assert.match(old, /\[済\]英コミュ（自動記録） 3件[、\n]|\[済\]英コミュ（自動記録） 3件$/m);
  assert.ok(!/（問題|（音読/.test(old));
});
test("⑯内訳の文字列はstore（保存対象）に混ざらない", function(){
  var s = makeScreen({ eikomi: BOTH });
  vm.runInContext("renderQuests(); renderRecordDayDetail(); generateLogText();", s);
  var saved = JSON.stringify(s.store);
  assert.ok(!/📝|🎤|auto-detail|英コミュ（自動記録）/.test(saved));
});

// ---- 5. 取り込み経路：キャッシュ往復・見守りの読み込み ----
test("⑰キャッシュ往復：setEikomiAuto(raw, true) → localStorage → loadEikomiAutoCache でbreakdownが残る", function(){
  var storage = {};
  var ctx = {
    DQLeapAuto: L, JSON: JSON, watchMode: false, persist: function(){},
    store: { appStartDate: "2026-06-29" }, eikomiAuto: {},
    EIKOMI_AUTO_CACHE_KEY: "dailyquest_eikomi_auto_v1",
    localStorage: { getItem: function(k){ return k in storage ? storage[k] : null; }, setItem: function(k, v){ storage[k] = String(v); } }
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction("setEikomiAuto") + "\n" + extractFunction("loadEikomiAutoCache"), ctx);
  vm.runInContext(`setEikomiAuto(${JSON.stringify(BOTH)}, true)`, ctx);
  var cached = JSON.parse(storage.dailyquest_eikomi_auto_v1);
  assert.deepEqual(cached[DAY].breakdown, { q: 2, listen: 1 });
  var loaded = JSON.parse(JSON.stringify(vm.runInContext("loadEikomiAutoCache()", ctx)));
  assert.deepEqual(loaded[DAY], { date: DAY, source: "eikomi", count: 3, updatedAt: 1, breakdown: { q: 2, listen: 1 } });
  // 旧キャッシュ（breakdown無し）も従来どおり読める
  storage.dailyquest_eikomi_auto_v1 = JSON.stringify({ [DAY]: { date: DAY, source: "eikomi", count: 3, updatedAt: 1 } });
  var old = JSON.parse(JSON.stringify(vm.runInContext("loadEikomiAutoCache()", ctx)));
  assert.equal(old[DAY].breakdown, undefined);
  assert.equal(old[DAY].count, 3);
});
test("⑱見守り：子どものeikomiAutoは setEikomiAuto（＝normalize）経由で読み込まれ、内訳も引き継がれる", function(){
  var watch = extractFunction("loadWatchData");
  assert.match(watch, /setEikomiAuto\(remote\.eikomiAuto, false\)/);
  assert.match(extractFunction("setEikomiAuto"), /DQLeapAuto\.sources\.eikomi\.normalize\(raw\)/);
});
test("⑲cache bust：dq-leap-auto.js の version を上げている（v=4）", function(){
  assert.match(html, /<script src="dq-leap-auto\.js\?v=4"><\/script>/);
});
