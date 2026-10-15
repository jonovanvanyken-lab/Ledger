/* Kč Ledger — everything stays on this phone, encrypted.
   A random data key encrypts the ledger and images. That key is stored wrapped by your passcode
   (PBKDF2-SHA256, 600k rounds → AES-GCM) and, if you turn it on, by a Face ID passkey (WebAuthn PRF → HKDF → AES-GCM). */
(function(){
"use strict";
const EXP_CATS=["Rent","Groceries","Eating out & cafés","Gas & electricity","Travel","Clothing & misc","Household & cleaning","Gym & hobbies","Health & pharmacy","Public transport","Phone"];
const SAVE_CATS=["Emergency savings","Investing"];
const INC_CATS=["Salary","Rental income","Transfer from Australia","Interest","Other income"];
const AU_CAT="Transfer from Australia";
const ITER=600000,DAY=864e5;
const $=id=>document.getElementById(id);
const te=new TextEncoder(),td=new TextDecoder();
const b64=buf=>{let s="";const b=buf instanceof Uint8Array?buf:new Uint8Array(buf);for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s)};
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const rnd=n=>crypto.getRandomValues(new Uint8Array(n));
const parseNum=s=>{const v=parseFloat(String(s).replace(/\s/g,"").replace(",","."));return isFinite(v)?v:NaN};
const pad=n=>String(n).padStart(2,"0");
const mKey=(y,m)=>"m-"+y+"-"+pad(m+1);
const keyYM=k=>({y:+k.slice(2,6),m:+k.slice(7,9)-1});
const mName=(y,m,short)=>new Date(y,m,1).toLocaleDateString("en-GB",short?{month:"short"}:{month:"long",year:"numeric"});
const iso=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const todayIso=()=>iso(new Date());
const uid=p=>(p||"")+Date.now().toString(36)+b64(rnd(6)).replace(/[^a-z0-9]/gi,"").slice(0,6);
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
let toastT;function toast(t){const d=$("toast");d.textContent=t;d.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>d.hidden=true,3400)}

/* ---------- money formatting (CZK or AUD display) ---------- */
function dispAUD(){return (docs.settings||{}).dispCur==="AUD"&&rateOf("AUD")>0}
function conv(n){return dispAUD()?n/rateOf("AUD"):n}
function fmt(n){const v=conv(Number(n)||0);return dispAUD()?(v<0?"−":"")+"A$"+new Intl.NumberFormat("en-AU",{maximumFractionDigits:0}).format(Math.abs(Math.round(v))):new Intl.NumberFormat("cs-CZ",{maximumFractionDigits:0}).format(Math.round(v))+" Kč"}
const fmtCur=(n,c)=>new Intl.NumberFormat("cs-CZ",{maximumFractionDigits:2}).format(n)+" "+c;
function short(n){const v=conv(n);return Math.abs(v)>=1000?(Math.round(v/100)/10)+"k":String(Math.round(v))}

/* ---------- IndexedDB: one encrypted ledger record + encrypted images ---------- */
let dbp=null;
function idb(){return dbp||(dbp=new Promise((res,rej)=>{const r=indexedDB.open("kc-ledger",2);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("vault"))d.createObjectStore("vault");if(!d.objectStoreNames.contains("files"))d.createObjectStore("files")};r.onsuccess=()=>res(r.result);r.onerror=()=>{dbp=null;rej(r.error)}}))}
function tx(store,mode,fn){return idb().then(d=>new Promise((res,rej)=>{const t=d.transaction(store,mode);const st=t.objectStore(store);let out;const q=fn(st);if(q)q.onsuccess=()=>out=q.result;t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error)}))}
const idbGet=()=>tx("vault","readonly",st=>st.get("main")).then(v=>v||null);
const idbPut=v=>tx("vault","readwrite",st=>st.put(v,"main"));
const idbDel=()=>tx("vault","readwrite",st=>st.delete("main"));
const fileGet=id=>tx("files","readonly",st=>st.get(id));
const filePut=(id,v)=>tx("files","readwrite",st=>st.put(v,id));
const fileDel=id=>tx("files","readwrite",st=>st.delete(id));
const fileClear=()=>tx("files","readwrite",st=>st.clear());
function fileAll(){return idb().then(d=>new Promise((res,rej)=>{const out={};const t=d.transaction("files");const c=t.objectStore("files").openCursor();c.onsuccess=()=>{const cur=c.result;if(cur){out[cur.key]=cur.value;cur.continue()}};t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error)}))}

/* ---------- crypto ---------- */
async function passKey(pass,salt,iter){const base=await crypto.subtle.importKey("raw",te.encode(pass),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:iter,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
const dataKey=raw=>crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"]);
async function wrap(raw,wk){const iv=rnd(12);return {iv:b64(iv),ct:b64(await crypto.subtle.encrypt({name:"AES-GCM",iv},wk,raw))}}
async function unwrap(w,wk){return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(w.iv)},wk,unb64(w.ct)))}
async function encBytes(k,bytes){const iv=rnd(12);return {iv:b64(iv),ct:await crypto.subtle.encrypt({name:"AES-GCM",iv},k,bytes)}}
async function decBytes(k,rec){return crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(rec.iv)},k,rec.ct instanceof ArrayBuffer?rec.ct:unb64(rec.ct))}
async function seal(){const iv=rnd(12);const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,te.encode(JSON.stringify(docs)));return {kind:"kc-vault",v:2,keys,iv:b64(iv),ct:b64(ct),saved:Date.now()}}
async function openBody(k,rec){return JSON.parse(td.decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(rec.iv)},k,unb64(rec.ct))))}
// Opens any vault record with a passcode. Returns {raw,key,docs} or {legacyKey,docs}. Throws on a wrong passcode.
async function openWithPass(rec,pass){
  if(rec.v===2){const p=rec.keys.pass;const raw=await unwrap(p,await passKey(pass,unb64(p.salt),p.iter));const k=await dataKey(raw);return {raw,key:k,docs:await openBody(k,rec)}}
  const lk=await passKey(pass,unb64(rec.salt),rec.iter);const d=await openBody(lk,rec);return {legacyKey:lk,docs:d};
}
async function passWrap(raw,pass){const salt=rnd(16);return {salt:b64(salt),iter:ITER,...(await wrap(raw,await passKey(pass,salt,ITER)))}}

/* ---------- session (cleared on lock) ---------- */
let key=null,rawKey=null,keys=null,docs={},type="expense";
const now=new Date();let cur={y:now.getFullYear(),m:now.getMonth()};
let saving=Promise.resolve();
function persist(){saving=saving.then(async()=>{if(!key)return;await idbPut(await seal())});return saving.catch(e=>{toast("Couldn't save on this phone: "+(e&&e.message||"storage error"));throw e})}
async function startSession(raw,k,d,kk){rawKey=raw;key=k;docs=d||{};keys=kk}
// first-version vault → random data key; re-encrypts images under the new key
async function upgradeLegacy(legacyKey,pass,filesSrc){
  const raw=rnd(32),k=await dataKey(raw);const fs=filesSrc||await fileAll();
  for(const id of Object.keys(fs)){const f=fs[id];const bytes=await decBytes(legacyKey,f);await filePut(id,{...(await encBytes(k,bytes)),type:f.type||"image/jpeg"})}
  return {raw,k,keys:{pass:await passWrap(raw,pass)}};
}

/* ---------- lock screen ---------- */
let mode="unlock";
async function boot(){
  if(!window.crypto||!crypto.subtle||!window.indexedDB){$("lockSub").textContent="This browser can't run Kč Ledger securely. Open it in Safari or Chrome over https.";return}
  let rec=null;try{rec=await idbGet()}catch(e){}
  mode=rec?"unlock":"setup";$("lockForm").hidden=false;$("lockFine").hidden=false;
  $("bioBtn").hidden=!(rec&&rec.v===2&&rec.keys&&rec.keys.prf);
  if(mode==="setup"){$("lockSub").textContent="Choose a passcode to encrypt your ledger on this phone. Use at least 6 characters.";$("pass1Label").textContent="New passcode";$("pass2Wrap").hidden=false;$("lockBtn").textContent="Create ledger";$("pass2").required=true}
  else{$("lockSub").textContent=$("bioBtn").hidden?"Enter your passcode to unlock.":"Unlock with Face ID, or enter your passcode.";$("pass1Label").textContent="Passcode";$("pass2Wrap").hidden=true;$("lockBtn").textContent="Unlock";$("pass2").required=false}
  if($("bioBtn").hidden)setTimeout(()=>$("pass1").focus(),50);
}
$("lockForm").addEventListener("submit",async e=>{
  e.preventDefault();const p1=$("pass1").value,h=$("lockHint");h.className="hint";
  if(p1.length<6){h.textContent="Use at least 6 characters.";h.className="hint err";return}
  $("lockBtn").disabled=true;
  try{
    if(mode==="setup"){
      if(p1!==$("pass2").value){h.textContent="The two passcodes don't match.";h.className="hint err";return}
      h.textContent="Setting up encryption…";const raw=rnd(32);
      await startSession(raw,await dataKey(raw),{},{pass:await passWrap(raw,p1)});
      await persist();try{await navigator.storage?.persist?.()}catch(_){}
    }else{
      h.textContent="Unlocking…";const rec=await idbGet();let o;
      try{o=await openWithPass(rec,p1)}catch(_){h.textContent="That passcode didn't work. Try again.";h.className="hint err";$("pass1").select();return}
      if(o.legacyKey){h.textContent="Upgrading your ledger's encryption…";const u=await upgradeLegacy(o.legacyKey,p1);await startSession(u.raw,u.k,o.docs,u.keys);await persist()}
      else await startSession(o.raw,o.key,o.docs,rec.keys);
    }
    $("pass1").value="";$("pass2").value="";h.textContent="";await enterApp();
  }finally{$("lockBtn").disabled=false}
});
async function enterApp(){
  $("fDate").value=defaultDate();$("lock").hidden=true;$("app").hidden=false;
  await migrate();showTab(docs.settings?"overview":"settings");render();armIdle();
  if(!docs.settings)toast("Start by importing your starter file or bank CSVs.");
  updateRates(false);
}
function lock(){
  key=null;rawKey=null;keys=null;docs={};closeViewer();closeReview();closeSheet();
  ["ledger","bars","accts","trend","pace","bills","donut","donutLegend","heat","dayList","merchants","goals","invSplit","invChart","netChart","auChart","banners","recap","setBudget","setSave","billsEditor"].forEach(id=>$(id).replaceChildren());
  document.querySelectorAll("#app input").forEach(i=>{if(i.type!=="file"&&i.type!=="checkbox")i.value=""});
  $("app").hidden=true;$("lock").hidden=false;boot();
}
$("lockNow").addEventListener("click",lock);
let hiddenAt=0,idleT=null;
const lockMins=()=>Number((docs.settings||{}).autoLock)||1;
function armIdle(){clearTimeout(idleT);if(key)idleT=setTimeout(lock,lockMins()*60000)}
["pointerdown","keydown","scroll","touchstart"].forEach(ev=>addEventListener(ev,armIdle,{passive:true}));
document.addEventListener("visibilitychange",()=>{if(document.hidden)hiddenAt=Date.now();else if(key&&hiddenAt&&Date.now()-hiddenAt>lockMins()*60000)lock()});

/* ---------- Face ID (passkey with the PRF extension) ---------- */
async function prfKey(out){const base=await crypto.subtle.importKey("raw",out,"HKDF",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt:te.encode("kc-ledger"),info:te.encode("data-key-wrap")},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
async function prfEval(credB64,saltB64){
  const a=await navigator.credentials.get({publicKey:{challenge:rnd(32),rpId:location.hostname,allowCredentials:[{type:"public-key",id:unb64(credB64)}],userVerification:"required",timeout:60000,
    extensions:{prf:{eval:{first:unb64(saltB64)}}}}});
  const r=a&&a.getClientExtensionResults&&a.getClientExtensionResults();const out=r&&r.prf&&r.prf.results&&r.prf.results.first;
  if(!out)throw new Error("noprf");return out;
}
$("bioBtn").addEventListener("click",async()=>{const h=$("lockHint");h.className="hint";
  try{const rec=await idbGet();const p=rec.keys.prf;h.textContent="Waiting for Face ID…";
    const raw=await unwrap(p,await prfKey(await prfEval(p.cred,p.salt)));const k=await dataKey(raw);const d=await openBody(k,rec);
    await startSession(raw,k,d,rec.keys);h.textContent="";await enterApp();
  }catch(e){h.className="hint err";h.textContent=e&&e.message==="noprf"?"Face ID isn't available for this app on this phone. Use your passcode.":"Face ID didn't unlock it. Use your passcode."}});
$("bioToggle").addEventListener("click",async()=>{const info=$("bioInfo");
  if(keys&&keys.prf){delete keys.prf;await persist();renderBio();toast("Face ID unlock turned off");return}
  if(!window.PublicKeyCredential){info.textContent="This browser doesn't support Face ID for web apps.";return}
  try{
    info.textContent="Follow the Face ID prompt…";
    const c=await navigator.credentials.create({publicKey:{rp:{name:"Kč Ledger",id:location.hostname},user:{id:rnd(16),name:"Kč Ledger",displayName:"Kč Ledger"},challenge:rnd(32),
      pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}],authenticatorSelection:{authenticatorAttachment:"platform",residentKey:"preferred",userVerification:"required"},timeout:60000,extensions:{prf:{}}}});
    const ext=c.getClientExtensionResults?c.getClientExtensionResults():{};if(ext.prf&&ext.prf.enabled===false)throw new Error("noprf");
    const cred=b64(new Uint8Array(c.rawId)),salt=b64(rnd(32));info.textContent="One more Face ID check to finish…";
    const out=await prfEval(cred,salt);keys.prf={cred,salt,...(await wrap(rawKey,await prfKey(out)))};await persist();renderBio();toast("Face ID unlock is on");
  }catch(e){renderBio();info.textContent=e&&e.message==="noprf"?"This phone can't use Face ID for web apps yet (it needs iOS 18 or later). Your passcode still works.":"Face ID wasn't set up. You can try again."}});
