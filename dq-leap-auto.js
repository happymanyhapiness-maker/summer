// ===== 各学習アプリの自動記録（デイリークエストの表示用に合成する） =====
// 各アプリ側は dailyquest-logs/{uid} ドキュメントのトップレベルの専用フィールドに、
// JST日付ごとの回答数 { "YYYY-MM-DD": {date, source, count, updatedAt} } だけを書き込む。
//   leap        → leapAuto
//   eikomi      → eikomiAuto
//   kyotsu-math → kyotsuMathAuto
// デイリークエスト本体の store（dataフィールドのJSON）とは別フィールドなので、
// こちらの保存（setDoc merge:true で data/clientUpdatedAt だけ書く）と各アプリの書き込みは互いに上書きしない。
// デイリークエスト側はこれらを読むだけ（書かない）。表示・集計のときに通常クエストと合成する。
// 以前の手動反映で store に入った {autoSource:"leap"|"eikomi"|"kyotsu-math"} のクエストは消さない。
// 同じ日に新フィールド側の記録がある時だけ表示から外す（二重表示防止）。
(function(root){
  "use strict";
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  // 1ソース分の正規化・表示合成ロジックをまとめて作る（leap/eikomi/kyotsu-math で共通処理を使い回す）。
  function makeAutoSource(sourceKey, label, tag){
    function normalize(raw){
      var out = {};
      if(!raw || typeof raw !== "object") return out;
      Object.keys(raw).forEach(function(k){
        var e = raw[k];
        if(!DAY_RE.test(k) || !e || typeof e !== "object") return;
        var c = Math.floor(Number(e.count));
        if(!(c > 0)) return;
        out[k] = { date: k, source: sourceKey, count: c, updatedAt: Number(e.updatedAt) || 0 };
      });
      return out;
    }
    function isLegacyQuest(q){ return !!(q && q.autoSource === sourceKey); }
    function autoQuest(entry){
      return { label: label + " " + entry.count + "問", done: true, tag: tag, autoSource: sourceKey, auto: true };
    }
    // 表示・集計用のクエスト一覧：[{item, idx, auto}]。idxは store の quests 配列の添字（自動記録は -1）
    function displayQuests(quests, autoMap, key){
      var e = autoMap && autoMap[key];
      var list = [];
      (quests || []).forEach(function(q, i){
        if(e && isLegacyQuest(q)) return;
        list.push({ item: q, idx: i, auto: false });
      });
      if(e) list.push({ item: autoQuest(e), idx: -1, auto: true });
      return list;
    }
    function displayItems(quests, autoMap, key){
      return displayQuests(quests, autoMap, key).map(function(x){ return x.item; });
    }
    // store.days のキーと autoMap のキーの和集合（昇順）
    function allDayKeys(days, autoMap){
      var seen = {};
      Object.keys(days || {}).forEach(function(k){ seen[k] = 1; });
      Object.keys(autoMap || {}).forEach(function(k){ seen[k] = 1; });
      return Object.keys(seen).sort();
    }
    function earliestDate(autoMap){
      var ks = Object.keys(autoMap || {}).sort();
      return ks.length ? ks[0] : "";
    }
    return {
      sourceKey: sourceKey, label: label, tag: tag,
      normalize: normalize,
      isLegacyQuest: isLegacyQuest,
      autoQuest: autoQuest,
      displayQuests: displayQuests,
      displayItems: displayItems,
      allDayKeys: allDayKeys,
      earliestDate: earliestDate
    };
  }

  var leapSource = makeAutoSource("leap", "LEAP単語帳（自動記録）", "英語");
  var eikomiSource = makeAutoSource("eikomi", "英コミュ（自動記録）", "英語");
  var kyotsuMathSource = makeAutoSource("kyotsu-math", "kyotsu-math（自動記録）", "数学");

  // 複数ソース（leap/eikomi/kyotsu-math）を1画面分まとめて合成するための小さなヘルパー。
  // sources: [{ def: makeAutoSourceの戻り値, map: そのソースの正規化済みautoMap }]
  // 新しいAutoフィールドの内容は、ここで返すオブジェクトの中だけで一時的に合成され、
  // store／data へは一切書き戻さない。
  function mergeSources(sources){
    function presentSources(key){
      return sources.filter(function(s){ return s.map && s.map[key]; });
    }
    return {
      displayQuests: function(quests, key){
        var present = presentSources(key);
        var list = [];
        (quests || []).forEach(function(q, i){
          var isLegacyOfPresent = present.some(function(s){ return s.def.isLegacyQuest(q); });
          if(isLegacyOfPresent) return;
          list.push({ item: q, idx: i, auto: false });
        });
        present.forEach(function(s){
          list.push({ item: s.def.autoQuest(s.map[key]), idx: -1, auto: true, source: s.def.sourceKey });
        });
        return list;
      },
      displayItems: function(quests, key){
        return this.displayQuests(quests, key).map(function(x){ return x.item; });
      },
      allDayKeys: function(days){
        var seen = {};
        Object.keys(days || {}).forEach(function(k){ seen[k] = 1; });
        sources.forEach(function(s){
          Object.keys(s.map || {}).forEach(function(k){ seen[k] = 1; });
        });
        return Object.keys(seen).sort();
      },
      earliestDate: function(){
        var dates = sources.map(function(s){ return s.def.earliestDate(s.map); }).filter(Boolean);
        return dates.length ? dates.sort()[0] : "";
      }
    };
  }

  var api = {
    // ---- 既存API（leap専用・そのまま後方互換） ----
    LABEL: leapSource.label,
    TAG: leapSource.tag,
    normalizeLeapAuto: leapSource.normalize,
    isLegacyLeapQuest: leapSource.isLegacyQuest,
    leapAutoQuest: leapSource.autoQuest,
    displayQuests: leapSource.displayQuests,
    displayItems: leapSource.displayItems,
    allDayKeys: leapSource.allDayKeys,
    earliestLeapDate: leapSource.earliestDate,
    // ---- 新規：汎用ソース定義とマルチソース合成 ----
    makeAutoSource: makeAutoSource,
    mergeSources: mergeSources,
    sources: { leap: leapSource, eikomi: eikomiSource, kyotsuMath: kyotsuMathSource }
  };
  if(typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DQLeapAuto = api;
})(typeof window !== "undefined" ? window : this);
