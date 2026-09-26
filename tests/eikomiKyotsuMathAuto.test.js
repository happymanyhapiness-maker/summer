"use strict";
/*
 * デイリークエスト側：英コミュ（eikomiAuto）・kyotsu-math（kyotsuMathAuto）の自動記録を、
 * 通常クエスト・LEAP自動記録(leapAuto)と一緒に表示時に合成するテスト。
 * 今回はPlanner側の読み取り・表示対応のみ（英コミュ・kyotsu-math側はまだ新フィールドを書かない）。
 * 実行方法: node --test tests/*.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const L = require("../dq-leap-auto.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");

function day(quests){ return { events: [], eventDone: {}, quests: quests }; }

function merge(leap, eikomi, kyotsuMath){
  return L.mergeSources([
    { def: L.sources.leap, map: leap || {} },
    { def: L.sources.eikomi, map: eikomi || {} },
    { def: L.sources.kyotsuMath, map: kyotsuMath || {} }
  ]);
}

// ---- 1. dataのみ（Autoフィールド無し） → 現行どおり ----
test("①dataのみ・Autoフィールド無しでも現行どおり表示される", function(){
  const d = day([{ label: "手動クエスト", done: true }]);
  const m = merge({}, {}, {});
  const list = m.displayItems(d.quests, "2026-09-24");
  assert.deepEqual(list.map(x => x.label), ["手動クエスト"]);
});

// ---- 2. leapAutoあり → 現行どおり（既存tests/leapAuto.test.jsで担保済みだが、mergeSources経由でも確認） ----
test("②leapAutoのみ → 現行どおり合成される（mergeSources経由）", function(){
  const leap = L.sources.leap.normalize({ "2026-09-24": { count: 55, updatedAt: 1 } });
  const m = merge(leap, {}, {});
  const list = m.displayItems([{ label: "音読", done: true }], "2026-09-24");
  assert.deepEqual(list.map(x => x.label), ["音読", "LEAP単語帳（自動記録） 55問"]);
});

// ---- 3. eikomiAutoのみ追加 → 正しく表示 ----
test("③eikomiAutoのみ → 正しく表示される", function(){
  const eikomi = L.sources.eikomi.normalize({ "2026-09-24": { count: 12, updatedAt: 1 } });
  const m = merge({}, eikomi, {});
  const list = m.displayItems([{ label: "音読", done: true }], "2026-09-24");
  assert.deepEqual(list.map(x => x.label), ["音読", "英コミュ（自動記録） 12問"]);
  assert.equal(list[1].done, true);
  assert.equal(list[1].tag, "英語");
});

// ---- 4. kyotsuMathAutoのみ追加 → 正しく表示 ----
test("④kyotsuMathAutoのみ → 正しく表示される", function(){
  const kyotsuMath = L.sources.kyotsuMath.normalize({ "2026-09-24": { count: 8, updatedAt: 1 } });
  const m = merge({}, {}, kyotsuMath);
  const list = m.displayItems([{ label: "音読", done: true }], "2026-09-24");
  assert.deepEqual(list.map(x => x.label), ["音読", "kyotsu-math（自動記録） 8問"]);
  assert.equal(list[1].tag, "数学");
});

// ---- 5. 3 Autoフィールドすべて存在 → それぞれ表示 ----
test("⑤leap/eikomi/kyotsuMathすべて存在 → 3件とも表示される", function(){
  const leap = L.sources.leap.normalize({ "2026-09-24": { count: 55, updatedAt: 1 } });
  const eikomi = L.sources.eikomi.normalize({ "2026-09-24": { count: 12, updatedAt: 1 } });
  const kyotsuMath = L.sources.kyotsuMath.normalize({ "2026-09-24": { count: 8, updatedAt: 1 } });
  const m = merge(leap, eikomi, kyotsuMath);
  const list = m.displayItems([{ label: "手動", done: false }], "2026-09-24");
  assert.deepEqual(list.map(x => x.label), [
    "手動",
    "LEAP単語帳（自動記録） 55問",
    "英コミュ（自動記録） 12問",
    "kyotsu-math（自動記録） 8問"
  ]);
  assert.deepEqual(list.slice(1).map(x => x.auto), [true, true, true]);
});

// ---- 6. 旧autoSource:"eikomi" ＋ 新eikomiAutoが同日 → 二重表示なし ----
test("⑥旧autoSource:\"eikomi\"と新eikomiAutoが同日 → 二重表示しない（storeからは消さない）", function(){
  const eikomi = L.sources.eikomi.normalize({ "2026-09-24": { count: 20, updatedAt: 2 } });
  const quests = [
    { label: "英コミュ（自動記録）（本日15問）", done: true, tag: "英語", autoSource: "eikomi" },
    { label: "音読", done: true }
  ];
  const m = merge({}, eikomi, {});
  const list = m.displayItems(quests, "2026-09-24");
  assert.deepEqual(list.map(x => x.label), ["音読", "英コミュ（自動記録） 20問"]);
  assert.equal(quests.length, 2, "storeの配列自体は変更しない");
  // eikomiAutoが無い日は、旧記録をそのまま表示（過去記録を失わない）
  assert.deepEqual(
    m.displayItems(quests, "2026-09-10").map(x => x.label),
    ["英コミュ（自動記録）（本日15問）", "音読"]
  );
});

// ---- 7. 旧autoSource:"kyotsu-math" ＋ 新kyotsuMathAutoが同日 → 二重表示なし ----
test("⑦旧autoSource:\"kyotsu-math\"と新kyotsuMathAutoが同日 → 二重表示しない", function(){
  const kyotsuMath = L.sources.kyotsuMath.normalize({ "2026-09-24": { count: 30, updatedAt: 2 } });
  const quests = [
    { label: "kyotsu-math（自動記録）（本日25問）", done: true, tag: "数学", autoSource: "kyotsu-math" },
    { label: "音読", done: true }
  ];
  const m = merge({}, {}, kyotsuMath);
  const list = m.displayItems(quests, "2026-09-24");
  assert.deepEqual(list.map(x => x.label), ["音読", "kyotsu-math（自動記録） 30問"]);
  assert.equal(quests.length, 2, "storeの配列自体は変更しない");
});

// ---- 6b/7b. 旧記録と新記録が「別の」source同士なら、互いに干渉しない ----
test("⑥⑦b 別sourceの旧記録は、他sourceのAutoフィールドの有無に影響されない", function(){
  const eikomi = L.sources.eikomi.normalize({ "2026-09-24": { count: 5, updatedAt: 1 } });
  const quests = [
    { label: "kyotsu-math（自動記録）（本日25問）", done: true, tag: "数学", autoSource: "kyotsu-math" }
  ];
  const m = merge({}, eikomi, {}); // kyotsuMathAutoは無い
  const list = m.displayItems(quests, "2026-09-24");
  assert.deepEqual(list.map(x => x.label), [
    "kyotsu-math（自動記録）（本日25問）", // 旧kyotsu-math記録は残る（kyotsuMathAutoが無いため）
    "英コミュ（自動記録） 5問"
  ]);
});

// ---- 8. Autoフィールドを読み込んだあとPlannerで通常操作・保存しても、Auto内容がdataへ混入しない ----
test("⑧画面側からeikomiAuto/kyotsuMathAutoを書き込まない（dataへ混入しない）", function(){
  assert.equal(html.indexOf("eikomiAuto:"), -1, "画面側からeikomiAutoを書き込まない");
  assert.equal(html.indexOf("kyotsuMathAuto:"), -1, "画面側からkyotsuMathAutoを書き込まない");
  // 保存処理そのもの（pushStoreSnapshot）は既存のまま data/clientUpdatedAt だけを書く
  assert.match(html, /pushLogs\(\{ data: JSON\.stringify\(store\), clientUpdatedAt: store\._updatedAt\|\|0 \}\)/);
});

// ---- 9. 既存の手動クエスト・done状態・presets等が変化しない ----
test("⑨mergeSourcesはstoreの配列を書き換えない（元のquests参照はそのまま）", function(){
  const d = day([{ label: "A", done: false }, { label: "B", done: true }]);
  const before = JSON.stringify(d.quests);
  const m = merge(
    L.sources.leap.normalize({ "2026-09-24": { count: 1, updatedAt: 1 } }),
    L.sources.eikomi.normalize({ "2026-09-24": { count: 2, updatedAt: 1 } }),
    L.sources.kyotsuMath.normalize({ "2026-09-24": { count: 3, updatedAt: 1 } })
  );
  m.displayItems(d.quests, "2026-09-24");
  assert.equal(JSON.stringify(d.quests), before, "quests配列自体は不変のまま");
});

// ---- Planner側の呼び出し配線（起動時・見守り・可視化復帰）がすべて更新されていることの確認 ----
test("画面：起動時・見守り・可視化復帰のいずれでもeikomiAuto/kyotsuMathAutoを読み直す", function(){
  assert.match(html, /setEikomiAuto\(remote\.eikomiAuto, false\);/, "見守りモードでも読み込む");
  assert.match(html, /setKyotsuMathAuto\(remote\.kyotsuMathAuto, false\);/, "見守りモードでも読み込む");
  assert.match(html, /setEikomiAuto\(remote\.eikomiAuto, true\);/, "起動時に読み込む");
  assert.match(html, /setKyotsuMathAuto\(remote\.kyotsuMathAuto, true\);/, "起動時に読み込む");
  assert.match(html, /setEikomiAuto\(r\.eikomiAuto, true\);/, "画面復帰時に読み直す");
  assert.match(html, /setKyotsuMathAuto\(r\.kyotsuMathAuto, true\);/, "画面復帰時に読み直す");
});