function renderBio(){const on=!!(keys&&keys.prf);$("bioToggle").textContent=on?"Turn off":"Turn on";$("bioInfo").textContent=on?"On. Your passcode keeps working too.":"Unlock with Face ID instead of typing your passcode. Your passcode keeps working too."}

/* ---------- data helpers ---------- */
function rateOf(c){if(c==="CZK")return 1;const r=((docs.settings||{}).rates||{})[c];return Number(r)||0}
function settings(){
  const s=docs.settings||{};const budget={},targets={};
  EXP_CATS.forEach(c=>budget[c]=Number((s.budget||{})[c])||0);SAVE_CATS.forEach(c=>targets[c]=Number((s.targets||{})[c])||0);
  const inv=s.invest||{short:0,long:0};
  return {budget,targets,rates:{CZK:1,AUD:rateOf("AUD"),EUR:rateOf("EUR")},invest:{short:Number(inv.short)||0,long:Number(inv.long)||0}};
}
const ensureSettings=()=>docs.settings||(docs.settings={budget:{},targets:{},rates:{},ownAccounts:[],rules:{},autoLock:1});
const items=k=>((docs[k]||{}).items||[]).filter(i=>i&&typeof i==="object");
const monthKeys=()=>Object.keys(docs).filter(k=>/^m-\d{4}-\d{2}$/.test(k)).sort();
function allItems(){const out=[];monthKeys().forEach(k=>items(k).forEach(i=>out.push({k,i})));return out}
function allIds(){return new Set(allItems().map(x=>x.i.id))}
function partsOf(i){return i.type==="expense"&&Array.isArray(i.parts)&&i.parts.length?i.parts:[{cat:i.cat,czk:Number(i.czk)||0}]}
function totals(k){
  const t={expense:0,oneoff:0,saving:0,income:0,fromAU:0,byCat:{}};
  items(k).forEach(i=>{const v=Number(i.czk)||0;
    if(i.type==="expense"){if(i.oneoff){t.oneoff+=v;return}t.expense+=v;partsOf(i).forEach(p=>t.byCat["expense:"+p.cat]=(t.byCat["expense:"+p.cat]||0)+(Number(p.czk)||0))}
    else if(i.type==="income"){if(i.cat===AU_CAT)t.fromAU+=v;else t.income+=v;t.byCat["income:"+i.cat]=(t.byCat["income:"+i.cat]||0)+v}
    else{t.saving+=v;t.byCat["saving:"+i.cat]=(t.byCat["saving:"+i.cat]||0)+v}});
  return t;
}
const budgetTotal=s=>EXP_CATS.reduce((a,c)=>a+s.budget[c],0);
const targetTotal=s=>SAVE_CATS.reduce((a,c)=>a+s.targets[c],0);
const isCurMonth=(y,m)=>now.getFullYear()===y&&now.getMonth()===m;
const prevKey=(y,m)=>{const d=new Date(y,m-1,1);return mKey(d.getFullYear(),d.getMonth())};
const NS="http://www.w3.org/2000/svg";
function svgEl(W,H,label){const s=document.createElementNS(NS,"svg");s.setAttribute("viewBox","0 0 "+W+" "+H);s.setAttribute("width","100%");s.setAttribute("role","img");s.setAttribute("aria-label",label);
  s.add=(tag,attrs,text)=>{const e=document.createElementNS(NS,tag);for(const a in attrs)e.setAttribute(a,attrs[a]);if(text!=null)e.textContent=text;s.appendChild(e);return e};return s}
const boxW=box=>Math.max(280,box.clientWidth||Math.min(688,document.documentElement.clientWidth-64));
function niceTick(max){const step=Math.pow(10,Math.floor(Math.log10(Math.max(1,max)/4)));return [1,2,2.5,5,10].map(x=>x*step).find(x=>max/x<=5)||step*10}
function axisY(svg,max,min,y,pl,W,pr){const tick=niceTick(conv(max-(min||0)));for(let v=Math.ceil(conv(min||0)/tick)*tick;v<=conv(max)+1e-9;v+=tick){const yy=y(dispAUD()?v*rateOf("AUD"):v);
  svg.add("line",{x1:pl,x2:W-pr,y1:yy,y2:yy,stroke:"var(--line)"});svg.add("text",{x:pl-6,y:yy+4,"text-anchor":"end",class:"amt"},v>=1000?(Math.round(v/100)/10)+"k":String(Math.round(v)))}}

/* ---------- one-time upgrades of your data ---------- */
async function migrate(){
  if(!docs.settings)return;const st=docs.settings;st.migrations=st.migrations||[];const done=new Set(st.migrations);let changed=false;
  const run=(id,fn)=>{if(!done.has(id)){fn();st.migrations.push(id);changed=true}};
  run("v3-oneoff",()=>{const ids=new Set(["rb-9627725725","rb-9627725720","rb-9627725716"]);monthKeys().forEach(k=>{docs[k].items=items(k).map(i=>ids.has(i.id)?{...i,oneoff:true}:i)})});
  run("v3-invest",()=>{if(!st.invest)st.invest={short:3000,long:5000};st.targets=st.targets||{};st.targets.Investing=st.invest.short+st.invest.long});
  run("v3-rates",()=>{if(st.autoRates===undefined)st.autoRates=true});
  run("v3-bills",()=>{if(!docs.bills)docs.bills={list:[
    {id:uid("b"),name:"Rent",amount:12800,day:23,cat:"Rent",match:"rent, nájem"},
    {id:uid("b"),name:"ČEZ (700)",amount:700,day:23,cat:"Gas & electricity",match:"čez, cez"},
    {id:uid("b"),name:"ČEZ (1,200)",amount:1200,day:23,cat:"Gas & electricity",match:"čez, cez"},
    {id:uid("b"),name:"Vodafone",amount:966,day:16,cat:"Phone",match:"vodafone"},
    {id:uid("b"),name:"Emergency savings transfer",amount:3000,day:8,cat:"Emergency savings",match:"micro savings, emergency"},
    {id:uid("b"),name:"Investment standing order",amount:1000,day:12,cat:"Investing",match:"investment"}]}});
  run("v3-goals",()=>{if(!docs.goals)docs.goals={list:[
    {id:uid("g"),name:"Emergency fund",target:112200,date:"",start:0,src:"cat:Emergency savings",created:"2026-10-01"},
    {id:uid("g"),name:"Long term savings",target:0,date:"",start:0,src:"inv:long",created:"2026-10-01"}]}});
  run("v3-history",()=>{snapshotNet()});
  if(changed)await persist();
}

/* ---------- tabs ---------- */
function showTab(name){document.querySelectorAll(".tab").forEach(t=>t.hidden=t.id!=="tab-"+name);document.querySelectorAll(".tabbar button").forEach(b=>{if(b.dataset.tab===name)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});scrollTo(0,0);requestAnimationFrame(renderCharts)}
document.querySelectorAll(".tabbar button").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));

