"use strict";
/*
 * Plannerのクラウド同期（dailyquest-logs）をロールで絞るテスト。
 * dq-firebase-sync.js 本体（import だけ外してFirebaseをモック）と、index.html の実際の同期関数
 * （isCloudSyncTarget / persist / scheduleCloudSync / pushStoreSnapshot / initFirebaseBootstrap）を同じvmで動かす。
 * モックFirestoreは本番Rulesと同じ判定で permission-denied を返し、read/write/denied を数える。
 * 本番Firebaseには一切つながない。
 * 実行方法: node --test tests/*.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const L = require("../dq-leap-auto.js");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/\r\n/g, "\n");
const syncSrc = fs.readFileSync(path.join(root, "dq-firebase-sync.js"), "utf8").replace(/\r\n/g, "\n")
  .replace(/^import[\s\S]*?;\n/gm, "");

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

const ADMIN = "eVm3klGUSpcxRPtxN7NHo4lYx7f2";
const CHILD = "hjWTc7Ll0UeHv5iKbRTlTLRrY8x1";
const INDEP = "IMu4q62RGbNs2y5MXu0yJ0OfYgU2";
const OUTSIDER = "someOtherAuthedUser000000001";

function makeEnv(remoteDoc){
  var log = { reads: [], writes: [], denied: [] };
  var authCb = null, timers = [], visHandlers = [], reloads = 0;
  var lsData = {};
  var ctx = {
    console: console, JSON: JSON, Math: Math, Date: Date, Promise: Promise, DQLeapAuto: L,
    CustomEvent: function(type, init){ this.type = type; this.detail = init && init.detail; },
    setTimeout: function(fn){ timers.push(fn); return timers.length; },
    clearTimeout: function(id){ timers[id - 1] = null; },
    localStorage: { getItem: function(k){ return k in lsData ? lsData[k] : null; }, setItem: function(k, v){ lsData[k] = String(v); }, removeItem: function(k){ delete lsData[k]; } },
    location: { reload: function(){ reloads++; } },
    document: {
      visibilityState: "visible",
      addEventListener: function(t, fn){ if(t === "visibilitychange")visHandlers.push(fn); }
    },
    // ---- Firebase モック（Rules相当の判定） ----
    initializeApp: function(){ return {}; },
    getAuth: function(){ return {}; },
    getFirestore: function(){ return {}; },
    onAuthStateChanged: function(a, cb){ authCb = cb; },
    signInWithEmailAndPassword: function(){ return Promise.resolve(); },
    signOut: function(){ return Promise.resolve(); },
    serverTimestamp: function(){ return "TS"; },
    doc: function(db, col, id){ return { col: col, id: id }; },
    getDoc: function(ref){
      var me = ctx.__uid;
      log.reads.push(ref.col + "/" + ref.id);
      var ok = ref.col === "dailyquest-logs" && ref.id === CHILD && (me === CHILD || me === ADMIN);
      if(!ok){ log.denied.push("read " + ref.col + "/" + ref.id); return Promise.reject({ code: "permission-denied" }); }
      return Promise.resolve({ exists: function(){ return !!remoteDoc; }, data: function(){ return remoteDoc; } });
    },
    setDoc: function(ref, payload){
      var me = ctx.__uid;
      log.writes.push({ path: ref.col + "/" + ref.id, payload: payload });
      var ok = ref.col === "dailyquest-logs" && ref.id === CHILD && me === CHILD;
      if(!ok){ log.denied.push("write " + ref.col + "/" + ref.id); return Promise.reject({ code: "permission-denied" }); }
      return Promise.resolve();
    },
    onSnapshot: function(){ return function(){}; }
  };
  ctx.window = ctx;
  ctx.dispatchEvent = function(ev){ if(ev.type === "firebaseAuthChanged")ctx.location.reload(); };
  ctx.addEventListener = function(){};
  // 画面側の描画系はスタブ（同期の入口だけを見る）
  ctx.renderSettings = function(){};
  ctx.renderAllScreens = function(){};
  ctx.todaySystemKey = function(){ return "2026-09-27"; };
  ctx.enterWatchMode = function(){
    vm.runInContext("watchMode = true;", ctx);
    ctx.window.FirebaseSync.pullLogs(ctx.window.FirebaseSync.CHILD_UID);  // loadWatchData 相当（読むだけ）
  };
  vm.createContext(ctx);
  vm.runInContext(syncSrc, ctx);
  vm.runInContext(
    'var STORAGE_KEY = "dailyquest_v1"; var watchMode = false; var activeDate = ""; var leapAuto = {}, eikomiAuto = {}, kyotsuMathAuto = {};' +
    'var store = { days: {}, appStartDate: "2026-09-01", _updatedAt: 0 };',
    ctx);
  ["setLeapAuto", "setEikomiAuto", "setKyotsuMathAuto", "isCloudSyncTarget", "persist", "scheduleCloudSync", "pushStoreSnapshot", "initFirebaseBootstrap"]
    .forEach(function(n){ vm.runInContext(extractFunction(n), ctx); });
  vm.runInContext("var _cloudSyncTimer = null;", ctx);
  vm.runInContext('const LEAP_AUTO_CACHE_KEY="a", EIKOMI_AUTO_CACHE_KEY="b", KYOTSU_MATH_AUTO_CACHE_KEY="c";', ctx);

  var env = {
    ctx: ctx, log: log, lsData: lsData,
    get reloads(){ return reloads; },
    run: function(code){ return vm.runInContext(code, ctx); },
    signIn: function(uid){ ctx.__uid = uid; authCb(uid ? { uid: uid, email: uid + "@x" } : null); },
    runTimers: function(){ var t = timers; timers = []; t.forEach(function(fn){ if(fn)fn(); }); },
    pendingTimers: function(){ return timers.filter(Boolean).length; },
    fireVisible: function(){ visHandlers.forEach(function(fn){ fn(); }); },
    flush: function(){ return new Promise(function(r){ setImmediate(r); }); }
  };
  return env;
}

// 起動 → auth判定前の操作 → auth確定 → 手動操作 → reset → 再表示 までを通す
async function fullSession(uid, remoteDoc){
  var env = makeEnv(remoteDoc);
  env.run("initFirebaseBootstrap()");
  // auth判定前の手動操作（persist）→ 予約すらされない
  env.run('store.days["2026-09-27"] = { quests: [{ label: "前", done: true }] }; persist();');
  assert.equal(env.pendingTimers(), 0, "auth判定前は同期を予約しない");
  env.runTimers();
  assert.equal(env.log.reads.length + env.log.writes.length, 0, "auth判定前はFirestoreへ行かない");
  env.signIn(uid);
  await env.flush(); await env.flush();
  env.runTimers(); await env.flush();
  // 手動クエスト操作
  env.run('store.days["2026-09-27"].quests.push({ label: "後", done: false }); persist();');
  env.runTimers(); await env.flush();
  // reset（resetAllBtn のハンドラと同じ手順）
  env.run('localStorage.removeItem(STORAGE_KEY); store = { days: {}, appStartDate: "2026-09-27" }; persist();');
  env.runTimers(); await env.flush();
  // 再表示
  env.fireVisible(); await env.flush(); await env.flush();
  env.runTimers(); await env.flush();
  return env;
}

const REMOTE = {
  data: JSON.stringify({ days: {}, appStartDate: "2026-09-01" }),
  clientUpdatedAt: 1,
  leapAuto: { "2026-09-26": { count: 30, updatedAt: 1 } },
  eikomiAuto: { "2026-09-26": { count: 5, updatedAt: 1 } },
  kyotsuMathAuto: { "2026-09-26": { count: 7, updatedAt: 1 } }
};

test("child C：cloud read/write する・dataを従来どおり同期・Auto 3種を読み込む・permission-deniedなし", async function(){
  var env = await fullSession(CHILD, REMOTE);
  assert.ok(env.log.reads.length >= 2, "起動時と再表示時に読む");
  assert.ok(env.log.reads.every(function(p){ return p === "dailyquest-logs/" + CHILD; }));
  assert.ok(env.log.writes.length >= 1, "書き込む");
  env.log.writes.forEach(function(w){
    assert.equal(w.path, "dailyquest-logs/" + CHILD);
    assert.deepEqual(Object.keys(w.payload).sort(), ["clientUpdatedAt", "data", "updatedAt"], "data/clientUpdatedAt だけを書く（Autoフィールドは書かない）");
  });
  var last = JSON.parse(env.log.writes[env.log.writes.length - 1].payload.data);
  assert.equal(last.appStartDate <= "2026-09-26", true, "Auto由来の開始日繰り上げも含めて同期される");
  assert.equal(env.run("leapAuto")["2026-09-26"].count, 30);
  assert.equal(env.run("eikomiAuto")["2026-09-26"].count, 5);
  assert.equal(env.run("kyotsuMathAuto")["2026-09-26"].count, 7);
  assert.deepEqual(env.log.denied, []);
});

test("child C：クラウドにdataが無いときは初回pushする（従来どおり）", async function(){
  var env = makeEnv(null);
  env.run("initFirebaseBootstrap()");
  env.signIn(CHILD);
  await env.flush(); await env.flush();
  assert.equal(env.log.writes.length, 1);
  assert.equal(env.log.writes[0].path, "dailyquest-logs/" + CHILD);
  assert.deepEqual(env.log.denied, []);
});

test("guardian G：見守りモードに入り、子のdocを読むだけ・Planner dataを書かない", async function(){
  var env = await fullSession(ADMIN, REMOTE);
  assert.equal(env.run("watchMode"), true);
  assert.ok(env.log.reads.length >= 1);
  assert.ok(env.log.reads.every(function(p){ return p === "dailyquest-logs/" + CHILD; }), "自分のuidのdocは読まない");
  assert.equal(env.log.writes.length, 0);
  assert.deepEqual(env.log.denied, []);
});

[["independent I", INDEP], ["family外 X", OUTSIDER]].forEach(function(pair){
  test(pair[0] + "：Firestore read 0 / write 0 / permission-denied 0、ローカル保存は維持", async function(){
    var env = await fullSession(pair[1], REMOTE);
    assert.equal(env.log.reads.length, 0, "read 0");
    assert.equal(env.log.writes.length, 0, "write 0");
    assert.deepEqual(env.log.denied, [], "permission-denied 0");
    assert.equal(env.run("watchMode"), false, "見守りには入らない");
    assert.ok(env.lsData.dailyquest_v1, "端末内には保存される");
    assert.equal(JSON.parse(env.lsData.dailyquest_v1).appStartDate, "2026-09-27", "reset後の内容もローカル保存");
  });
});

test("未ログイン：既存どおりローカルだけ（Firestoreへ行かない）", async function(){
  var env = await fullSession(null, REMOTE);
  assert.equal(env.log.reads.length + env.log.writes.length, 0);
  assert.ok(env.lsData.dailyquest_v1);
});

test("child の予約済みpushが、発火前にI/Xへ切り替わっても書かない（debounce済み予約）", async function(){
  var env = makeEnv(REMOTE);
  env.run("initFirebaseBootstrap()");
  env.signIn(CHILD);
  await env.flush(); await env.flush();
  env.runTimers(); await env.flush();
  var before = env.log.writes.length;
  env.run("persist();");
  assert.equal(env.pendingTimers(), 1);
  env.signIn(INDEP);                   // auth変化（→ firebaseAuthChanged → reload 予定）
  assert.equal(env.reloads, 1);
  env.runTimers(); await env.flush();  // reload前に予約が発火しても
  assert.equal(env.log.writes.length, before, "I に切り替わった後は書かない");
  assert.deepEqual(env.log.denied, []);
});

test("モジュール単体：child以外は pushLogs / 自uidの pullLogs がFirestoreへ行かない", async function(){
  for(const uid of [INDEP, OUTSIDER, ADMIN]){
    var env = makeEnv(REMOTE);
    env.signIn(uid);
    await env.ctx.FirebaseSync.pushLogs({ data: "{}", clientUpdatedAt: 1 });
    await env.ctx.FirebaseSync.pullLogs();
    assert.equal(env.log.writes.length, 0, uid + " write 0");
    assert.equal(env.log.reads.length, 0, uid + " read 0");
  }
  var g = makeEnv(REMOTE);
  g.signIn(ADMIN);
  var r = await g.ctx.FirebaseSync.pullLogs(CHILD);
  assert.ok(r && r.data, "保護者は子のdocを読める（見守り）");
});

test("cache bust：dq-firebase-sync.js の version を上げている", function(){
  assert.match(html, /<script type="module" src="dq-firebase-sync\.js\?v=3"><\/script>/);
});
