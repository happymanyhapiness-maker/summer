// dq-firebase-sync.js
// デイリークエスト用 Firebase Authentication + Firestore 同期モジュール
// LEAP単語帳アプリの firebase-sync.js と同じ構成・同じプロジェクト/UIDを流用し、
// Firestoreのコレクションだけ "dailyquest-logs" に分けて、データが混ざらないようにしてある。
// 使い方: index.html で <script type="module" src="dq-firebase-sync.js?v=..."></script> として読み込む。
// index.html本体からは window.FirebaseSync 経由で呼び出す。

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// Firebase Console > プロジェクトの設定 > マイアプリ から取得したconfig（leap-app-syncプロジェクトを流用）
const firebaseConfig = {
  apiKey: "AIzaSyBkrhdO_041b7Hi0nyAY8p--uHRYoFKUqk",
  authDomain: "leap-app-sync.firebaseapp.com",
  projectId: "leap-app-sync",
  storageBucket: "leap-app-sync.firebasestorage.app",
  messagingSenderId: "734689387742",
  appId: "1:734689387742:web:102895181b561af204ce4f"
};

// 3人のUID（LEAPアプリと同じ。Firestoreセキュリティルール側の値と必ず一致させること）
const ADMIN_UID = "eVm3klGUSpcxRPtxN7NHo4lYx7f2";
const CHILD_UID = "hjWTc7Ll0UeHv5iKbRTlTLRrY8x1";
const INDEPENDENT_UID = "IMu4q62RGbNs2y5MXu0yJ0OfYgU2";

// このアプリ専用のコレクション名（LEAPの"logs"とは別物なので混ざらない）
const LOGS_COLLECTION = "dailyquest-logs";

// kyotsu-mathアプリ（共通テスト数学）が同期のたびに書き込む学習サマリー
// {lastStudiedAt, todayCount, totalCount, updatedAt} だけの軽量ドキュメント
const KYOTSU_MATH_SUMMARY_COLLECTION = "kyotsu-math-summary";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

var currentUser = null;
var authReadyFired = false;
var authReadyCallbacks = [];
var isFirstAuthEvent = true;

function roleOf(uid){
  if(uid===ADMIN_UID)return "admin";
  if(uid===CHILD_UID)return "child";
  if(uid===INDEPENDENT_UID)return "independent";
  return null;
}

onAuthStateChanged(auth, function(user){
  currentUser = user || null;

  if(!authReadyFired){
    authReadyFired = true;
    var cbs = authReadyCallbacks;
    authReadyCallbacks = [];
    for(var i=0;i<cbs.length;i++){
      try{cbs[i](currentUser);}catch(e){}
    }
  }

  if(isFirstAuthEvent){
    isFirstAuthEvent = false;
  }else{
    try{
      window.dispatchEvent(new CustomEvent("firebaseAuthChanged", {detail:{user:currentUser}}));
    }catch(e){}
  }
});

function onReady(cb){
  if(authReadyFired){
    cb(currentUser);
  }else{
    authReadyCallbacks.push(cb);
  }
}

function login(email, password){
  return signInWithEmailAndPassword(auth, email, password);
}

function logout(){
  return signOut(auth);
}

function currentUid(){
  return currentUser ? currentUser.uid : null;
}

function currentEmail(){
  return currentUser ? currentUser.email : null;
}

function currentRole(){
  return currentUser ? roleOf(currentUser.uid) : null;
}

// ===== デイリークエストのデータ(logs) =====
// 自分のデータは常に自分のuidへ書き込む。読み込みは自分、または管理者が子のデータを見る場合のみ
// （Firestoreセキュリティルール側で許可範囲を制御している）
function pushLogs(data){
  var uid = currentUid();
  if(!uid)return Promise.resolve();
  var payload = {};
  for(var k in data){payload[k]=data[k];}
  payload.updatedAt = serverTimestamp();
  return setDoc(doc(db,LOGS_COLLECTION,uid), payload, {merge:true});
}

function pullLogs(uid){
  uid = uid || currentUid();
  if(!uid)return Promise.resolve(null);
  return getDoc(doc(db,LOGS_COLLECTION,uid)).then(function(snap){
    return snap.exists() ? snap.data() : null;
  }).catch(function(){return null;});
}

function watchChildLogs(callback){
  // 管理者専用：子供のデイリークエストをリアルタイムで見守る
  if(currentRole()!=="admin")return function(){};
  return onSnapshot(doc(db,LOGS_COLLECTION,CHILD_UID), function(snap){
    callback(snap.exists() ? snap.data() : null);
  });
}

// ===== kyotsu-mathアプリの学習サマリー連携 =====
// kyotsu-math側（firebase-sync.js）が同期のたびに書き込んでいる
// {lastStudiedAt, todayCount, totalCount, updatedAt} を読むだけ。
// 自分（子供本人）でログインしていても、admin（保護者）でログインしていても、
// 常に子供のuid（CHILD_UID）を見に行く。
function pullKyotsuMathSummary(){
  return getDoc(doc(db,KYOTSU_MATH_SUMMARY_COLLECTION,CHILD_UID)).then(function(snap){
    return snap.exists() ? snap.data() : null;
  }).catch(function(){return null;});
}

function watchKyotsuMathSummary(callback){
  return onSnapshot(doc(db,KYOTSU_MATH_SUMMARY_COLLECTION,CHILD_UID), function(snap){
    callback(snap.exists() ? snap.data() : null);
  }, function(){ /* 権限エラー等は無視して黙る */ });
}

window.FirebaseSync = {
  onReady: onReady,
  login: login,
  logout: logout,
  currentUid: currentUid,
  currentEmail: currentEmail,
  currentRole: currentRole,
  pushLogs: pushLogs,
  pullLogs: pullLogs,
  watchChildLogs: watchChildLogs,
  pullKyotsuMathSummary: pullKyotsuMathSummary,
  watchKyotsuMathSummary: watchKyotsuMathSummary,
  ADMIN_UID: ADMIN_UID,
  CHILD_UID: CHILD_UID,
  INDEPENDENT_UID: INDEPENDENT_UID
};