/* ---------- render: overview ---------- */
function render(){
  if(!key)return;
  $("monthLabel").textContent=mName(cur.y,cur.m);$("curBtn").textContent=dispAUD()?"A$":"Kč";$("curBtn").setAttribute("aria-label",dispAUD()?"Show amounts in Czech crowns":"Show amounts in Australian dollars");
  const k=mKey(cur.y,cur.m),s=settings(),t=totals(k),bt=budgetTotal(s),tt=targetTotal(s);
  $("kSpent").textContent=fmt(t.expense);$("kSpentOf").textContent="of "+fmt(bt);
  const pct=bt?t.expense/bt:0,pill=$("kSpentPill");pill.className="pill "+(pct>1?"bad":pct>.85?"warn":"ok");pill.textContent=bt?Math.round(pct*100)+"%":"no budget";
  const left=bt-t.expense;$("kLeft").textContent=fmt(left);
  const dim=new Date(cur.y,cur.m+1,0).getDate();
  if(isCurMonth(cur.y,cur.m)&&left>0){const days=dim-new Date().getDate()+1;$("kLeftSub").textContent="≈ "+fmt(left/days)+" a day, "+days+" days left"}
  else $("kLeftSub").textContent=left<0?"over budget":"at month end";
  $("kSaved").textContent=fmt(t.saving);$("kSavedOf").textContent="of "+fmt(tt)+" target";
  $("kIncome").textContent=fmt(t.income);$("kIncomeSub").textContent=t.fromAU?"+ "+fmt(t.fromAU)+" from Australia":"earned this month";
  const os=$("oneoffStrip");os.hidden=!t.oneoff;if(t.oneoff){os.replaceChildren(el("span","","One-off costs, kept out of the budget"),el("b","amt",fmt(t.oneoff)));os.onclick=()=>filterTo("__oneoff")}
  renderBars(t,s);renderBills();renderBanners();renderRecap();renderMerchants();renderEntries();renderGoals();renderInvest();renderAccounts();renderAU();renderBio();
  if(!$("tab-settings").dataset.dirty)fillSettings();if(!$("billsPanel").dataset.dirty)renderBillsEditor();
  renderCharts();
}
function renderCharts(){if(!key)return;renderPace();renderDonut();renderHeat();renderTrend();renderInvChart();renderNet();renderAUChart()}
function renderBars(t,s){
  const box=$("bars");box.replaceChildren();
  EXP_CATS.forEach(c=>{const spent=t.byCat["expense:"+c]||0,b=s.budget[c],p=b?spent/b:(spent?1.01:0);
    const bar=el("button","bar");bar.type="button";bar.setAttribute("aria-label",c+": "+fmt(spent)+" of "+fmt(b)+". Show entries");
    const top=el("div","bar-top");top.append(el("span","",c),el("span","v amt",fmt(spent)+" / "+fmt(b)));
    const tr=el("div","track"),f=el("div","fill "+(p>1?"bad":p>.85?"warn":""));f.style.width=Math.min(100,p*100).toFixed(1)+"%";tr.appendChild(f);bar.append(top,tr);
    bar.addEventListener("click",()=>filterTo(c));box.appendChild(bar)});
}
function chartTip(box,svg,W,pl,pr,n,text){
  const tip=el("div","tip amt");tip.hidden=true;box.replaceChildren(svg,tip);
  const show=e=>{const r=box.getBoundingClientRect();const xs=(e.clientX-r.left)/r.width*W;const ix=Math.max(0,Math.min(n-1,Math.floor((xs-pl)/((W-pl-pr)/n))));
    const t=text(ix);if(!t){tip.hidden=true;return}tip.textContent=t;tip.hidden=false;const xx=e.clientX-r.left-tip.offsetWidth/2;tip.style.left=Math.max(0,Math.min(xx,r.width-tip.offsetWidth))+"px";tip.style.top="0px"};
  svg.addEventListener("pointerdown",show);svg.addEventListener("pointermove",show);svg.addEventListener("pointerleave",()=>tip.hidden=true);
}
function renderPace(){
  const box=$("pace");const s=settings(),bt=budgetTotal(s),k=mKey(cur.y,cur.m),dim=new Date(cur.y,cur.m+1,0).getDate();
  const curM=isCurMonth(cur.y,cur.m),future=new Date(cur.y,cur.m,1)>now;const upto=curM?now.getDate():dim;
  if(!bt){box.replaceChildren(el("div","empty","Set a monthly budget in Settings to see your pace."));$("paceNote").textContent="";return}
  if(future){box.replaceChildren(el("div","empty","This month hasn't started yet."));$("paceNote").textContent="";return}
  const bills=billList().filter(b=>EXP_CATS.includes(b.cat));const billSum=bills.reduce((a,b)=>a+(+b.amount||0),0);const rest=Math.max(0,bt-billSum)/dim;
  const plan=[0],act=[0];const daily=Array(dim+1).fill(0);
  items(k).forEach(i=>{if(i.type==="expense"&&!i.oneoff){const d=+i.date.slice(8,10);if(d>=1&&d<=dim)daily[d]+=+i.czk||0}});
  for(let d=1;d<=dim;d++){plan[d]=plan[d-1]+rest+bills.filter(b=>Math.min(+b.day||1,dim)===d).reduce((a,b)=>a+(+b.amount||0),0);act[d]=act[d-1]+daily[d]}
  const diff=act[upto]-plan[upto];const note=$("paceNote");note.className="pill "+(diff>0?(diff>bt*.05?"bad":"warn"):"ok");note.textContent=(diff>0?fmt(diff)+" over plan":fmt(-diff)+" under plan")+(curM?" today":"");
  const W=boxW(box),H=190,pl=40,pr=10,pt=10,pb=22;const max=Math.max(plan[dim],act[upto])*1.06||1;
  const x=d=>pl+(W-pl-pr)*(d/dim),y=v=>pt+(H-pt-pb)*(1-v/max);const svg=svgEl(W,H,"Cumulative spending against plan");axisY(svg,max,0,y,pl,W,pr);
  [1,8,15,22,dim].forEach(d=>svg.add("text",{x:x(d),y:H-6,"text-anchor":"middle"},String(d)));
  let pp="M"+x(0)+" "+y(0);for(let d=1;d<=dim;d++)pp+=" L"+x(d)+" "+y(plan[d]);svg.add("path",{d:pp,fill:"none",stroke:"var(--muted)","stroke-width":1.5,"stroke-dasharray":"5 4"});
  let ap="M"+x(0)+" "+y(0);for(let d=1;d<=upto;d++)ap+=" L"+x(d)+" "+y(act[d]);
  svg.add("path",{d:ap+" L"+x(upto)+" "+y(0)+" Z",fill:"var(--accent)",opacity:.12});svg.add("path",{d:ap,fill:"none",stroke:"var(--accent)","stroke-width":2.5,"stroke-linejoin":"round"});
  svg.add("circle",{cx:x(upto),cy:y(act[upto]),r:4.5,fill:"var(--accent)",stroke:"var(--panel)","stroke-width":2});
  chartTip(box,svg,W,pl,pr,dim,ix=>{const d=ix+1;return d+". · "+(d<=upto?"spent "+fmt(act[d])+" · ":"")+"plan "+fmt(plan[d])});
}
function billList(){return ((docs.bills||{}).list||[]).filter(b=>b&&b.name)}
function billType(b){return SAVE_CATS.includes(b.cat)?"saving":"expense"}
function billStatus(k){
  const {y,m}=keyYM(k);const dim=new Date(y,m+1,0).getDate();const used=new Set();const list=items(k);
  return billList().map(b=>{const words=String(b.match||b.name).toLowerCase().split(/[,|]/).map(w=>w.trim()).filter(Boolean);const amt=+b.amount||0;const tol=Math.max(amt*.1,50);
    const hits=list.filter(i=>!used.has(i.id)&&i.type===billType(b)&&words.some(w=>((i.note||"")+" "+(i.cat||"")).toLowerCase().includes(w))&&Math.abs((+i.czk||0)-amt)<=tol)
      .sort((a,c)=>Math.abs((+a.czk||0)-amt)-Math.abs((+c.czk||0)-amt));
    const hit=hits[0];if(hit)used.add(hit.id);const day=Math.min(+b.day||1,dim);
    let st,label;if(hit){st="paid";label="Paid "+(+hit.date.slice(8,10))+"."}
    else if(!isCurMonth(y,m)){st=new Date(y,m,1)<now?"late":"due";label=st==="late"?"Not found":"Due "+day+"."}
    else{const dd=day-now.getDate();if(dd<0){st="late";label=(-dd)+" day"+(dd===-1?"":"s")+" late"}else if(dd===0){st="soon";label="Due today"}else if(dd<=3){st="soon";label="Due in "+dd+" day"+(dd>1?"s":"")}else{st="due";label="Due "+day+"."}}
    return {b,hit,st,label,day}}).sort((a,c)=>a.day-c.day);
}
function renderBills(){
  const ul=$("bills");ul.replaceChildren();const st=billStatus(mKey(cur.y,cur.m));
  if(!st.length){ul.appendChild(el("li","empty","No recurring bills yet. Add them in Settings."));return}
  st.forEach(s=>{const li=el("li");const l=el("div");l.append(el("div","bn",s.b.name),el("div","bs",(billType(s.b)==="saving"?"Saving · ":"")+s.b.cat+" · day "+s.day));
    const r=el("div");r.style.display="flex";r.style.flexDirection="column";r.style.gap="4px";r.style.alignItems="flex-end";r.append(el("span","ba amt",fmt(s.hit?s.hit.czk:s.b.amount)),el("span","st "+s.st,s.label));li.append(l,r);ul.appendChild(li)});
}
$("billsEdit").addEventListener("click",()=>{showTab("settings");setTimeout(()=>$("billsPanel").scrollIntoView({behavior:"smooth"}),50)});
function renderBanners(){
  const box=$("banners");box.replaceChildren();
  if(isCurMonth(cur.y,cur.m)){const late=billStatus(mKey(cur.y,cur.m)).filter(s=>s.st==="late");
    if(late.length){const b=el("div","banner bad");b.append(el("span","",late.length===1?late[0].b.name+" is "+late[0].label+".":late.length+" bills look late: "+late.map(s=>s.b.name).join(", ")+"."));box.appendChild(b)}}
  const lb=(docs.settings||{}).lastBackup;const n=allItems().length;
  if(n&&(!lb||Date.now()-lb>30*DAY)){const b=el("div","banner warn");const t=el("span");t.append(el("b","",lb?"Last backup "+Math.floor((Date.now()-lb)/DAY)+" days ago.":"No backup yet."),document.createTextNode(" Your data only lives on this phone."));
    const btn=el("button","icon-btn","Back up");btn.addEventListener("click",doBackup);b.append(t,btn);box.appendChild(b)}
}
function recapFor(k){
  const {y,m}=keyYM(k);const s=settings(),t=totals(k),bt=budgetTotal(s),tt=targetTotal(s),pk=prevKey(y,m),pt=totals(pk);
  const lines=[];lines.push("Spent "+fmt(t.expense)+" of "+fmt(bt)+(bt?" ("+Math.round(t.expense/bt*100)+"%)":"")+".");
  if(tt)lines.push("Saved and invested "+fmt(t.saving)+" of the "+fmt(tt)+" target.");
  const diffs=EXP_CATS.map(c=>({c,d:(t.byCat["expense:"+c]||0)-s.budget[c]})).filter(x=>s.budget[x.c]||x.d>0);
  const over=diffs.filter(x=>x.d>0).sort((a,b)=>b.d-a.d).slice(0,2),under=diffs.filter(x=>x.d<0).sort((a,b)=>a.d-b.d).slice(0,2);
  if(over.length)lines.push("Over budget: "+over.map(x=>x.c+" by "+fmt(x.d)).join(", ")+".");
  if(under.length)lines.push("Under budget: "+under.map(x=>x.c+" by "+fmt(-x.d)).join(", ")+".");
  if(pt.expense){const {y:py,m:pm}=keyYM(pk);lines.push("Spending "+(t.expense>=pt.expense?"up ":"down ")+Math.abs(Math.round((t.expense/pt.expense-1)*100))+"% on "+mName(py,pm).split(" ")[0]+".")}
  if(t.oneoff)lines.push("One-off costs: "+fmt(t.oneoff)+".");
  return lines;
}
function renderRecap(){
  const box=$("recap");box.replaceChildren();const k=mKey(cur.y,cur.m);let rk=null,dismiss=false;
  if(new Date(cur.y,cur.m+1,1)<=now&&items(k).length)rk=k;
  else if(isCurMonth(cur.y,cur.m)&&now.getDate()<=7){const pk=prevKey(cur.y,cur.m);if(items(pk).length&&(docs.settings||{}).recapSeen!==pk){rk=pk;dismiss=true}}
  if(!rk)return;const {y,m}=keyYM(rk);const c=el("div","recap");const head=el("div","rhead");head.appendChild(el("h2","",mName(y,m).split(" ")[0]+" in review"));
  if(dismiss){const x=el("button","link","Dismiss");x.addEventListener("click",()=>{ensureSettings().recapSeen=rk;persist().then(render)});head.appendChild(x)}
  const ul=el("ul");recapFor(rk).forEach(l=>ul.appendChild(el("li","amt",l)));c.append(head,ul);box.appendChild(c);
}
const COLORS=["var(--c1)","var(--c2)","var(--c3)","var(--c4)","var(--c5)","var(--c6)","var(--c7)","var(--c8)"];
function renderDonut(){
  const box=$("donut"),lg=$("donutLegend");const t=totals(mKey(cur.y,cur.m));
  const cats=EXP_CATS.map(c=>({c,v:t.byCat["expense:"+c]||0})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
  lg.replaceChildren();if(!cats.length){box.replaceChildren();lg.appendChild(el("li","empty","No spending yet this month."));return}
  const tot=cats.reduce((a,x)=>a+x.v,0);const S=150,R=70,r=46,cx=75,cy=75;const svg=svgEl(S,S,"Spending by category");let a0=-Math.PI/2;
  cats.forEach((x,ix)=>{const a1=a0+x.v/tot*Math.PI*2;const large=a1-a0>Math.PI?1:0;const p=(a,rr)=>[cx+rr*Math.cos(a),cy+rr*Math.sin(a)];
    const [x0,y0]=p(a0,R),[x1,y1]=p(a1-1e-4,R),[x2,y2]=p(a1-1e-4,r),[x3,y3]=p(a0,r);
    const path=svg.add("path",{d:"M"+x0+" "+y0+" A"+R+" "+R+" 0 "+large+" 1 "+x1+" "+y1+" L"+x2+" "+y2+" A"+r+" "+r+" 0 "+large+" 0 "+x3+" "+y3+" Z",fill:COLORS[ix%8],stroke:"var(--panel)","stroke-width":1.5});
    path.style.cursor="pointer";path.addEventListener("click",()=>filterTo(x.c));a0=a1;
    const li=el("li");const b=el("button");b.type="button";const sw=el("i");sw.style.background=COLORS[ix%8];b.append(sw,el("span","",x.c),el("span","p amt",fmt(x.v)+" · "+Math.round(x.v/tot*100)+"%"));b.addEventListener("click",()=>filterTo(x.c));li.appendChild(b);lg.appendChild(li)});
  svg.add("text",{x:cx,y:cy-2,"text-anchor":"middle",class:"lab amt"},short(tot));svg.add("text",{x:cx,y:cy+14,"text-anchor":"middle"},dispAUD()?"A$":"Kč");
  box.replaceChildren(svg);
}
let selDay=null;
function renderHeat(){
  const box=$("heat");box.replaceChildren();const k=mKey(cur.y,cur.m),dim=new Date(cur.y,cur.m+1,0).getDate();
  ["Mo","Tu","We","Th","Fr","Sa","Su"].forEach(d=>box.appendChild(el("div","dow",d)));
  const daily=Array(dim+1).fill(0);items(k).forEach(i=>{if(i.type==="expense"&&!i.oneoff){const d=+i.date.slice(8,10);if(d>=1&&d<=dim)daily[d]+=+i.czk||0}});
  const max=Math.max(1,...daily.slice(1));const lead=(new Date(cur.y,cur.m,1).getDay()+6)%7;for(let i=0;i<lead;i++)box.appendChild(el("span"));
  for(let d=1;d<=dim;d++){const v=daily[d];const lvl=v?Math.min(4,Math.max(1,Math.ceil(Math.sqrt(v/max)*4))):0;const b=el("button","l"+lvl,String(d));b.type="button";
    if(v)b.style.background="color-mix(in srgb, var(--accent) "+[0,22,45,70,95][lvl]+"%, var(--track))";
    if(isCurMonth(cur.y,cur.m)&&d===now.getDate())b.classList.add("today");b.setAttribute("aria-pressed",String(selDay===d));b.setAttribute("aria-label",d+": "+fmt(v));
    b.addEventListener("click",()=>{selDay=selDay===d?null:d;renderHeat()});box.appendChild(b)}
  const dl=$("dayList");dl.replaceChildren();if(selDay&&selDay<=dim){const ds=k.slice(2)+"-"+pad(selDay);const list=items(k).filter(i=>i.date===ds);
    dl.appendChild(el("h3","",new Date(cur.y,cur.m,selDay).toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})));
    if(!list.length)dl.appendChild(el("p","small muted","Nothing logged."));const ul=el("ul","ledger");list.forEach(i=>ul.appendChild(entryRow(k,i,false)));dl.appendChild(ul)}
}
function merchantKey(i){return (i.key||rbKey(i.note||"",""))||(i.note||"").toLowerCase()}
function renderMerchants(){
  const ol=$("merchants");ol.replaceChildren();const ks=[0,1,2].map(n=>{const d=new Date(cur.y,cur.m-n,1);return mKey(d.getFullYear(),d.getMonth())});
  const g={};ks.forEach(k=>items(k).forEach(i=>{if(i.type!=="expense")return;const mk=merchantKey(i);if(!mk)return;const e=g[mk]||(g[mk]={name:i.note||i.cat,n:0,v:0,last:""});e.n++;e.v+=+i.czk||0;if(i.date>e.last){e.last=i.date;e.name=i.note||i.cat}}));
  const top=Object.values(g).sort((a,b)=>b.v-a.v).slice(0,8);if(!top.length){ol.appendChild(el("li","empty","Nothing yet."));return}
  const mx=top[0].v;top.forEach(m=>{const li=el("li");li.append(el("span","mn",m.name),el("span","mt amt",fmt(m.v)),el("span","mc",m.n+(m.n===1?" payment":" payments")));
    const bar=el("span","mbar");const f=el("i");f.style.width=(m.v/mx*100).toFixed(1)+"%";bar.appendChild(f);li.appendChild(bar);ol.appendChild(li)});
}
function last6(){const out=[];for(let i=5;i>=0;i--){const d=new Date(cur.y,cur.m-i,1);out.push({k:mKey(d.getFullYear(),d.getMonth()),lab:mName(d.getFullYear(),d.getMonth(),true)})}return out}
function renderTrend(){
  const box=$("trend");const s=settings(),bt=budgetTotal(s);const ms=last6().map(x=>{const t=totals(x.k);return {lab:x.lab,sp:t.expense,one:t.oneoff,sv:t.saving}});
  if(!ms.some(m=>m.sp||m.sv||m.one)){box.replaceChildren(el("div","empty","The chart fills in as you add entries."));return}
  const W=boxW(box),H=200,pl=40,pr=6,pt=10,pb=24;const max=Math.max(bt,...ms.map(m=>Math.max(m.sp+m.one,m.sv)))*1.08||1;
  const y=v=>pt+(H-pt-pb)*(1-v/max),gw=(W-pl-pr)/6,bw=Math.min(20,gw*.3);const svg=svgEl(W,H,"Spending and saving over six months");axisY(svg,max,0,y,pl,W,pr);
  ms.forEach((m,i)=>{const cx=pl+gw*i+gw/2;
    svg.add("rect",{x:cx-bw-2,y:y(m.sp),width:bw,height:Math.max(0,H-pb-y(m.sp)),rx:2,fill:"var(--accent)"});
    if(m.one)svg.add("rect",{x:cx-bw-2,y:y(m.sp+m.one),width:bw,height:Math.max(0,y(m.sp)-y(m.sp+m.one)),rx:2,fill:"var(--one)"});
    svg.add("rect",{x:cx+2,y:y(m.sv),width:bw,height:Math.max(0,H-pb-y(m.sv)),rx:2,fill:"var(--ok)"});
    svg.add("text",{x:cx,y:H-7,"text-anchor":"middle",class:i===5?"now":""},m.lab)});
  if(bt)svg.add("line",{x1:pl,x2:W-pr,y1:y(bt),y2:y(bt),stroke:"var(--muted)","stroke-width":1.5,"stroke-dasharray":"5 4"});
  chartTip(box,svg,W,pl,pr,6,ix=>{const m=ms[ix];return m.lab+" · spent "+fmt(m.sp)+(m.one?" + "+fmt(m.one)+" one-off":"")+" · saved "+fmt(m.sv)});
}

