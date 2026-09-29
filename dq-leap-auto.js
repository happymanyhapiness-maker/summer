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
  function escHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){ return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; });
  }

  // unit は表示ラベルの単位（既定「問」）。英コミュは問題演習と音読の合算なので「件」。
  // detail（省略可）は内訳の表示定義：{ parts: [{ key, icon, title, word }, ...] }。
  //   各アプリが書く breakdown:{key:件数,...} のうち、0でない項目だけを「icon+件数」で並べる（例：3件 📝2 🎤1）。
  //   breakdown が無い・壊れている・合計が count と合わないときは、内訳を出さず「◯件」だけ（従来どおり）。
  //   内訳は表示用にその場で作るだけで、store／data には保存しない。クエストの数・達成数にも影響しない（項目は1つのまま）。
  function makeAutoSource(sourceKey, label, tag, unit, detail){
    unit = unit || "問";
    // 有効な内訳だけを返す（それ以外は null）。detail の全項目が 0以上の整数で、合計が count と一致するときだけ有効
    function cleanBreakdown(b, count){
      if(!detail || !b || typeof b !== "object") return null;
      var out = {}, sum = 0;
      for(var i = 0; i < detail.parts.length; i++){
        var v = b[detail.parts[i].key];
        if(typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v || v < 0) return null;
        out[detail.parts[i].key] = v;
        sum += v;
      }
      return sum === count ? out : null;
    }
    function normalize(raw){
      var out = {};
      if(!raw || typeof raw !== "object") return out;
      Object.keys(raw).forEach(function(k){
        var e = raw[k];
        if(!DAY_RE.test(k) || !e || typeof e !== "object") return;
        var c = Math.floor(Number(e.count));
        if(!(c > 0)) return;
        out[k] = { date: k, source: sourceKey, count: c, updatedAt: Number(e.updatedAt) || 0 };
        var b = cleanBreakdown(e.breakdown, c);
        if(b) out[k].breakdown = b;
      });
      return out;
    }
    function isLegacyQuest(q){ return !!(q && q.autoSource === sourceKey); }
    function autoQuest(entry){
      var base = label + " " + entry.count + unit;
      var item = { label: base, done: true, tag: tag, autoSource: sourceKey, auto: true };
      var b = cleanBreakdown(entry.breakdown, entry.count);
      if(b){
        var shown = detail.parts.filter(function(p){ return b[p.key] > 0; });
        // label：画面の文字列（絵文字つき）。labelHtml：同じ内容に、絵文字ごとの title（意味）を付けたもの（画面のHTML用）。
        // textLabel：コピー用テキストなど、絵文字が伝わらない場所向け（「（問題2・音読1）」）
        item.label = base + " " + shown.map(function(p){ return p.icon + b[p.key]; }).join(" ");
        item.labelHtml = escHtml(base) + " " + shown.map(function(p){
          return '<span class="auto-detail" title="' + escHtml(p.title) + '" style="white-space:nowrap;">' + p.icon + b[p.key] + '</span>';
        }).join(" ");
        item.textLabel = base + "（" + shown.map(function(p){ return p.word + b[p.key]; }).join("・") + "）";
      }
      return item;
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

  // LEAP：回答を「新規（復習以外の学習）」と「復習」に分ける。内訳は 🆕=新規 / 🔁=復習。
  //   復習＝4択の復習・苦手、ホームの復習、本の復習、見直し。それ以外（新規・全単語・チャレンジ・本・学習など）は新規。
  //   キーは LEAP が書く breakdown:{new, review}。
  var leapSource = makeAutoSource("leap", "LEAP単語帳（自動記録）", "英語", "問", {
    parts: [
      { key: "new", icon: "🆕", title: "新規（復習以外の学習）", word: "新規" },
      { key: "review", icon: "🔁", title: "復習", word: "復習" }
    ]
  });
  // 英コミュ：問題演習(q)と音読(listen)の合算。内訳は 📝=問題 / 🎤=音読
  var eikomiSource = makeAutoSource("eikomi", "英コミュ（自動記録）", "英語", "件", {
    parts: [
      { key: "q", icon: "📝", title: "問題", word: "問題" },
      { key: "listen", icon: "🎤", title: "音読", word: "音読" }
    ]
  });
  // 数学：回答を「通常」と「復習」（復習モード・期限復習）に分ける。内訳は 📘=通常 / 🔁=復習。
  //   キーは 数学アプリが書く breakdown:{normal, review}。
  var kyotsuMathSource = makeAutoSource("kyotsu-math", "kyotsu-math（自動記録）", "数学", "問", {
    parts: [
      { key: "normal", icon: "📘", title: "通常", word: "通常" },
      { key: "review", icon: "🔁", title: "復習", word: "復習" }
    ]
  });

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

  // ===== アプリとの連携状況（見守りの概要に出す。表示専用で、何も書き込まない） =====
  // 各アプリが書いた自動記録（正規化済みのautoMap）から「最後に記録が届いた日・時刻」を、
  // アプリが同期のたびに更新している要約ドキュメントの updatedAt（heartbeats）から「最後に同期した時刻」を出す。
  // LEAPには要約ドキュメントが無いので、最終同期は出さない（最終記録だけ）。
  // 最終同期が STALE_MS 以上前のときだけ stale。「学習していない」場合も同じ見え方になるので、文言は断定しない。
  var LINK_STALE_MS = 72 * 3600 * 1000;
  var LINK_APPS = [
    { key: "leap", label: "LEAP単語帳", hasSync: false },
    { key: "eikomi", label: "英コミュ", hasSync: true },
    { key: "kyotsuMath", label: "数学", hasSync: true }
  ];
  // maps: { leap, eikomi, kyotsuMath }（各normalize済み）／heartbeats: { eikomi, kyotsuMath }（ms。無い・不明は 0/null）
  function summarizeLinks(maps, heartbeats, nowMs){
    maps = maps || {};
    heartbeats = heartbeats || {};
    return LINK_APPS.map(function(a){
      var map = maps[a.key] || {};
      var keys = Object.keys(map).sort();
      var lastRecordAt = 0;
      keys.forEach(function(k){
        var t = Number(map[k] && map[k].updatedAt) || 0;
        if(t > lastRecordAt) lastRecordAt = t;
      });
      var hb = a.hasSync ? Number(heartbeats[a.key]) : 0;
      if(!(hb > 0)) hb = 0;   // 不明・不正（NaN・負数・null）は 0＝不明。警告もしない
      return {
        key: a.key, label: a.label,
        lastRecordDate: keys.length ? keys[keys.length - 1] : "",
        lastRecordAt: lastRecordAt,
        hasSync: a.hasSync,
        lastSyncAt: hb,
        stale: a.hasSync && hb > 0 && (nowMs - hb) >= LINK_STALE_MS
      };
    });
  }
  // 「9/29 22:04（3時間前）」。日時はJST固定（家族は日本で使う）。未来（端末の時計ずれ）は「たった今」
  function linkTimeText(ts, nowMs){
    ts = Number(ts);
    if(!(ts > 0)) return "";
    var d = new Date(ts + 9 * 3600 * 1000);
    function p2(n){ return (n < 10 ? "0" : "") + n; }
    var abs = (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + " " + p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes());
    var diff = nowMs - ts, rel;
    if(diff < 60000) rel = "たった今";
    else if(diff < 3600000) rel = Math.floor(diff / 60000) + "分前";
    else if(diff < 86400000) rel = Math.floor(diff / 3600000) + "時間前";
    else rel = Math.floor(diff / 86400000) + "日前";
    return abs + "（" + rel + "）";
  }

  var api = {
    // ---- アプリとの連携状況 ----
    LINK_STALE_MS: LINK_STALE_MS,
    summarizeLinks: summarizeLinks,
    linkTimeText: linkTimeText,
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
