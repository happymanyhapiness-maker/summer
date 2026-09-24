// ===== LEAP単語帳の自動記録（デイリークエストの表示用に合成する） =====
// LEAP側は dailyquest-logs/{uid} ドキュメントのトップレベルフィールド leapAuto に、
// JST日付ごとの回答数 { "YYYY-MM-DD": {date, source:"leap", count, updatedAt} } だけを書き込む。
// デイリークエスト本体の store（dataフィールドのJSON）とは別フィールドなので、
// こちらの保存（setDoc merge:true で data/clientUpdatedAt だけ書く）とLEAPの書き込みは互いに上書きしない。
// デイリークエスト側は leapAuto を読むだけ（書かない）。表示・集計のときに通常クエストと合成する。
// 以前の手動反映で store に入った {autoSource:"leap"} のクエストは消さない。同じ日に leapAuto がある時だけ表示から外す（二重表示防止）。
(function(root){
  "use strict";
  var LABEL = "LEAP単語帳（自動記録）";
  var TAG = "英語"; // 以前の手動反映（autoSource:"leap"）と同じタグ。過去の集計の見え方を変えない
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function normalizeLeapAuto(raw){
    var out = {};
    if(!raw || typeof raw !== "object") return out;
    Object.keys(raw).forEach(function(k){
      var e = raw[k];
      if(!DAY_RE.test(k) || !e || typeof e !== "object") return;
      var c = Math.floor(Number(e.count));
      if(!(c > 0)) return;
      out[k] = { date: k, source: "leap", count: c, updatedAt: Number(e.updatedAt) || 0 };
    });
    return out;
  }
  function isLegacyLeapQuest(q){ return !!(q && q.autoSource === "leap"); }
  function leapAutoQuest(entry){
    return { label: LABEL + " " + entry.count + "問", done: true, tag: TAG, autoSource: "leap", auto: true };
  }
  // 表示・集計用のクエスト一覧：[{item, idx, auto}]。idxは store の quests 配列の添字（自動記録は -1）
  function displayQuests(quests, leapAuto, key){
    var e = leapAuto && leapAuto[key];
    var list = [];
    (quests || []).forEach(function(q, i){
      if(e && isLegacyLeapQuest(q)) return;
      list.push({ item: q, idx: i, auto: false });
    });
    if(e) list.push({ item: leapAutoQuest(e), idx: -1, auto: true });
    return list;
  }
  function displayItems(quests, leapAuto, key){
    return displayQuests(quests, leapAuto, key).map(function(x){ return x.item; });
  }
  // store.days のキーと leapAuto のキーの和集合（昇順）
  function allDayKeys(days, leapAuto){
    var seen = {};
    Object.keys(days || {}).forEach(function(k){ seen[k] = 1; });
    Object.keys(leapAuto || {}).forEach(function(k){ seen[k] = 1; });
    return Object.keys(seen).sort();
  }
  function earliestLeapDate(leapAuto){
    var ks = Object.keys(leapAuto || {}).sort();
    return ks.length ? ks[0] : "";
  }

  var api = {
    LABEL: LABEL, TAG: TAG,
    normalizeLeapAuto: normalizeLeapAuto,
    isLegacyLeapQuest: isLegacyLeapQuest,
    leapAutoQuest: leapAutoQuest,
    displayQuests: displayQuests,
    displayItems: displayItems,
    allDayKeys: allDayKeys,
    earliestLeapDate: earliestLeapDate
  };
  if(typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DQLeapAuto = api;
})(typeof window !== "undefined" ? window : this);