/* ---------- entries: list, search, filters ---------- */
function fillFilterCats(){const sel=$("fltCat"),v=sel.value;sel.replaceChildren();const add=(val,t)=>{const o=el("option","",t);o.value=val;sel.appendChild(o)};
  add("","All categories");add("__oneoff","One-offs only");add("__img","With images");
  [["Spending",EXP_CATS],["Saving",SAVE_CATS],["Income",INC_CATS]].forEach(([lab,list])=>{const g=el("optgroup");g.label=lab;list.forEach(c=>{const o=el("option","",c);o.value=c;g.appendChild(o)});sel.appendChild(g)});sel.value=v}
fillFilterCats();
function filterTo(cat){$("fltCat").value=cat;$("q").value="";showTab("entries");renderEntries();setTimeout(()=>$("entriesTitle").scrollIntoView({behavior:"smooth",block:"start"}),60)}
["q","fltCat","fltAll"].forEach(id=>$(id).addEventListener(id==="q"?"input":"change",renderEntries));
function entryRow(k,i,showMonth){
  const li=el("li");const d=el("span","d",(i.date||"").slice(8,10));if(showMonth)d.appendChild(el("span","mo",new Date(i.date).toLocaleDateString("en-GB",{month:"short"})));
  const w=el("div");const c=el("div","c",i.type==="expense"&&i.parts&&i.parts.length?"Split · "+i.parts.map(p=>p.cat).join(", "):(i.cat||"Uncategorised"));
  if(i.type!=="expense")c.appendChild(el("span","tag "+(i.type==="income"?"in":"sv"),i.type==="income"?"in":"saved"));w.appendChild(c);
  if(i.note)w.appendChild(el("div","n",i.note));
  const bd=el("div","badges");if(i.oneoff)bd.appendChild(el("span","badge one","one-off"));if((i.att||[]).length)bd.appendChild(el("span","badge",(i.att.length>1?i.att.length+" images":"image")));if(i.src==="shot")bd.appendChild(el("span","badge","screenshot"));if(bd.childNodes.length)w.appendChild(bd);
  const a=el("div","a amt",(i.type==="income"&&i.czk>0?"+":"")+fmt(i.czk));if(i.orig||(i.cur&&i.cur!=="CZK"))a.appendChild(el("small","",i.orig||fmtCur(i.amount,i.cur)));
  li.append(d,w,a);li.tabIndex=0;li.setAttribute("role","button");li.setAttribute("aria-label","Edit "+(i.note||i.cat)+", "+fmt(i.czk));
  li.addEventListener("click",()=>openEditor(k,i.id));li.addEventListener("keydown",e=>{if(e.key==="Enter")openEditor(k,i.id)});return li;
}
function renderEntries(){
  const q=$("q").value.trim().toLowerCase(),cat=$("fltCat").value,all=$("fltAll").checked||!!q;const ul=$("ledger");ul.replaceChildren();
  let list=all?allItems():items(mKey(cur.y,cur.m)).map(i=>({k:mKey(cur.y,cur.m),i}));
  if(cat==="__oneoff")list=list.filter(x=>x.i.oneoff);else if(cat==="__img")list=list.filter(x=>(x.i.att||[]).length);else if(cat)list=list.filter(x=>x.i.cat===cat||partsOf(x.i).some(p=>p.cat===cat));
  if(q){const n=parseNum(q);list=list.filter(x=>((x.i.note||"")+" "+(x.i.cat||"")+" "+(x.i.orig||"")).toLowerCase().includes(q)||(!isNaN(n)&&Math.abs((+x.i.czk||0)-n)<1))}
  list.sort((a,b)=>(b.i.date||"").localeCompare(a.i.date||"")||(b.i.ts||0)-(a.i.ts||0));
  const filtered=!!(q||cat);$("entriesTitle").textContent=filtered?"Results":"Entries";
  const sum=list.reduce((a,x)=>a+(x.i.type==="expense"?(+x.i.czk||0):0),0);
  $("entryCount").textContent=list.length?(list.length+(all?" in all months":" in "+mName(cur.y,cur.m,true))+(filtered&&sum?" · "+fmt(sum)+" spent":"")):"";
  if(!list.length){ul.appendChild(el("li","empty",filtered?"No entries match.":"Nothing logged for "+mName(cur.y,cur.m)+" yet."));return}
  list.slice(0,300).forEach(x=>ul.appendChild(entryRow(x.k,x.i,all)));
}

/* ---------- bottom sheet ---------- */
let sheetUrls=[];
function openSheet(title,body){$("sheetTitle").textContent=title;$("sheetBody").replaceChildren(...body);$("sheet").hidden=false;document.body.style.overflow="hidden"}
function closeSheet(){$("sheet").hidden=true;$("sheetBody").replaceChildren();document.body.style.overflow="";sheetUrls.forEach(u=>URL.revokeObjectURL(u));sheetUrls=[]}
$("sheetClose").addEventListener("click",closeSheet);
$("sheet").addEventListener("click",e=>{if(e.target===$("sheet"))closeSheet()});
function fld(label,input){const f=el("div","field");const l=el("label","label",label);if(!input.id)input.id=uid("f");l.htmlFor=input.id;f.append(l,input);return f}
function selOf(opts,val){const s=el("select");opts.forEach(o=>{const [v,t]=Array.isArray(o)?o:[o,o];const op=el("option","",t);op.value=v;s.appendChild(op)});if(val!=null)s.value=val;return s}
function inp(val,type,mode){const i=el("input");if(type)i.type=type;if(mode)i.inputMode=mode;if(val!=null)i.value=val;return i}

/* ---------- entry editor ---------- */
function openEditor(k,id){
  const i=items(k).find(x=>x.id===id);if(!i)return;let ty=i.type;
  const seg=el("div","seg");seg.setAttribute("role","group");seg.setAttribute("aria-label","Entry type");const tb={};
  [["expense","Spent"],["saving","Saved"],["income","Income"]].forEach(([v,t])=>{const b=el("button","",t);b.type="button";b.setAttribute("aria-pressed",String(v===ty));
    b.addEventListener("click",()=>{ty=v;Object.keys(tb).forEach(x=>tb[x].setAttribute("aria-pressed",String(x===v)));fillCat();partsWrap.hidden=ty!=="expense";oneWrap.hidden=ty!=="expense"});tb[v]=b;seg.appendChild(b)});
  const amt=inp(String(i.amount).replace(".",","),"","decimal"),curS=selOf(["CZK","AUD","EUR"],i.cur||"CZK"),date=inp(i.date,"date"),note=inp(i.note||"");note.maxLength=80;
  const cat=el("select");const fillCat=()=>{const list=ty==="expense"?EXP_CATS:ty==="saving"?SAVE_CATS:INC_CATS;const v=cat.value||i.cat;cat.replaceChildren(...list.map(c=>el("option","",c)));cat.value=list.includes(v)?v:list[0]};fillCat();
  const r1=el("div","row2");r1.append(fld("Amount",amt),fld("Currency",curS));const r2=el("div","row2 row2-date");r2.append(fld("Note",note),fld("Date",date));
  const one=el("input");one.type="checkbox";one.checked=!!i.oneoff;one.id=uid("o");const oneWrap=el("label","check");oneWrap.htmlFor=one.id;oneWrap.append(one,document.createTextNode(" One-off (keep out of the monthly budget)"));oneWrap.hidden=ty!=="expense";
  const partsWrap=el("div","sub-sec");partsWrap.hidden=ty!=="expense";const ph=el("div","panel-head");ph.appendChild(el("b","","Split across categories"));const addP=el("button","link","+ Add part");addP.type="button";ph.appendChild(addP);
  const parts=el("div","parts");const leftNote=el("div","left-note");partsWrap.append(ph,parts,leftNote);
  const totalCzk=()=>{const a=parseNum(amt.value);const c=curS.value;return c==="CZK"?a:(a===i.amount&&c===i.cur?+i.czk:a*rateOf(c))};
  const upd=()=>{const rows=[...parts.children];if(!rows.length){leftNote.textContent="Not split.";leftNote.className="left-note";return}const sum=rows.reduce((a,r)=>a+(r._get().czk||0),0);const left=Math.round((totalCzk()-sum)*100)/100;
    leftNote.textContent=Math.abs(left)<1?"Parts add up.":(left>0?fmtCur(left,"CZK")+" still to assign":fmtCur(-left,"CZK")+" too much");leftNote.className="left-note "+(Math.abs(left)<1?"ok":"bad")};
  const partRow=p=>{const r=el("div","part");const c=selOf(EXP_CATS,p.cat);c.setAttribute("aria-label","Part category");const v=inp(p.czk!=null&&p.czk!==""?String(p.czk).replace(".",","):"","","decimal");v.setAttribute("aria-label","Part amount in CZK");v.className="amt";
    const x=el("button","x","×");x.type="button";x.setAttribute("aria-label","Remove part");x.addEventListener("click",()=>{r.remove();upd()});v.addEventListener("input",upd);r.append(c,v,x);r._get=()=>({cat:c.value,czk:parseNum(v.value)});parts.appendChild(r)};
  (i.parts||[]).forEach(partRow);
  addP.addEventListener("click",()=>{if(!parts.children.length)partRow({cat:cat.value,czk:Math.round(totalCzk()*100)/100});partRow({cat:EXP_CATS[0],czk:""});upd()});amt.addEventListener("input",upd);upd();
  const imgs=el("div","sub-sec");const ih=el("div","panel-head");ih.appendChild(el("b","","Images"));const addI=el("button","link","+ Add image");addI.type="button";addI.addEventListener("click",()=>pickAttach(k,i.id,true));ih.appendChild(addI);
  const th=el("div","thumbs");imgs.append(ih,th);
  (i.att||[]).forEach((aid,ix)=>{const b=el("button");b.type="button";b.setAttribute("aria-label","Open image "+(ix+1));th.appendChild(b);b.addEventListener("click",()=>openViewer(k,i,ix));
    fileGet(aid).then(async rec=>{if(!rec||!key)return;const bytes=await decBytes(key,rec);const u=URL.createObjectURL(new Blob([bytes],{type:rec.type||"image/jpeg"}));sheetUrls.push(u);const im=el("img");im.src=u;im.alt="";b.appendChild(im)}).catch(()=>{})});
  if(!(i.att||[]).length)th.appendChild(el("span","small muted","None attached."));
  const hint=el("p","hint");
  const save=el("button","primary","Save changes");save.type="button";const del=el("button","danger","Delete entry");del.type="button";const row=el("div","btnrow");row.append(save,del);
  save.addEventListener("click",async()=>{
    const a=parseNum(amt.value),c=curS.value,dt=date.value;hint.className="hint err";
    if(!(a>0)){hint.textContent="Enter an amount above zero.";return}if(!/^\d{4}-\d{2}-\d{2}$/.test(dt)){hint.textContent="Choose a date.";return}if(!rateOf(c)){hint.textContent="Set the "+c+" exchange rate in Settings first.";return}
    const czk=Math.round(totalCzk()*100)/100;const pl=[...parts.children].map(r=>r._get()).filter(p=>p.czk>0);
    if(ty==="expense"&&pl.length){const sum=pl.reduce((s2,p)=>s2+p.czk,0);if(Math.abs(sum-czk)>=1){hint.textContent="The parts need to add up to "+fmtCur(czk,"CZK")+".";return}}
    const n2={...i,type:ty,amount:a,cur:c,czk,date:dt,note:note.value.trim().slice(0,80),cat:cat.value,oneoff:ty==="expense"&&one.checked};
    if(ty==="expense"&&pl.length>1){n2.parts=pl;n2.cat=pl.slice().sort((x,y)=>y.czk-x.czk)[0].cat}else delete n2.parts;
    if(!n2.oneoff)delete n2.oneoff;if(c!==i.cur||a!==i.amount){if(c==="CZK")delete n2.orig;else n2.orig=a+" "+c}
    if(n2.cat!==i.cat&&(i.src==="rb"||i.src==="shot")&&i.key&&ty==="expense"&&!n2.parts){const st=ensureSettings();st.rules=st.rules||{};st.rules[i.key]=n2.cat}
    const nk="m-"+dt.slice(0,7);docs[k].items=items(k).filter(x=>x.id!==i.id);(docs[nk]=docs[nk]||{items:[]}).items=items(nk).concat(n2);
    await persist();closeSheet();toast("Saved");render()});
  del.addEventListener("click",async()=>{if(!del.classList.contains("confirm")){del.classList.add("confirm");del.textContent="Tap again to delete";return}
    docs[k].items=items(k).filter(x=>x.id!==i.id);await persist();await dropUnused(i.att);closeSheet();toast("Entry deleted");render()});
  const meta=el("p","fine",(i.src==="rb"?"From your Raiffeisen export":i.src==="shot"?"From a screenshot":"Added by hand")+(i.orig?" · original amount "+i.orig:""));
  openSheet("Edit entry",[seg,r1,fld("Category",cat),r2,oneWrap,partsWrap,imgs,meta,row,hint]);
}

