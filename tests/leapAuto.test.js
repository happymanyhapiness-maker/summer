"use strict";
/*
 * デイリークエスト側：LEAP単語帳の自動記録（dailyquest-logs/{uid}.leapAuto）を通常クエストと表示時に合成するテスト。
 * 実行方法: node --test tests/*.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const L = require("../dq-leap-auto.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const syncSrc = fs.readFileSync(path.join(__dirname, "..", "dq-firebase-sync.js"), "utf8").replace(/\r\n/g, "\n");

function day(quests){ return { events: [], eventDone: {}, quests: quests }; }
var leap = L.normalizeLeapAuto({
  "2026-09-20": { date: "2026-09-20", source: "leap", count: 40, updatedAt: 1 },
  "2026-09-24": { date: "2026-09-24", source: "leap", count: 55, updatedAt: 2 },
  "bad-key": { count: 3 }, "2026-09-25": { count: 0 }
});

test("leapAutoの正規化：日付キーと正の件数だけ残す", function(){
  assert.deepEqual(Object.keys(leap).sort(), ["2026-09-20", "2026-09-24"]);
  assert.deepEqual(L.normalizeLeapAuto(null), {});
});

test("同じ日のLEAP記録は1件だけ表示（「LEAP単語帳（自動記録） 55問」・完了・読み取り専用）", function(){
  var d = day([{ label: "数学ワーク", done: false, tag: "数学α" }]);
  var list = L.displayQuests(d.quests, leap, "2026-09-24");
  assert.equal(list.length, 2);
  var auto = list.filter(function(x){ return x.auto; });
  assert.equal(auto.length, 1);
  assert.equal(auto[0].item.label, "LEAP単語帳（自動記録） 55問");
  assert.equal(auto[0].item.done, true);
  assert.equal(auto[0].idx, -1, "storeの添字を持たない＝編集・削除の対象外");
  assert.equal(list[0].idx, 0, "通常クエストはstoreの添字のまま");
  assert.deepEqual(L.displayQuests(d.quests, leap, "2026-09-23").map(function(x){ return x.auto; }), [false], "LEAP記録の無い日は通常クエストだけ");
});

test("以前の手動反映（autoSource:\"leap\"）：同じ日に新方式の記録があれば表示から外す（二重表示しない・storeからは消さない）", function(){
  var quests = [{ label: "LEAP単語帳（自動記録）（本日38問）", done: true, tag: "英語", autoSource: "leap" }, { label: "音読", done: true }];
  var list = L.displayQuests(quests, leap, "2026-09-24");
  assert.deepEqual(list.map(function(x){ return x.item.label; }), ["音読", "LEAP単語帳（自動記録） 55問"]);
  assert.equal(list[0].idx, 1, "外した分がずれても、通常クエストはstoreの添字で操作できる");
  assert.equal(quests.length, 2, "storeの配列は変更しない");
  // 新方式の記録が無い日は、以前の記録をそのまま表示（過去記録を失わない）
  assert.deepEqual(L.displayItems(quests, leap, "2026-09-10").map(function(x){ return x.label; }), ["LEAP単語帳（自動記録）（本日38問）", "音読"]);
});

test("過去日が残る：storeに無い日もLEAP記録の日として集計対象になる（LEAP完全初期化後もleapAutoは消えない）", function(){
  var days = { "2026-09-24": day([]) };
  assert.deepEqual(L.allDayKeys(days, leap), ["2026-09-20", "2026-09-24"]);
  assert.equal(L.earliestLeapDate(leap), "2026-09-20");
  // LEAP側の完全初期化は leapAuto を消さない（LEAP側のテストで確認）ので、ここでは過去日の記録がそのまま表示されることを確認
  assert.equal(L.displayItems([], leap, "2026-09-20")[0].label, "LEAP単語帳（自動記録） 40問");
});

test("通常クエストの追加・完了・編集・並び替え・削除でLEAP記録は消えない（別データなので影響しない）", function(){
  var d = day([{ label: "A", done: false }]);
  d.quests.push({ label: "B", done: false });           // 追加
  d.quests[0].done = true;                              // 完了
  d.quests[1].label = "B2";                             // 編集
  d.quests.reverse();                                   // 並び替え
  d.quests.splice(0, 1);                                // 削除
  var list = L.displayItems(d.quests, leap, "2026-09-24");
  assert.equal(list.length, 2);
  assert.equal(list[1].label, "LEAP単語帳（自動記録） 55問");
});

test("LEAP記録の更新で通常クエストは消えない（storeとは別フィールド）", function(){
  var d = day([{ label: "A", done: true }, { label: "B", done: false }]);
  var updated = L.normalizeLeapAuto({ "2026-09-24": { count: 70 } });
  var list = L.displayItems(d.quests, updated, "2026-09-24");
  assert.deepEqual(list.map(function(x){ return x.label; }), ["A", "B", "LEAP単語帳（自動記録） 70問"]);
});

test("保存：デイリークエストの保存は data/clientUpdatedAt だけを merge:true で書く（leapAutoフィールドを上書きしない）", function(){
  assert.match(html, /pushLogs\(\{ data: JSON\.stringify\(store\), clientUpdatedAt: store\._updatedAt\|\|0 \}\)/);
  var body = syncSrc.slice(syncSrc.indexOf("function pushLogs("), syncSrc.indexOf("function pullLogs("));
  assert.match(body, /setDoc\(doc\(db,LOGS_COLLECTION,uid\), payload, \{merge:true\}\)/);
  assert.equal(html.indexOf("leapAuto:"), -1, "画面側からleapAutoを書き込まない");
});

test("画面：集計・表示は合成版（dispItems/dispQuests）を使い、LEAP記録は読み取り専用", function(){
  assert.match(html, /<script src="dq-leap-auto\.js\?v=1"><\/script>/);
  assert.match(html, /function totalDoneQuestCount\(\)\{\n  let n = 0;\n  allDayKeys\(\)\.forEach\(k=>\{\n    n \+= dispItems\(k\)/);
  assert.match(html, /function dayQuestStats\(key\)\{\n  const q = dispItems\(key\);/);
  assert.match(html, /function renderResults\(\)\{\n  const q = dispItems\(activeDate\);/);
  assert.match(html, /el\.querySelectorAll\("\.quest-item:not\(\[data-auto\]\)"\)/, "自動記録はタップ・削除の対象外");
  assert.match(html, /x\.auto\?'record-quest-auto':'record-quest-row'/, "記録画面でも自動記録はタップで切り替えない");
  assert.match(html, /setLeapAuto\(remote\.leapAuto, true\);/, "起動時に毎回leapAutoを読み直す");
  assert.match(html, /setLeapAuto\(remote\.leapAuto, false\);/, "見守り（保護者）でも表示");
});