/* ---------- add entry, header controls ---------- */
function defaultDate(){const t=new Date();if(t.getFullYear()===cur.y&&t.getMonth()===cur.m)return iso(t);return cur.y+"-"+pad(cur.m+1)+"-01"}
function move(n){const d=new Date(cur.y,cur.m+n,1);cur={y:d.getFullYear(),m:d.getMonth()};selDay=null;$("fDate").value=defaultDate();render()}
$("prevM").addEventListener("click",()=>move(-1));$("nextM").addEventListener("click",()=>move(1));
$("fDate").value=defaultDate();
$("hideBtn").addEventListener("click",()=>{const on=document.body.classList.toggle("private");$("hideBtn").setAttribute("aria-pressed",String(on));$("hideBtn").textContent=on?"Show":"Hide"});
$("curBtn").addEventListener("click",()=>{const st=ensureSettings();if(st.dispCur!=="AUD"&&!rateOf("AUD")){toast("Set the AUD rate in Settings first.");return}st.dispCur=st.dispCur==="AUD"?"CZK":"AUD";persist().then(render)});
function fillCats(){const list=type==="expense"?EXP_CATS:type==="saving"?SAVE_CATS:INC_CATS,sel=$("fCat"),prev=sel.value;sel.replaceChildren(...list.map(c=>el("option","",c)));if(list.includes(prev))sel.value=prev}
document.querySelectorAll("#addPanel .seg button").forEach(b=>b.addEventListener("click",()=>{type=b.dataset.type;document.querySelectorAll("#addPanel .seg button").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));fillCats();
  $("saveBtn").textContent=type==="expense"?"Add expense":type==="saving"?"Add saving":"Add income";$("fOneoff").parentElement.hidden=type!=="expense"}));
fillCats();
$("entryForm").addEventListener("submit",e=>{e.preventDefault();if(!key)return;const h=$("formHint");
  const amt=parseNum($("fAmt").value),c=$("fCur").value;
  if(!(amt>0)){h.textContent="Enter an amount above zero.";h.className="hint err";return}
  if(!rateOf(c)){h.textContent="Set the "+c+" exchange rate in Settings first.";h.className="hint err";return}
  const date=$("fDate").value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;const k="m-"+date.slice(0,7);
  const it={id:uid("e"),type,cat:$("fCat").value,amount:amt,cur:c,czk:Math.round(amt*rateOf(c)*100)/100,note:$("fNote").value.trim().slice(0,80),date,ts:Date.now()};
  if(c!=="CZK")it.orig=amt+" "+c;if(type==="expense"&&$("fOneoff").checked)it.oneoff=true;
  const rf=$("fReceipt").files[0];
  (rf?storeImage(rf).then(id=>{it.att=[id]}):Promise.resolve()).then(()=>{(docs[k]=docs[k]||{items:[]}).items=items(k).concat(it);return persist()})
  .then(()=>{$("fAmt").value="";$("fNote").value="";$("fReceipt").value="";$("fReceiptName").textContent="";$("fOneoff").checked=false;h.className="hint ok";h.textContent="Added "+it.cat+" · "+fmt(it.czk)+(it.att?" with image":"");render()})
  .catch(()=>{h.className="hint err";h.textContent="Couldn't save that image. Try a smaller one."});
});

/* ---------- goals and investing ---------- */
function goalList(){return ((docs.goals||{}).list||[])}
function investTotalSince(since){return allItems().filter(x=>x.i.type==="saving"&&x.i.cat==="Investing"&&(!since||x.i.date>=since)).reduce((a,x)=>a+(+x.i.czk||0),0)}
function shares(){const s=settings().invest;const t=s.short+s.long;return t?{short:s.short/t,long:s.long/t}:{short:0,long:1}}
function goalProgress(g){
  const src=g.src||"manual";const start=+g.start||0;
  if(src.startsWith("cat:")){const c=src.slice(4);return start+allItems().filter(x=>x.i.type==="saving"&&x.i.cat===c&&(!g.created||x.i.date>=g.created)).reduce((a,x)=>a+(+x.i.czk||0),0)}
  if(src.startsWith("inv:"))return start+investTotalSince(g.created)*shares()[src.slice(4)];
  if(src.startsWith("acct:")){const a=((docs.accounts||{}).list||[]).find(a=>a.id===src.slice(5));return a?(+a.balance||0)*rateOf(a.cur):start}
  return start;
}
function goalPace(g){
  const src=g.src||"manual";if(!(src.startsWith("cat:")||src.startsWith("inv:")))return null;
  const months=[0,1,2].map(n=>{const d=new Date(now.getFullYear(),now.getMonth()-n,1);return mKey(d.getFullYear(),d.getMonth())}).filter(k=>!g.created||k>="m-"+g.created.slice(0,7));
  if(!months.length)return null;let sum=0;months.forEach(k=>{const t=totals(k);sum+=src.startsWith("cat:")?(t.byCat["saving:"+src.slice(4)]||0):(t.byCat["saving:Investing"]||0)*shares()[src.slice(4)]});
  return sum/months.length;
}
function srcLabel(g){const s=g.src||"manual";if(s.startsWith("cat:"))return "Counts your "+s.slice(4)+" entries";if(s==="inv:long")return "Counts the long-term share of your investing";if(s==="inv:short")return "Counts the 2-year share of your investing";
  if(s.startsWith("acct:")){const a=((docs.accounts||{}).list||[]).find(a=>a.id===s.slice(5));return a?"Follows your "+a.name+" balance":"Account not found"}return "Updated by hand"}
const monthsBetween=(a,b)=>(b.getFullYear()-a.getFullYear())*12+(b.getMonth()-a.getMonth());
function renderGoals(){
  const box=$("goals");box.replaceChildren();const list=goalList();
  if(!list.length){box.appendChild(el("p","empty","No goals yet. Add one to track it here."));return}
  list.forEach(g=>{const p=goalProgress(g),t=+g.target||0,pace=goalPace(g);const c=el("div","goal");
    const h=el("div","gh");h.append(el("span","gn",g.name),el("span","gv amt",t?fmt(p)+" of "+fmt(t):fmt(p)));c.appendChild(h);
    const tr=el("div","gt");const f=el("i");f.style.width=(t?Math.min(100,p/t*100):0).toFixed(1)+"%";tr.appendChild(f);c.appendChild(tr);
    const parts=[];
    if(!t)parts.push("Set a target to see progress.");
    else if(p>=t)parts.push("Reached. Well done.");
    else{const left=t-p;if(g.date){const end=new Date(g.date+"-01");const ml=Math.max(1,monthsBetween(now,end));parts.push("Needs "+fmt(left/ml)+" a month to reach it by "+mName(end.getFullYear(),end.getMonth())+".")}
      if(pace>0){const mm=Math.ceil(left/pace);const d=new Date(now.getFullYear(),now.getMonth()+mm,1);parts.push("At "+fmt(pace)+" a month you'd get there by "+mName(d.getFullYear(),d.getMonth())+".")}
      else if(pace!==null)parts.push("Nothing added in the last 3 months.")}
    c.appendChild(el("div","gm amt",parts.join(" ")));
    const foot=el("div","panel-head");foot.style.margin="0";foot.append(el("span","small muted",srcLabel(g)));const ed=el("button","link","Edit");ed.addEventListener("click",()=>openGoal(g.id));foot.appendChild(ed);c.appendChild(foot);
    box.appendChild(c)});
}
$("goalAdd").addEventListener("click",()=>openGoal(null));
function openGoal(id){
  const g=id?goalList().find(x=>x.id===id):{id:uid("g"),name:"",target:"",date:"",start:0,src:"manual",created:todayIso()};if(!g)return;
  const name=inp(g.name);name.maxLength=40;const target=inp(g.target?String(g.target):"","","decimal");const date=inp(g.date||"","month");
  const accts=((docs.accounts||{}).list||[]);const srcOpts=[["manual","I'll update the amount myself"],["cat:Emergency savings","My Emergency savings entries"],["cat:Investing","All my Investing entries"],["inv:long","Long-term share of my investing"],["inv:short","2-year share of my investing"]].concat(accts.map(a=>["acct:"+a.id,"Balance of "+a.name]));
  const src=selOf(srcOpts,g.src||"manual");const start=inp(String(g.start||0),"","decimal");const startF=fld(g.src==="manual"?"Amount saved so far (CZK)":"Already saved before tracking (CZK)",start);
  src.addEventListener("change",()=>{startF.querySelector("label").textContent=src.value==="manual"?"Amount saved so far (CZK)":"Already saved before tracking (CZK)";startF.hidden=src.value.startsWith("acct:")});startF.hidden=(g.src||"").startsWith("acct:");
  const hint=el("p","hint err");const save=el("button","primary","Save goal");const del=el("button","danger",id?"Delete goal":"Cancel");const row=el("div","btnrow");row.append(save,del);
  save.addEventListener("click",async()=>{if(!name.value.trim()){hint.textContent="Give the goal a name.";return}
    const ng={...g,name:name.value.trim(),target:parseNum(target.value)||0,date:date.value||"",src:src.value,start:parseNum(start.value)||0};
    docs.goals=docs.goals||{list:[]};const l=goalList();const ix=l.findIndex(x=>x.id===g.id);if(ix>=0)l[ix]=ng;else l.push(ng);docs.goals.list=l;await persist();closeSheet();render()});
  del.addEventListener("click",async()=>{if(!id){closeSheet();return}if(!del.classList.contains("confirm")){del.classList.add("confirm");del.textContent="Tap again to delete";return}
    docs.goals.list=goalList().filter(x=>x.id!==id);await persist();closeSheet();render()});
  openSheet(id?"Edit goal":"New goal",[fld("Name",name),fld("Target (CZK)",target),fld("Target date (optional)",date),fld("How progress is counted",src),startF,row,hint]);
}
function renderInvest(){
  const s=settings();const tgt=s.invest.short+s.invest.long;const t=totals(mKey(cur.y,cur.m));const m=t.byCat["saving:Investing"]||0;const total=investTotalSince(null);
  const first=allItems().filter(x=>x.i.type==="saving"&&x.i.cat==="Investing").map(x=>x.i.date).sort()[0];
  $("invMonth").textContent=fmt(m);$("invMonthOf").textContent=tgt?"of "+fmt(tgt)+" target":"";$("invTotal").textContent=fmt(total);
  $("invSince").textContent=first?"since "+new Date(first).toLocaleDateString("en-GB",{month:"short",year:"numeric"}):"";$("invNote").textContent=tgt?fmt(s.invest.short)+" + "+fmt(s.invest.long)+" a month":"";
  const sh=shares();const box=$("invSplit");box.replaceChildren();
  [["For around 2 years",sh.short,s.invest.short],["Long-term (5+ years)",sh.long,s.invest.long]].forEach(([lab,share,monthly])=>{
    const bar=el("div","bar");const top=el("div","bar-top");top.append(el("span","",lab),el("span","v amt",fmt(total*share)+" total"));
    const tr=el("div","track"),f=el("div","fill ok");f.style.width=(monthly?Math.min(100,m*share/monthly*100):0).toFixed(1)+"%";tr.appendChild(f);
    bar.append(top,tr,el("span","small muted amt",fmt(m*share)+" of "+fmt(monthly)+" this month"));box.appendChild(bar)});
}
function barsChart(box,vals,labels,target,label,color){
  if(!vals.some(v=>v)){box.replaceChildren(el("div","empty","Nothing yet."));return}
  const W=boxW(box),H=170,pl=40,pr=6,pt=10,pb=24;const max=Math.max(target||0,...vals)*1.1||1;const n=vals.length;
  const y=v=>pt+(H-pt-pb)*(1-v/max),gw=(W-pl-pr)/n,bw=Math.min(26,gw*.5);const svg=svgEl(W,H,label);axisY(svg,max,0,y,pl,W,pr);
  vals.forEach((v,i)=>{const cx=pl+gw*i+gw/2;svg.add("rect",{x:cx-bw/2,y:y(v),width:bw,height:Math.max(0,H-pb-y(v)),rx:3,fill:color});svg.add("text",{x:cx,y:H-7,"text-anchor":"middle",class:i===n-1?"now":""},labels[i])});
  if(target)svg.add("line",{x1:pl,x2:W-pr,y1:y(target),y2:y(target),stroke:"var(--muted)","stroke-width":1.5,"stroke-dasharray":"5 4"});
  chartTip(box,svg,W,pl,pr,n,ix=>labels[ix]+" · "+fmt(vals[ix]));
}
function renderInvChart(){const s=settings();const l=last6();barsChart($("invChart"),l.map(x=>totals(x.k).byCat["saving:Investing"]||0),l.map(x=>x.lab),s.invest.short+s.invest.long,"Monthly investing against target","var(--ok)")}

/* ---------- accounts, savings over time, Australia ---------- */
function netTotal(){let net=0,missing=false;((docs.accounts||{}).list||[]).forEach(a=>{const r=rateOf(a.cur);if(!r)missing=true;else net+=(+a.balance||0)*r});return {net,missing}}
function snapshotNet(){const acc=(docs.accounts||{}).list||[];if(!acc.length)return;const {net}=netTotal();docs.history=docs.history||{snap:{}};docs.history.snap[todayIso()]=Math.round(net);
  const ks=Object.keys(docs.history.snap).sort();if(ks.length>500)ks.slice(0,ks.length-500).forEach(k=>delete docs.history.snap[k])}
function renderAccounts(){
  const acc=((docs.accounts||{}).list||[]),box=$("accts");box.replaceChildren();const {net,missing}=netTotal();
  $("kNet").textContent=acc.length?fmt(net):"—";$("kNetSub").textContent=acc.length?(missing?"Some balances skipped: set the exchange rate in Settings.":(dispAUD()?"converted to AUD":"converted to CZK")):"Add your accounts below.";
  acc.forEach(a=>{const row=el("div","acct");const l=el("div");l.style.minWidth="0";l.append(el("div","nm",a.name),el("div","meta",a.updated?"updated "+new Date(a.updated).toLocaleDateString("en-GB",{day:"numeric",month:"short"}):""));
    const bal=el("div","bal amt",fmtCur(+a.balance||0,a.cur));if(a.cur!==(dispAUD()?"AUD":"CZK")&&rateOf(a.cur))bal.appendChild(el("small","","≈ "+fmt((+a.balance||0)*rateOf(a.cur))));
    const ed=el("div","edit");const up=el("button","link","Update balance");
    up.addEventListener("click",()=>{ed.replaceChildren();const i2=inp(String(a.balance),"","decimal");i2.setAttribute("aria-label","New balance");
      const ok=el("button","link","Save"),rm=el("button","link","Delete");rm.style.color="var(--bad)";
      ok.addEventListener("click",()=>{const v=parseNum(i2.value);if(isNaN(v))return;a.balance=v;a.updated=Date.now();snapshotNet();persist().then(render)});
      rm.addEventListener("click",()=>{if(rm.textContent!=="Tap to confirm"){rm.textContent="Tap to confirm";return}docs.accounts.list=acc.filter(x=>x!==a);snapshotNet();persist().then(render)});
      ed.append(i2,ok,rm);i2.focus()});
    ed.appendChild(up);row.append(l,bal,ed);box.appendChild(row)});
}
$("acctForm").addEventListener("submit",e=>{e.preventDefault();if(!key)return;const v=parseNum($("aBal").value),n=$("aName").value.trim();if(!n||isNaN(v))return;
  docs.accounts=docs.accounts||{list:[]};docs.accounts.list.push({id:uid("a"),name:n.slice(0,40),cur:$("aCur").value,balance:v,updated:Date.now()});snapshotNet();
  $("aName").value="";$("aBal").value="";persist().then(render)});
function renderNet(){
  const box=$("netChart");const snap=(docs.history||{}).snap||{};const ks=Object.keys(snap).sort();
  if(ks.length<2){box.replaceChildren(el("div","empty",ks.length?"The line appears after a balance update on another day.":"Add your accounts to start the line."));return}
  const W=boxW(box),H=170,pl=44,pr=10,pt=10,pb=24;const vals=ks.map(k=>snap[k]);const lo=Math.min(...vals),hi=Math.max(...vals);const sp=(hi-lo)*.15||hi*.05||1;const min=Math.max(0,lo-sp),max=hi+sp;
  const t0=new Date(ks[0]).getTime(),t1=new Date(ks[ks.length-1]).getTime();const x=k=>pl+(W-pl-pr)*((new Date(k).getTime()-t0)/((t1-t0)||1)),y=v=>pt+(H-pt-pb)*(1-(v-min)/(max-min));
  const svg=svgEl(W,H,"Total savings over time");axisY(svg,max,min,y,pl,W,pr);
  let d="";ks.forEach((k,i)=>d+=(i?" L":"M")+x(k)+" "+y(snap[k]));svg.add("path",{d:d+" L"+x(ks[ks.length-1])+" "+(H-pb)+" L"+x(ks[0])+" "+(H-pb)+" Z",fill:"var(--ok)",opacity:.12});
  svg.add("path",{d,fill:"none",stroke:"var(--ok)","stroke-width":2.5});const lk=ks[ks.length-1];svg.add("circle",{cx:x(lk),cy:y(snap[lk]),r:4.5,fill:"var(--ok)",stroke:"var(--panel)","stroke-width":2});
  [ks[0],lk].forEach((k,i)=>svg.add("text",{x:x(k),y:H-7,"text-anchor":i?"end":"start"},new Date(k).toLocaleDateString("en-GB",{day:"numeric",month:"short"})));
  chartTip(box,svg,W,pl,pr,ks.length,ix=>new Date(ks[ix]).toLocaleDateString("en-GB",{day:"numeric",month:"short"})+" · "+fmt(snap[ks[ix]]));
}
function renderAU(){const t=totals(mKey(cur.y,cur.m));$("auMonth").textContent=fmt(t.fromAU);let y=0;for(let i=0;i<12;i++){const d=new Date(cur.y,cur.m-i,1);y+=totals(mKey(d.getFullYear(),d.getMonth())).fromAU}$("auYear").textContent=fmt(y)}
function renderAUChart(){const l=last6();barsChart($("auChart"),l.map(x=>totals(x.k).fromAU),l.map(x=>x.lab),0,"Money moved from Australia per month","var(--c4)")}

/* ---------- settings ---------- */
function fillSettings(){
  const s=settings();const mk=(box,cats,map)=>box.replaceChildren(...cats.map((c,i)=>{const f=el("div","field"),id=box.id+"_"+i,l=el("label","small muted",c);l.htmlFor=id;const x=el("input","amt");x.id=id;x.inputMode="decimal";x.value=map[c]||"";x.dataset.cat=c;f.append(l,x);return f}));
  mk($("setBudget"),EXP_CATS,s.budget);mk($("setSave"),SAVE_CATS.filter(c=>c!=="Investing"),s.targets);
  $("invShort").value=s.invest.short||"";$("invLong").value=s.invest.long||"";
  $("rAUD").value=s.rates.AUD||"";$("rEUR").value=s.rates.EUR||"";$("autoLock").value=String(lockMins());$("autoRates").checked=!!(docs.settings||{}).autoRates;$("ratesSave").disabled=true;
  const st=docs.settings||{};$("ratesInfo").textContent=st.ratesDate?"Using the ECB reference rate of "+new Date(st.ratesDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})+": 1 AUD = "+s.rates.AUD+" Kč, 1 EUR = "+s.rates.EUR+" Kč.":"Using rates typed in by hand.";
  $("lastBackup").textContent=st.lastBackup?"Last backup: "+new Date(st.lastBackup).toLocaleDateString("en-GB",{day:"numeric",month:"short"})+".":"No backup yet.";
}
["setBudget","setSave","invShort","invLong"].forEach(id=>$(id).addEventListener("input",()=>{$("tab-settings").dataset.dirty="1";$("saveSettings").disabled=false;$("setHint").textContent="Unsaved changes"}));
$("saveSettings").addEventListener("click",()=>{const st=ensureSettings();st.budget={};st.targets=st.targets||{};
  $("setBudget").querySelectorAll("input").forEach(i=>st.budget[i.dataset.cat]=parseNum(i.value)||0);
  $("setSave").querySelectorAll("input").forEach(i=>st.targets[i.dataset.cat]=parseNum(i.value)||0);
  st.invest={short:parseNum($("invShort").value)||0,long:parseNum($("invLong").value)||0};st.targets.Investing=st.invest.short+st.invest.long;
  persist().then(()=>{delete $("tab-settings").dataset.dirty;$("saveSettings").disabled=true;$("setHint").textContent="Saved";render()})});
$("autoLock").addEventListener("change",()=>{ensureSettings().autoLock=Number($("autoLock").value);persist().then(armIdle)});
["rAUD","rEUR"].forEach(id=>$(id).addEventListener("input",()=>$("ratesSave").disabled=false));
$("ratesSave").addEventListener("click",()=>{const st=ensureSettings();st.rates={AUD:parseNum($("rAUD").value)||0,EUR:parseNum($("rEUR").value)||0};st.ratesDate="";st.autoRates=false;
  persist().then(()=>{toast("Rates saved. Daily updates are off until you tick the box again.");render()})});
$("autoRates").addEventListener("change",()=>{ensureSettings().autoRates=$("autoRates").checked;persist().then(()=>{if($("autoRates").checked)updateRates(true)})});
$("ratesNow").addEventListener("click",()=>updateRates(true));
async function updateRates(force){
  const st=docs.settings;if(!st||!key)return;if(!force&&(!st.autoRates||(st.ratesFetched&&Date.now()-st.ratesFetched<12*3600e3)))return;
  const urls=["https://api.frankfurter.dev/v1/latest?base=EUR&symbols=CZK,AUD","https://api.frankfurter.app/latest?from=EUR&to=CZK,AUD"];
  for(const u of urls){try{const r=await fetch(u,{cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"});if(!r.ok)continue;const j=await r.json();const czk=+j.rates.CZK,aud=+j.rates.AUD;if(!(czk>0&&aud>0))continue;
    if(!key)return;st.rates={EUR:Math.round(czk*1000)/1000,AUD:Math.round(czk/aud*1000)/1000};st.ratesDate=j.date;st.ratesFetched=Date.now();if(force)st.autoRates=true;await persist();render();if(force)toast("Rates updated: 1 AUD = "+st.rates.AUD+" Kč");return}catch(_){}}
  if(force)toast("Couldn't reach the rates service. Your current rates stay in use.");
}
function renderBillsEditor(){const box=$("billsEditor");box.replaceChildren();billList().forEach(b=>box.appendChild(billRow(b)));if(!billList().length)box.appendChild(el("p","small muted","No bills yet."));$("billsSave").disabled=true}
function billRow(b){
  const r=el("div","bill-ed");const name=inp(b.name);name.className="wide";name.placeholder="Name, e.g. Rent";name.setAttribute("aria-label","Bill name");
  const amount=inp(b.amount!=null?String(b.amount):"","","decimal");amount.placeholder="Amount";amount.setAttribute("aria-label","Amount in CZK");
  const day=inp(b.day!=null?String(b.day):"","","numeric");day.placeholder="Day";day.setAttribute("aria-label","Day of month");
  const cat=el("select");cat.setAttribute("aria-label","Category");[["Spending",EXP_CATS],["Saving",SAVE_CATS]].forEach(([lab,list])=>{const g=el("optgroup");g.label=lab;list.forEach(c=>g.appendChild(el("option","",c)));cat.appendChild(g)});cat.value=b.cat||"Rent";
  const match=inp(b.match||"");match.placeholder="Words to match, e.g. vodafone";match.setAttribute("aria-label","Words to match");
  const x=el("button","x","Remove");x.type="button";x.addEventListener("click",()=>{r.remove();markBills()});
  const row=el("div","row");row.append(cat,match,x);r.append(name,amount,day,row);
  r._get=()=>({id:b.id||uid("b"),name:name.value.trim(),amount:parseNum(amount.value)||0,day:Math.max(1,Math.min(31,parseInt(day.value,10)||1)),cat:cat.value,match:match.value.trim()});
  [name,amount,day,match].forEach(e=>e.addEventListener("input",markBills));cat.addEventListener("change",markBills);return r;
}
function markBills(){$("billsPanel").dataset.dirty="1";$("billsSave").disabled=false}
$("billAdd").addEventListener("click",()=>{const box=$("billsEditor");if(!box.querySelector(".bill-ed"))box.replaceChildren();box.appendChild(billRow({}));markBills()});
$("billsSave").addEventListener("click",async()=>{const list=[...$("billsEditor").querySelectorAll(".bill-ed")].map(r=>r._get()).filter(b=>b.name);docs.bills={list};delete $("billsPanel").dataset.dirty;await persist();toast("Bills saved");render()});

/* ---------- import ---------- */
async function readText(file){const buf=await file.arrayBuffer();let t=new TextDecoder("utf-8").decode(buf);if(t.indexOf("�")>=0){try{t=new TextDecoder("windows-1250").decode(buf)}catch(_){}}return t}
$("importBtn").addEventListener("click",()=>$("importFile").click());
$("importBtn2").addEventListener("click",()=>$("importFile").click());
$("importFile").addEventListener("change",async e=>{
  const files=[...e.target.files];e.target.value="";if(!files.length||!key)return;
  const st=ensureSettings();const own=new Set(st.ownAccounts||[]);const have=allIds();
  let added=0,dupes=0,transfers=0,bad=0,merged=0,starter=false;const csvs=[];
  for(const f of files){const t=await readText(f);
    if(/^\s*\{/.test(t)){try{const o=JSON.parse(t);
      if(o.kind==="kc-starter"&&o.docs){starter=true;const sd=o.docs;
        if(sd.settings){const c2=ensureSettings();["budget","targets","rates"].forEach(x=>{if(sd.settings[x]&&!Object.keys(c2[x]||{}).length)c2[x]=sd.settings[x]});
          (sd.settings.ownAccounts||[]).forEach(a=>own.add(a));c2.rules={...(sd.settings.rules||{}),...(c2.rules||{})}}
        Object.keys(sd).filter(k=>/^m-\d{4}-\d{2}$/.test(k)).forEach(k=>{(sd[k].items||[]).forEach(i=>{if(have.has(i.id)){dupes++;return}have.add(i.id);(docs[k]=docs[k]||{items:[]}).items=items(k).concat(i);added++})});
        if(sd.accounts&&!(docs.accounts&&docs.accounts.list&&docs.accounts.list.length))docs.accounts=sd.accounts;
      }else if(o.kind==="kc-vault"){toast("That's a backup. Use Restore a backup instead.");return}else bad++}catch(_){bad++}}
    else csvs.push(t)}
  csvs.forEach(t=>{const r=rbParseCSV(t);const ix=r[0]?r[0].indexOf("Account number"):-1;if(ix>=0)r.slice(1).forEach(x=>x[ix]&&own.add(x[ix]))});
  const s=settings();const opts={ownAccounts:[...own],emergencyTarget:s.targets["Emergency savings"],rules:st.rules||{}};
  csvs.forEach(t=>{const res=rbToItems(t,opts);if(res.error){bad++;return}transfers+=res.skipped;
    res.items.forEach(i=>{if(have.has(i.id)){dupes++;return}have.add(i.id);i.ts=Date.now();
      const twin=findShotTwin(i);if(twin){i.cat=twin.it.cat;if(twin.it.parts)i.parts=twin.it.parts;if(twin.it.oneoff)i.oneoff=true;if(twin.it.att)i.att=twin.it.att;docs[twin.k].items=items(twin.k).filter(x=>x.id!==twin.it.id);merged++}
      const k="m-"+i.date.slice(0,7);(docs[k]=docs[k]||{items:[]}).items=items(k).concat(i);added++})});
  st.ownAccounts=[...own];
  if(!added&&!dupes&&bad){toast("Those files aren't Raiffeisenbank Movements exports or a Kč Ledger starter file.");return}
  if(starter)await migrate();
  await persist();render();
  toast((starter?"Starter loaded. ":"")+"Added "+added+" entr"+(added===1?"y":"ies")+(dupes?", "+dupes+" already here":"")+(transfers?", "+transfers+" transfers between your accounts left out":"")+(merged?", "+merged+" matched to screenshot entries":"")+".");
  if(starter)setTimeout(()=>toast("Now delete the starter file from your phone."),3600);
});

/* ---------- backup / restore / CSV ---------- */
async function offerFile(name,blob){
  const file=new File([blob],name,{type:blob.type});
  if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:name});return true}catch(e){if(e&&e.name==="AbortError")return false}}
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);return true;
}
async function doBackup(){await saving;const rec=await idbGet();if(!rec)return;
  const fs=await fileAll();const ids=Object.keys(fs);if(ids.length){rec.files={};ids.forEach(id=>{const f=fs[id];rec.files[id]={iv:f.iv,ct:b64(f.ct),type:f.type}})}
  const ok=await offerFile("kc-ledger-backup-"+todayIso()+".json",new Blob([JSON.stringify(rec)],{type:"application/json"}));
  if(ok){ensureSettings().lastBackup=Date.now();await persist();$("backupHint").className="hint ok";$("backupHint").textContent="Backup saved. It opens with your current passcode.";render()}}
$("backupBtn").addEventListener("click",doBackup);
let pendingBackup=null;
$("restoreBtn").addEventListener("click",()=>$("restoreFile").click());
$("restoreFile").addEventListener("change",async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;
  try{const o=JSON.parse(await f.text());if(o.kind!=="kc-vault"||!o.ct)throw 0;pendingBackup=o;$("restoreWrap").hidden=false;$("restorePass").focus();$("backupHint").className="hint";$("backupHint").textContent="Restoring replaces everything on this phone with the backup."}
  catch(_){$("backupHint").className="hint err";$("backupHint").textContent="That file isn't a Kč Ledger backup."}});
$("restoreCancel").addEventListener("click",()=>{pendingBackup=null;$("restoreWrap").hidden=true;$("restorePass").value="";$("backupHint").textContent=""});
$("restoreGo").addEventListener("click",async()=>{if(!pendingBackup)return;const h=$("backupHint");h.className="hint";h.textContent="Checking passcode…";const pass=$("restorePass").value;
  let o;try{o=await openWithPass(pendingBackup,pass)}catch(_){h.className="hint err";h.textContent="That passcode doesn't open this backup.";return}
  await saving;const files=pendingBackup.files||{};await fileClear();
  if(o.legacyKey){const src={};Object.keys(files).forEach(id=>src[id]={iv:files[id].iv,ct:unb64(files[id].ct).buffer,type:files[id].type});
    const u=await upgradeLegacy(o.legacyKey,pass,src);await startSession(u.raw,u.k,o.docs,u.keys)}
  else{for(const id of Object.keys(files))await filePut(id,{iv:files[id].iv,ct:unb64(files[id].ct).buffer,type:files[id].type});await startSession(o.raw,o.key,o.docs,{pass:pendingBackup.keys.pass})}
  await migrate();await persist();pendingBackup=null;$("restoreWrap").hidden=true;$("restorePass").value="";
  h.className="hint ok";h.textContent="Backup restored. Its passcode is now this phone's passcode. Turn Face ID back on below if you use it.";delete $("tab-settings").dataset.dirty;delete $("billsPanel").dataset.dirty;render()});
$("csvBtn").addEventListener("click",()=>{const rows=[["date","type","category","amount","currency","amount_czk","one_off","note"]];
  allItems().forEach(({i})=>rows.push([i.date,i.type,i.parts?i.parts.map(p=>p.cat+" "+p.czk).join(" | "):i.cat,i.amount,i.cur,i.czk,i.oneoff?"yes":"",i.note||""]));
  const csv=rows.map(r=>r.map(v=>{v=String(v==null?"":v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}).join(",")).join("\n");
  offerFile("kc-ledger-"+todayIso()+".csv",new Blob([csv],{type:"text/csv"}));toast("This CSV is not encrypted. Delete it once you're done with it.")});

/* ---------- passcode change, erase ---------- */
$("passForm").addEventListener("submit",async e=>{e.preventDefault();const h=$("passHint");h.className="hint";
  const o=$("pOld").value,n=$("pNew").value;
  if(n.length<6){h.textContent="Use at least 6 characters.";h.className="hint err";return}
  if(n!==$("pNew2").value){h.textContent="The new passcodes don't match.";h.className="hint err";return}
  h.textContent="Checking…";await saving;
  try{const p=keys.pass;await unwrap(p,await passKey(o,unb64(p.salt),p.iter))}catch(_){h.textContent="Your current passcode isn't right.";h.className="hint err";return}
  keys.pass=await passWrap(rawKey,n);await persist();
  ["pOld","pNew","pNew2"].forEach(i=>$(i).value="");h.className="hint ok";h.textContent="Passcode changed. Older backups still open with the old passcode."});
$("eraseBtn").addEventListener("click",async()=>{const b=$("eraseBtn");if(!b.classList.contains("confirm")){b.classList.add("confirm");b.textContent="Tap again to erase everything";setTimeout(()=>{b.classList.remove("confirm");b.textContent="Erase all data"},4000);return}
  await saving;await idbDel();await fileClear();lock();});

/* ---------- images: compressed, encrypted, stored apart from the ledger ---------- */
async function shrink(file,maxSide){
  let bmp;try{bmp=await createImageBitmap(file)}catch(_){const url=URL.createObjectURL(file);bmp=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=url})}
  const w=bmp.width,h=bmp.height,sc=Math.min(1,maxSide/Math.max(w,h));const c=document.createElement("canvas");c.width=Math.round(w*sc);c.height=Math.round(h*sc);
  c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);return new Promise(res=>c.toBlob(b=>res(b),"image/jpeg",.82));
}
async function storeImage(file){if(!key)throw new Error("locked");const blob=await shrink(file,1600);const bytes=await blob.arrayBuffer();const id=uid("img-");await filePut(id,{...(await encBytes(key,bytes)),type:"image/jpeg"});return id}
function refs(){const n={};allItems().forEach(({i})=>(i.att||[]).forEach(a=>n[a]=(n[a]||0)+1));return n}
async function dropUnused(ids){if(!ids||!ids.length)return;const n=refs();for(const id of ids)if(!n[id])await fileDel(id)}
let attachTarget=null;
function pickAttach(k,id,fromSheet){attachTarget={k,id,fromSheet};$("attachFile").click()}
$("attachFile").addEventListener("change",async e=>{const f=e.target.files[0];e.target.value="";if(!f||!attachTarget||!key)return;const t=attachTarget;attachTarget=null;
  try{const id=await storeImage(f);let nk=t.k;if(!items(nk).some(x=>x.id===t.id)){const f2=allItems().find(x=>x.i.id===t.id);nk=f2&&f2.k}if(!nk)return;
    docs[nk].items=items(nk).map(x=>x.id===t.id?{...x,att:(x.att||[]).concat(id)}:x);await persist();toast("Image attached");render();if(t.fromSheet){closeSheet();openEditor(nk,t.id)}}
  catch(_){toast("Couldn't attach that image.")}});
$("fReceipt").addEventListener("change",()=>{const f=$("fReceipt").files[0];$("fReceiptName").textContent=f?f.name:""});
$("fReceiptBtn").addEventListener("click",()=>$("fReceipt").click());
let viewUrl=null,viewing=null;
async function openViewer(k,i,idx){
  const ids=i.att||[];if(!ids.length)return;idx=(idx+ids.length)%ids.length;viewing={k,id:i.id,idx};
  const rec=await fileGet(ids[idx]);if(!rec){toast("That image is missing on this phone.");return}
  const bytes=await decBytes(key,rec);if(viewUrl)URL.revokeObjectURL(viewUrl);viewUrl=URL.createObjectURL(new Blob([bytes],{type:rec.type||"image/jpeg"}));
  $("viewImg").src=viewUrl;$("viewCap").textContent=(i.note||i.cat||"")+" · "+fmt(i.czk)+(ids.length>1?"  ("+(idx+1)+" of "+ids.length+")":"");
  $("viewNext").hidden=ids.length<2;$("viewDel").textContent="Remove image";$("viewDel").classList.remove("confirm");$("viewer").hidden=false;
}
function closeViewer(){$("viewer").hidden=true;$("viewImg").removeAttribute("src");if(viewUrl){URL.revokeObjectURL(viewUrl);viewUrl=null}viewing=null}
$("viewClose").addEventListener("click",closeViewer);
$("viewNext").addEventListener("click",()=>{if(!viewing)return;const it=items(viewing.k).find(x=>x.id===viewing.id);if(it)openViewer(viewing.k,it,viewing.idx+1)});
$("viewDel").addEventListener("click",async()=>{const b=$("viewDel");if(!viewing)return;if(!b.classList.contains("confirm")){b.classList.add("confirm");b.textContent="Tap again to remove";return}
  const v=viewing,it=items(v.k).find(x=>x.id===v.id);if(!it)return;const gone=it.att[v.idx];
  docs[v.k].items=items(v.k).map(x=>x.id===v.id?{...x,att:x.att.filter(a=>a!==gone)}:x);await persist();await dropUnused([gone]);closeViewer();toast("Image removed");
  if(!$("sheet").hidden){closeSheet();openEditor(v.k,v.id)}render()});

/* ---------- read transactions from a screenshot (on this phone) ---------- */
let ocrWorker=null;
function loadScript(src){return new Promise((res,rej)=>{if(window.Tesseract)return res();const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=()=>rej(new Error("load"));document.head.appendChild(s)})}
async function getOcr(progress){
  if(ocrWorker)return ocrWorker;progress("Loading text recognition (first time only)…",0);await loadScript("ocr/tesseract.min.js");
  ocrWorker=await Tesseract.createWorker(["eng","ces"],1,{workerPath:"ocr/worker.min.js",corePath:"ocr/",langPath:"ocr",gzip:true,workerBlobURL:false,cacheMethod:"none",
    logger:m=>{if(m.status==="recognizing text")progress("Reading text…",m.progress);else if(/load/.test(m.status||""))progress("Loading text recognition (first time only)…",m.progress||0)}});
  return ocrWorker;
}
const MONTHS={led:1,jan:1,"úno":2,uno:2,feb:2,"bře":3,bre:3,mar:3,dub:4,apr:4,"kvě":5,kve:5,may:5,jun:6,jul:7,srp:8,aug:8,"zář":9,zar:9,sep:9,"říj":10,rij:10,oct:10,okt:10,lis:11,nov:11,pro:12,dec:12};
function monthFrom(word){word=word.toLowerCase();if(/^července|^cervenc|^červenc/.test(word))return 7;if(/^červ|^cerv/.test(word))return 6;for(const k of Object.keys(MONTHS).sort((a,b)=>b.length-a.length))if(word.startsWith(k))return MONTHS[k];return 0}
function findDate(line){
  const t=new Date();let m;
  if(/\b(dnes|today)\b/i.test(line))return iso(t);
  if(/\b(včera|vcera|yesterday)\b/i.test(line)){t.setDate(t.getDate()-1);return iso(t)}
  if((m=line.match(/\b(\d{1,2})\s?\.\s?(\d{1,2})\s?\.\s?(\d{4}|\d{2})?\b/))){const d=+m[1],mo=+m[2];let y=m[3]?+m[3]:t.getFullYear();if(y<100)y+=2000;if(d>=1&&d<=31&&mo>=1&&mo<=12){let dt=new Date(y,mo-1,d);if(!m[3]&&dt>t)dt=new Date(y-1,mo-1,d);return iso(dt)}}
  if((m=line.match(/\b(\d{1,2})\.?\s+([A-Za-zÀ-ž]{3,})\b(?:\s+(\d{4}))?/))){const mo=monthFrom(m[2]);if(mo){const y=m[3]?+m[3]:t.getFullYear();let dt=new Date(y,mo-1,+m[1]);if(!m[3]&&dt>t)dt=new Date(y-1,mo-1,+m[1]);return iso(dt)}}
  return null;
}
const AMT=/([+\-−–]?)\s?((?:\d{1,3}(?:[  .']\d{3})+|\d+)(?:,\d{1,2}|\.\d{2})?)\s?(Kč|Kc|CZK|EUR|€|AUD|A\$)?/g;
function amountsIn(line){
  const out=[];let m;AMT.lastIndex=0;
  while((m=AMT.exec(line))){const raw=m[2];const hasDec=/[,.]\d{1,2}$/.test(raw)&&!/^\d{1,3}\.\d{3}$/.test(raw);const cur2=m[3];const sign=m[1];
    if(!cur2&&!sign&&!hasDec)continue;
    let num=raw.replace(/[  ']/g,"");if(/,\d{1,2}$/.test(num))num=num.replace(/\./g,"").replace(",",".");else if(/\.\d{3}$/.test(num)||/\.\d{3}\./.test(num))num=num.replace(/\./g,"");
    const v=parseFloat(num);if(!isFinite(v)||v===0||v>10000000)continue;
    out.push({v,sign:sign?(sign==="+"?1:-1):0,cur:cur2?(/eur|€/i.test(cur2)?"EUR":/aud|a\$/i.test(cur2)?"AUD":"CZK"):null,idx:m.index,len:m[0].length})}
  return out;
}
const NOISE=/^(card payment|platba kartou|internet transaction|internetová transakce|transakce|payment|platba|odchozí|příchozí|incoming|outgoing|pending|čeká|zpracovává|processing|today|dnes|yesterday|včera)\b/i;
const letters=s=>(s.match(/[A-Za-zÀ-ž]/g)||[]).length;
function cleanName(s){return s.replace(/[|•·*_=<>«»]+/g," ").replace(/\s{2,}/g," ").replace(/^[\s\-–:;,.]+|[\s\-–:;,.]+$/g,"").slice(0,60)}
function parseShot(text){
  const lines=text.replace(/[−–]/g,"-").split(/\n/).map(l=>l.replace(/ /g," ").trim()).filter(Boolean);
  const today=todayIso();const found=[];
  const totalRe=/(celkem|total|k úhradě|k uhrade|suma|celková částka|amount due|to pay|zaplaceno|platba kartou celkem)/i;
  const tots=[];lines.forEach((l,ix)=>{if(totalRe.test(l)){const a=amountsIn(l);if(!a.length&&lines[ix+1])a.push(...amountsIn(lines[ix+1]));if(a.length)tots.push(a.sort((x,y)=>y.v-x.v)[0])}});
  if(tots.length){const best=tots.sort((x,y)=>y.v-x.v)[0];let date=null;for(const l of lines){date=findDate(l);if(date)break}
    const name=cleanName(lines.find(l=>letters(l)>=3&&!totalRe.test(l)&&!amountsIn(l).length)||"Receipt");
    return {kind:"receipt",rows:[{date:date||today,name,amount:best.v,cur:best.cur||"CZK",type:"expense"}]}}
  let date=null;const used=new Set();
  lines.forEach((l,ix)=>{
    const d=findDate(l);const am=amountsIn(l);
    if(d&&!am.length){date=d;return}
    if(!am.length)return;
    if(/zůstatek|zustatek|balance|dostupn|available|limit/i.test(l))return;
    const a=am[am.length-1];
    let name=cleanName(l.slice(0,a.idx).replace(/\b\d{1,2}[:.]\d{2}\b/g,""));
    if(letters(name)<3||NOISE.test(name)){name="";for(let j=ix-1;j>=0&&j>=ix-3;j--){const c=lines[j];if(used.has(j)||amountsIn(c).length)break;if(findDate(c)&&letters(c.replace(/\d/g,""))<6)continue;if(letters(c)>=3&&!NOISE.test(c)){name=cleanName(c);used.add(j);break}}}
    const below=lines[ix+1]||"";const incoming=/příchozí|prichozi|incoming|received|připsáno/i.test(l+" "+below);
    found.push({date:d||date||today,name:name||"Unknown",amount:a.v,cur:a.cur||"CZK",type:a.sign>0||incoming?"income":"expense"});
  });
  return {kind:"list",rows:found};
}
function guessCat(name,ty){
  if(ty==="income")return /vsb|všb|mzda|salary|plat\b/i.test(name)?"Salary":/\bwise\b|transferwise/i.test(name)?AU_CAT:/úrok|urok|interest/i.test(name)?"Interest":"Other income";
  if(ty==="saving")return /invest/i.test(name)?"Investing":"Emergency savings";
  const rules=(docs.settings||{}).rules||{};const k=rbKey(name,"");if(rules[k])return rules[k];
  const hay=name.toLowerCase();if(/\brent\b|nájem|najem/.test(hay))return "Rent";
  const hit=RB_RULES.find(([c,re])=>re.test(hay));return hit?hit[0]:"Clothing & misc";
}
let shotFile=null;
function closeReview(){$("shotPanel").hidden=true;$("shotRows").replaceChildren();shotFile=null;if($("shotPreview").src)URL.revokeObjectURL($("shotPreview").src);$("shotPreview").removeAttribute("src")}
function progress(msg,p){$("shotStatus").textContent=msg+(p>0&&p<1?" "+Math.round(p*100)+"%":"")}
$("shotBtn").addEventListener("click",()=>$("shotFile").click());
$("shotFile").addEventListener("change",async e=>{const f=e.target.files[0];e.target.value="";if(!f||!key)return;
  closeReview();shotFile=f;$("shotPanel").hidden=false;$("shotPreview").src=URL.createObjectURL(f);$("shotActions").hidden=true;$("shotRawWrap").hidden=true;
  $("shotPanel").scrollIntoView({behavior:"smooth",block:"start"});
  try{const w=await getOcr(progress);progress("Reading text…",0);const {data}=await w.recognize(f);if(!key||shotFile!==f)return;
    const res=parseShot(data.text||"");$("shotRaw").textContent=data.text||"";$("shotRawWrap").hidden=false;
    buildReview(res.rows.length?res.rows:[{date:todayIso(),name:"",amount:"",cur:"CZK",type:"expense"}],res);
  }catch(err){progress("Couldn't read that image. You can still enter the details below and keep the screenshot.",0);buildReview([{date:todayIso(),name:"",amount:"",cur:"CZK",type:"expense"}],{kind:"none",rows:[]})}
});
function buildReview(rows,res){
  const box=$("shotRows");box.replaceChildren();
  progress(res.rows.length?(res.kind==="receipt"?"Found a receipt total. Check it, then save.":"Found "+res.rows.length+" transaction"+(res.rows.length>1?"s":"")+". Untick any that are wrong or already in your ledger."):"No amounts found. Enter the details yourself and keep the screenshot.",0);
  const have=allItems().map(x=>x.i);
  rows.forEach((r,ix)=>{
    const row=el("div","shot-row");const top=el("div","shot-top");
    const cb=el("input");cb.type="checkbox";cb.checked=true;cb.id="sr"+ix+"_on";cb.setAttribute("aria-label","Include");
    const nm=el("input");nm.value=r.name;nm.placeholder="Merchant or description";nm.id="sr"+ix+"_nm";nm.setAttribute("aria-label","Description");top.append(cb,nm);
    const grid=el("div","shot-grid");const dt=el("input");dt.type="date";dt.value=r.date;dt.setAttribute("aria-label","Date");
    const amt=el("input","amt");amt.inputMode="decimal";amt.value=r.amount===""?"":String(r.amount).replace(".",",");amt.setAttribute("aria-label","Amount");
    const cu=el("select");["CZK","EUR","AUD"].forEach(c=>cu.appendChild(el("option","",c)));cu.value=r.cur;cu.setAttribute("aria-label","Currency");
    const ty=el("select");[["expense","Spent"],["income","Income"],["saving","Saved"]].forEach(([v,t])=>{const o=el("option","",t);o.value=v;ty.appendChild(o)});ty.value=r.type;ty.setAttribute("aria-label","Type");
    const cat=el("select");cat.setAttribute("aria-label","Category");
    const fillC=()=>{const list=ty.value==="expense"?EXP_CATS:ty.value==="saving"?SAVE_CATS:INC_CATS;const g=guessCat(nm.value,ty.value);cat.replaceChildren(...list.map(c=>el("option","",c)));cat.value=list.includes(g)?g:list[0]};
    fillC();ty.addEventListener("change",fillC);nm.addEventListener("change",fillC);grid.append(dt,amt,cu,ty,cat);
    const warn=el("div","shot-warn");
    const dupe=have.find(h=>h.type===r.type&&Math.abs((Number(h.czk)||0)-r.amount)<0.01&&Math.abs(new Date(h.date)-new Date(r.date))<=3*DAY);
    if(dupe&&r.amount!==""){warn.textContent="Looks like it's already in your ledger ("+(dupe.note||dupe.cat)+", "+dupe.date.slice(8,10)+"."+dupe.date.slice(5,7)+"). Unticked.";cb.checked=false}
    row.append(top,grid,warn);row._get=()=>({on:cb.checked,name:nm.value.trim(),date:dt.value,amount:parseNum(amt.value),cur:cu.value,type:ty.value,cat:cat.value});box.appendChild(row)});
  $("shotActions").hidden=false;
}
$("shotAddRow").addEventListener("click",()=>{const rows=[...$("shotRows").children].map(r=>r._get());buildReview(rows.map(r=>({...r,amount:isNaN(r.amount)?"":r.amount})).concat([{date:todayIso(),name:"",amount:"",cur:"CZK",type:"expense"}]),{kind:"list",rows:[1]})});
$("shotCancel").addEventListener("click",closeReview);
$("shotSave").addEventListener("click",async()=>{if(!key)return;
  const rows=[...$("shotRows").children].map(r=>r._get()).filter(r=>r.on);
  for(const r of rows){if(!(r.amount>0)){toast("Each ticked row needs an amount above zero.");return}if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)){toast("Each ticked row needs a date.");return}if(!rateOf(r.cur)){toast("Set the "+r.cur+" exchange rate in Settings first.");return}}
  if(!rows.length){toast("Tick at least one row to save.");return}
  $("shotSave").disabled=true;
  try{let attId=null;if($("shotKeep").checked&&shotFile)attId=await storeImage(shotFile);
    rows.forEach(r=>{const k="m-"+r.date.slice(0,7);const it={id:uid("ss-"),type:r.type,cat:r.cat,amount:r.amount,cur:r.cur,czk:Math.round(r.amount*rateOf(r.cur)*100)/100,note:(r.name||"Screenshot entry").slice(0,80),date:r.date,ts:Date.now(),src:"shot",key:rbKey(r.name,"")};
      if(r.cur!=="CZK")it.orig=r.amount+" "+r.cur;if(attId)it.att=[attId];(docs[k]=docs[k]||{items:[]}).items=items(k).concat(it)});
    await persist();closeReview();toast("Saved "+rows.length+" entr"+(rows.length>1?"ies":"y")+(attId?" with the screenshot":""));render();
  }catch(_){toast("Couldn't save. Try again.")}finally{$("shotSave").disabled=false}
});
function findShotTwin(i){for(const {k,i:x} of allItems())if(x.src==="shot"&&x.type===i.type&&Math.abs((Number(x.czk)||0)-i.czk)<0.01&&Math.abs(new Date(x.date)-new Date(i.date))<=3*DAY)return {k,it:x};return null}

/* ---------- start ---------- */
let rz;addEventListener("resize",()=>{clearTimeout(rz);rz=setTimeout(renderCharts,150)});
if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
boot();
})();
