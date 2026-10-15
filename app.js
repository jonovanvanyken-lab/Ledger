/* Kč Ledger — everything stays on this phone, encrypted with your passcode (PBKDF2-SHA256 → AES-GCM-256). */
(function(){
"use strict";
const EXP_CATS=["Rent","Groceries","Eating out & cafés","Gas & electricity","Travel","Clothing & misc","Household & cleaning","Gym & hobbies","Health & pharmacy","Public transport","Phone"];
const SAVE_CATS=["Emergency savings","Investing"];
const INC_CATS=["Salary","Rental income","Transfer from Australia","Interest","Other income"];
const ITER=600000;
const $=id=>document.getElementById(id);
const te=new TextEncoder(),td=new TextDecoder();
const b64=buf=>{let s="";const b=new Uint8Array(buf);for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s)};
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const fmt=n=>new Intl.NumberFormat("cs-CZ",{maximumFractionDigits:0}).format(Math.round(n||0))+" Kč";
const fmtCur=(n,c)=>new Intl.NumberFormat("cs-CZ",{maximumFractionDigits:2}).format(n)+" "+c;
const parseNum=s=>{const v=parseFloat(String(s).replace(/\s/g,"").replace(",","."));return isFinite(v)?v:NaN};
const pad=n=>String(n).padStart(2,"0");
const mKey=(y,m)=>"m-"+y+"-"+pad(m+1);
const mName=(y,m,short)=>new Date(y,m,1).toLocaleDateString("en-GB",short?{month:"short"}:{month:"long",year:"numeric"});

/* ---------- storage: one encrypted record in IndexedDB ---------- */
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open("kc-ledger",1);r.onupgradeneeded=()=>r.result.createObjectStore("vault");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idbGet(){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction("vault").objectStore("vault").get("main");t.onsuccess=()=>res(t.result||null);t.onerror=()=>rej(t.error)})}
async function idbPut(v){const d=await idb();return new Promise((res,rej)=>{const tx=d.transaction("vault","readwrite");tx.objectStore("vault").put(v,"main");tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function idbDel(){const d=await idb();return new Promise((res,rej)=>{const tx=d.transaction("vault","readwrite");tx.objectStore("vault").delete("main");tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}

async function deriveKey(pass,salt,iter){
  const base=await crypto.subtle.importKey("raw",te.encode(pass),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:iter,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function seal(k,saltB64,iter,obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},k,te.encode(JSON.stringify(obj)));
  return {kind:"kc-vault",v:1,iter,salt:saltB64,iv:b64(iv),ct:b64(ct),saved:Date.now()};
}
async function open(rec,pass){ // throws on wrong passcode
  const k=await deriveKey(pass,unb64(rec.salt),rec.iter);
  const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(rec.iv)},k,unb64(rec.ct));
  return {key:k,data:JSON.parse(td.decode(pt))};
}

/* ---------- session state (cleared on lock) ---------- */
let key=null,salt=null,iter=ITER,docs={},type="expense";
const now=new Date();let cur={y:now.getFullYear(),m:now.getMonth()};
let saving=Promise.resolve();
function persist(){saving=saving.then(async()=>{if(!key)return;await idbPut(await seal(key,salt,iter,docs))});return saving.catch(e=>{toast("Couldn't save on this phone: "+(e&&e.message||"storage error"));throw e})}

/* ---------- lock screen ---------- */
let mode="unlock";
async function boot(){
  if(!window.crypto||!crypto.subtle||!window.indexedDB){$("lockSub").textContent="This browser can't run Kč Ledger securely. Open it in Safari or Chrome over https.";return}
  let rec=null;try{rec=await idbGet()}catch(e){}
  mode=rec?"unlock":"setup";
  $("lockForm").hidden=false;$("lockFine").hidden=false;
  if(mode==="setup"){$("lockSub").textContent="Choose a passcode to encrypt your ledger on this phone. Use at least 6 characters.";$("pass1Label").textContent="New passcode";$("pass2Wrap").hidden=false;$("lockBtn").textContent="Create ledger";$("pass2").required=true}
  else{$("lockSub").textContent="Enter your passcode to unlock.";$("pass1Label").textContent="Passcode";$("pass2Wrap").hidden=true;$("lockBtn").textContent="Unlock";$("pass2").required=false}
  setTimeout(()=>$("pass1").focus(),50);
}
$("lockForm").addEventListener("submit",async e=>{
  e.preventDefault();const p1=$("pass1").value,h=$("lockHint");h.className="hint";
  if(p1.length<6){h.textContent="Use at least 6 characters.";h.className="hint err";return}
  $("lockBtn").disabled=true;
  try{
    if(mode==="setup"){
      if(p1!==$("pass2").value){h.textContent="The two passcodes don't match.";h.className="hint err";return}
      h.textContent="Setting up encryption…";
      salt=b64(crypto.getRandomValues(new Uint8Array(16)));iter=ITER;key=await deriveKey(p1,unb64(salt),iter);docs={};
      await persist();try{await navigator.storage?.persist?.()}catch(_){}
    }else{
      h.textContent="Unlocking…";const rec=await idbGet();
      try{const o=await open(rec,p1);key=o.key;docs=o.data||{};salt=rec.salt;iter=rec.iter}
      catch(_){h.textContent="That passcode didn't work. Try again.";h.className="hint err";$("pass1").select();return}
    }
    $("pass1").value="";$("pass2").value="";h.textContent="";$("fDate").value=defaultDate();
    $("lock").hidden=true;$("app").hidden=false;showTab(docs.settings?"overview":"settings");render();armIdle();
    if(!docs.settings)toast("Start by importing your starter file or bank CSVs.");
  }finally{$("lockBtn").disabled=false}
});
function lock(){
  key=null;docs={};salt=null;
  ["ledger","bars","sbars","accts","trend","setBudget","setSave"].forEach(id=>$(id).replaceChildren());
  document.querySelectorAll("#app input").forEach(i=>{if(i.type!=="file")i.value=""});
  $("app").hidden=true;$("lock").hidden=false;boot();
}
$("lockNow").addEventListener("click",lock);
// auto-lock after time away or idle
let hiddenAt=0,idleT=null;
const lockMins=()=>Number((docs.settings||{}).autoLock)||1;
function armIdle(){clearTimeout(idleT);if(key)idleT=setTimeout(lock,lockMins()*60000)}
["pointerdown","keydown","scroll","touchstart"].forEach(ev=>addEventListener(ev,armIdle,{passive:true}));
document.addEventListener("visibilitychange",()=>{if(document.hidden)hiddenAt=Date.now();else if(key&&hiddenAt&&Date.now()-hiddenAt>lockMins()*60000)lock()});

/* ---------- helpers on docs ---------- */
function settings(){
  const s=docs.settings||{};const budget={},targets={};
  EXP_CATS.forEach(c=>budget[c]=Number((s.budget||{})[c])||0);SAVE_CATS.forEach(c=>targets[c]=Number((s.targets||{})[c])||0);
  return {budget,targets,rates:{CZK:1,AUD:Number((s.rates||{}).AUD)||0,EUR:Number((s.rates||{}).EUR)||0}};
}
const ensureSettings=()=>docs.settings||(docs.settings={budget:{},targets:{},rates:{},ownAccounts:[],rules:{},autoLock:1});
const items=k=>((docs[k]||{}).items||[]).filter(i=>i&&typeof i==="object");
function totals(k){const t={expense:0,saving:0,income:0,byCat:{}};items(k).forEach(i=>{const v=Number(i.czk)||0;t[i.type]=(t[i.type]||0)+v;t.byCat[i.type+":"+i.cat]=(t.byCat[i.type+":"+i.cat]||0)+v});return t}
function allIds(){const s=new Set();Object.keys(docs).filter(k=>k.startsWith("m-")).forEach(k=>items(k).forEach(i=>s.add(i.id)));return s}
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
let toastT;function toast(t){const d=$("toast");d.textContent=t;d.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>d.hidden=true,3200)}

/* ---------- tabs ---------- */
function showTab(name){document.querySelectorAll(".tab").forEach(t=>t.hidden=t.id!=="tab-"+name);document.querySelectorAll(".tabbar button").forEach(b=>{if(b.dataset.tab===name)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});scrollTo(0,0);if(name==="overview")requestAnimationFrame(()=>renderTrend())}
document.querySelectorAll(".tabbar button").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));

/* ---------- render ---------- */
function render(){
  if(!key)return;
  $("monthLabel").textContent=mName(cur.y,cur.m);
  const k=mKey(cur.y,cur.m),s=settings(),t=totals(k);
  const budgetTotal=EXP_CATS.reduce((a,c)=>a+s.budget[c],0),targetTotal=SAVE_CATS.reduce((a,c)=>a+s.targets[c],0);
  $("kSpent").textContent=fmt(t.expense);$("kSpentOf").textContent="of "+fmt(budgetTotal);
  const pct=budgetTotal?t.expense/budgetTotal:0,pill=$("kSpentPill");pill.className="pill "+(pct>1?"bad":pct>.85?"warn":"ok");pill.textContent=budgetTotal?Math.round(pct*100)+"%":"no budget";
  const left=budgetTotal-t.expense;$("kLeft").textContent=fmt(left);
  const isNow=now.getFullYear()===cur.y&&now.getMonth()===cur.m,dim=new Date(cur.y,cur.m+1,0).getDate();
  if(isNow&&left>0){const days=dim-new Date().getDate()+1;$("kLeftSub").textContent="≈ "+fmt(left/days)+" a day, "+days+" days left"}
  else $("kLeftSub").textContent=left<0?"over budget":"at month end";
  $("kSaved").textContent=fmt(t.saving);$("kSavedOf").textContent="of "+fmt(targetTotal)+" target";
  $("kIncome").textContent=fmt(t.income);

  const mk=(box,cats,map,kind)=>{box.replaceChildren();cats.forEach(c=>{const spent=t.byCat[kind+":"+c]||0,b=map[c],p=b?spent/b:(spent?1.01:0);
    const bar=el("div","bar"),top=el("div","bar-top");top.append(el("span","",c),el("span","v amt",fmt(spent)+" / "+fmt(b)));
    const tr=el("div","track"),f=el("div","fill "+(kind==="saving"?(p>=1?"ok":""):(p>1?"bad":p>.85?"warn":"")));f.style.width=Math.min(100,p*100).toFixed(1)+"%";tr.appendChild(f);bar.append(top,tr);box.appendChild(bar)})};
  mk($("bars"),EXP_CATS,s.budget,"expense");mk($("sbars"),SAVE_CATS,s.targets,"saving");

  // ledger
  const list=items(k).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.ts||0)-(a.ts||0));
  const ul=$("ledger");ul.replaceChildren();$("entryCount").textContent=list.length?list.length+" in "+mName(cur.y,cur.m,true):"";
  if(!list.length)ul.appendChild(el("li","empty","Nothing logged for "+mName(cur.y,cur.m)+" yet."));
  list.forEach(i=>{const li=el("li");
    const d=el("span","d",(i.date||"").slice(8,10));
    const w=el("div");const c=el("div","c");const cb=el("button","catbtn",i.cat||"Uncategorised");cb.addEventListener("click",()=>openCat(c,k,i));c.appendChild(cb);
    if(i.type!=="expense")c.appendChild(el("span","tag "+(i.type==="income"?"in":"sv"),i.type==="income"?"in":"saved"));
    w.appendChild(c);if(i.note)w.appendChild(el("div","n",i.note));
    const a=el("div","a amt",(i.type==="income"&&i.czk>0?"+":"")+fmt(i.czk));
    if(i.orig||(i.cur&&i.cur!=="CZK"))a.appendChild(el("small","",i.orig||fmtCur(i.amount,i.cur)));
    const act=el("div","row-actions");const del=el("button","del","Remove");
    del.addEventListener("click",()=>{if(!del.classList.contains("confirm")){del.classList.add("confirm");del.textContent="Tap again to remove";setTimeout(()=>{del.classList.remove("confirm");del.textContent="Remove"},3000);return}
      docs[k].items=items(k).filter(x=>x.id!==i.id);persist().then(()=>{toast("Entry removed");render()})});
    act.appendChild(del);li.append(d,w,a,el("span"),act);ul.appendChild(li)});

  renderAccounts(s);renderTrend();
  if(!$("tab-settings").dataset.dirty)fillSettings(s);
}
function openCat(c,k,i){
  const list=i.type==="expense"?EXP_CATS:i.type==="saving"?SAVE_CATS:INC_CATS;
  const sel=el("select","catsel");sel.setAttribute("aria-label","Category");list.forEach(x=>sel.appendChild(el("option","",x)));sel.value=list.includes(i.cat)?i.cat:list[0];
  c.replaceChildren(sel);sel.focus();sel.addEventListener("blur",()=>setTimeout(render,200));
  sel.addEventListener("change",()=>{const cat=sel.value;docs[k].items=items(k).map(x=>x.id===i.id?{...x,cat}:x);
    let learned=false;if(i.src==="rb"&&i.key&&i.type==="expense"){const st=ensureSettings();st.rules=st.rules||{};st.rules[i.key]=cat;learned=true}
    persist().then(()=>{toast(learned?"Moved to "+cat+". Future imports will remember this merchant.":"Moved to "+cat);render()})});
}
function renderAccounts(s){
  const acc=((docs.accounts||{}).list||[]),box=$("accts");box.replaceChildren();
  let net=0,missing=false;acc.forEach(a=>{const r=s.rates[a.cur];if(!r)missing=true;else net+=(Number(a.balance)||0)*r});
  $("kNet").textContent=acc.length?fmt(net):"—";$("kNetSub").textContent=acc.length?(missing?"Some balances skipped: set the exchange rate in Settings.":"converted to CZK"):"Add your accounts below.";
  acc.forEach(a=>{const row=el("div","acct");const l=el("div");l.style.minWidth="0";l.append(el("div","nm",a.name),el("div","meta",a.updated?"updated "+new Date(a.updated).toLocaleDateString("en-GB",{day:"numeric",month:"short"}):""));
    const bal=el("div","bal amt",fmtCur(Number(a.balance)||0,a.cur));if(a.cur!=="CZK"&&s.rates[a.cur])bal.appendChild(el("small","","≈ "+fmt((Number(a.balance)||0)*s.rates[a.cur])));
    const ed=el("div","edit");const up=el("button","link","Update balance");
    up.addEventListener("click",()=>{ed.replaceChildren();const inp=el("input");inp.inputMode="decimal";inp.value=a.balance;inp.setAttribute("aria-label","New balance");
      const ok=el("button","link","Save"),rm=el("button","link","Delete");rm.style.color="var(--bad)";
      ok.addEventListener("click",()=>{const v=parseNum(inp.value);if(isNaN(v))return;a.balance=v;a.updated=Date.now();persist().then(render)});
      rm.addEventListener("click",()=>{if(rm.textContent!=="Tap to confirm"){rm.textContent="Tap to confirm";return}docs.accounts.list=acc.filter(x=>x!==a);persist().then(render)});
      ed.append(inp,ok,rm);inp.focus()});
    ed.appendChild(up);row.append(l,bal,ed);box.appendChild(row)});
}
let months6=[];
function renderTrend(){
  const box=$("trend");if(!key||box.offsetParent===null)return;const s=settings();const budgetTotal=EXP_CATS.reduce((a,c)=>a+s.budget[c],0);
  months6=[];for(let i=5;i>=0;i--){const d=new Date(cur.y,cur.m-i,1),t=totals(mKey(d.getFullYear(),d.getMonth()));months6.push({lab:mName(d.getFullYear(),d.getMonth(),true),sp:t.expense,sv:t.saving})}
  if(!months6.some(m=>m.sp||m.sv)){box.replaceChildren(el("div","empty","The chart fills in as you add entries."));return}
  const W=Math.max(280,box.clientWidth),H=210,pl=44,pr=6,pt=10,pb=24;
  const max=(Math.max(budgetTotal,...months6.map(m=>Math.max(m.sp,m.sv)))||1)*1.08;
  const step=Math.pow(10,Math.floor(Math.log10(max/4)));const tick=[1,2,2.5,5,10].map(x=>x*step).find(x=>max/x<=5)||step*10;
  const y=v=>pt+(H-pt-pb)*(1-v/max),gw=(W-pl-pr)/6,bw=Math.min(20,gw*.3);
  const NS="http://www.w3.org/2000/svg",svg=document.createElementNS(NS,"svg");svg.setAttribute("viewBox","0 0 "+W+" "+H);svg.setAttribute("width","100%");svg.setAttribute("role","img");svg.setAttribute("aria-label","Spending and saving over six months");
  const add=(tag,attrs,text)=>{const e=document.createElementNS(NS,tag);for(const a in attrs)e.setAttribute(a,attrs[a]);if(text!=null)e.textContent=text;svg.appendChild(e);return e};
  for(let v=0;v<=max;v+=tick){add("line",{x1:pl,x2:W-pr,y1:y(v),y2:y(v),stroke:"var(--line)"});add("text",{x:pl-6,y:y(v)+4,"text-anchor":"end",class:"amt"},v>=1000?(v/1000)+"k":String(v))}
  months6.forEach((m,i)=>{const cx=pl+gw*i+gw/2;
    add("rect",{x:cx-bw-2,y:y(m.sp),width:bw,height:Math.max(0,H-pb-y(m.sp)),rx:2,fill:"var(--accent)"});
    add("rect",{x:cx+2,y:y(m.sv),width:bw,height:Math.max(0,H-pb-y(m.sv)),rx:2,fill:"var(--ok)"});
    add("text",{x:cx,y:H-7,"text-anchor":"middle",class:i===5?"now":""},m.lab);
    add("rect",{x:pl+gw*i,y:pt,width:gw,height:H-pt-pb,fill:"transparent","data-i":i})});
  if(budgetTotal)add("line",{x1:pl,x2:W-pr,y1:y(budgetTotal),y2:y(budgetTotal),stroke:"var(--muted)","stroke-width":1.5,"stroke-dasharray":"5 4"});
  const tip=el("div","tip amt");tip.hidden=true;box.replaceChildren(svg,tip);
  svg.addEventListener("pointerdown",show);svg.addEventListener("pointermove",show);svg.addEventListener("pointerleave",()=>tip.hidden=true);
  function show(e){const i=e.target.getAttribute&&e.target.getAttribute("data-i");if(i==null){tip.hidden=true;return}const m=months6[i];tip.textContent=m.lab+" · spent "+fmt(m.sp)+" · saved "+fmt(m.sv);tip.hidden=false;
    const r=box.getBoundingClientRect();let x=e.clientX-r.left-tip.offsetWidth/2;x=Math.max(0,Math.min(x,r.width-tip.offsetWidth));tip.style.left=x+"px";tip.style.top="0px"}
}
let rz;addEventListener("resize",()=>{clearTimeout(rz);rz=setTimeout(renderTrend,150)});

/* ---------- month nav, privacy ---------- */
function defaultDate(){const t=new Date();if(t.getFullYear()===cur.y&&t.getMonth()===cur.m)return t.getFullYear()+"-"+pad(t.getMonth()+1)+"-"+pad(t.getDate());return cur.y+"-"+pad(cur.m+1)+"-01"}
function move(n){const d=new Date(cur.y,cur.m+n,1);cur={y:d.getFullYear(),m:d.getMonth()};$("fDate").value=defaultDate();render()}
$("prevM").addEventListener("click",()=>move(-1));$("nextM").addEventListener("click",()=>move(1));
$("fDate").value=defaultDate();
$("hideBtn").addEventListener("click",()=>{const on=document.body.classList.toggle("private");$("hideBtn").setAttribute("aria-pressed",String(on));$("hideBtn").textContent=on?"Show":"Hide"});

/* ---------- add entry ---------- */
function fillCats(){const list=type==="expense"?EXP_CATS:type==="saving"?SAVE_CATS:INC_CATS,sel=$("fCat"),prev=sel.value;sel.replaceChildren(...list.map(c=>el("option","",c)));if(list.includes(prev))sel.value=prev}
document.querySelectorAll(".seg button").forEach(b=>b.addEventListener("click",()=>{type=b.dataset.type;document.querySelectorAll(".seg button").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));fillCats();$("saveBtn").textContent=type==="expense"?"Add expense":type==="saving"?"Add saving":"Add income"}));
fillCats();
$("entryForm").addEventListener("submit",e=>{e.preventDefault();if(!key)return;const h=$("formHint");
  const amt=parseNum($("fAmt").value),c=$("fCur").value,s=settings();
  if(!(amt>0)){h.textContent="Enter an amount above zero.";h.className="hint err";return}
  if(!s.rates[c]){h.textContent="Set the "+c+" exchange rate in Settings first.";h.className="hint err";return}
  const date=$("fDate").value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;const k="m-"+date.slice(0,7);
  const it={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),type,cat:$("fCat").value,amount:amt,cur:c,czk:Math.round(amt*s.rates[c]*100)/100,note:$("fNote").value.trim().slice(0,80),date,ts:Date.now()};
  (docs[k]=docs[k]||{items:[]}).items=items(k).concat(it);
  persist().then(()=>{$("fAmt").value="";$("fNote").value="";h.className="hint ok";h.textContent="Added "+it.cat+" · "+fmt(it.czk);render()});
});
$("acctForm").addEventListener("submit",e=>{e.preventDefault();if(!key)return;const v=parseNum($("aBal").value),n=$("aName").value.trim();if(!n||isNaN(v))return;
  docs.accounts=docs.accounts||{list:[]};docs.accounts.list.push({id:Date.now().toString(36),name:n.slice(0,40),cur:$("aCur").value,balance:v,updated:Date.now()});
  persist().then(()=>{$("aName").value="";$("aBal").value="";render()})});

/* ---------- settings ---------- */
function fillSettings(s){
  const mk=(box,cats,map)=>box.replaceChildren(...cats.map((c,i)=>{const f=el("div","field"),id=box.id+"_"+i,l=el("label","small muted",c);l.htmlFor=id;const inp=el("input","amt");inp.id=id;inp.inputMode="decimal";inp.value=map[c]||"";inp.dataset.cat=c;f.append(l,inp);return f}));
  mk($("setBudget"),EXP_CATS,s.budget);mk($("setSave"),SAVE_CATS,s.targets);
  $("rAUD").value=s.rates.AUD||"";$("rEUR").value=s.rates.EUR||"";$("autoLock").value=String(lockMins());
}
["setBudget","setSave","rAUD","rEUR"].forEach(id=>$(id).addEventListener("input",()=>{$("tab-settings").dataset.dirty="1";$("saveSettings").disabled=false;$("setHint").textContent="Unsaved changes"}));
$("saveSettings").addEventListener("click",()=>{const st=ensureSettings();st.budget={};st.targets={};
  $("setBudget").querySelectorAll("input").forEach(i=>st.budget[i.dataset.cat]=parseNum(i.value)||0);
  $("setSave").querySelectorAll("input").forEach(i=>st.targets[i.dataset.cat]=parseNum(i.value)||0);
  st.rates={AUD:parseNum($("rAUD").value)||0,EUR:parseNum($("rEUR").value)||0};
  persist().then(()=>{delete $("tab-settings").dataset.dirty;$("saveSettings").disabled=true;$("setHint").textContent="Saved";render()})});
$("autoLock").addEventListener("change",()=>{ensureSettings().autoLock=Number($("autoLock").value);persist().then(armIdle)});

/* ---------- import ---------- */
async function readText(file){const buf=await file.arrayBuffer();let t=new TextDecoder("utf-8").decode(buf);if(t.indexOf("�")>=0){try{t=new TextDecoder("windows-1250").decode(buf)}catch(_){}}return t}
$("importBtn").addEventListener("click",()=>$("importFile").click());
$("importBtn2").addEventListener("click",()=>$("importFile").click());
$("importFile").addEventListener("change",async e=>{
  const files=[...e.target.files];e.target.value="";if(!files.length||!key)return;
  const st=ensureSettings();const own=new Set(st.ownAccounts||[]);const have=allIds();
  let added=0,dupes=0,transfers=0,bad=0,starter=false;const csvs=[];
  for(const f of files){const t=await readText(f);
    if(/^\s*\{/.test(t)){try{const o=JSON.parse(t);
      if(o.kind==="kc-starter"&&o.docs){starter=true;const sd=o.docs;
        if(sd.settings){const cur=ensureSettings();["budget","targets","rates"].forEach(x=>{if(sd.settings[x]&&!Object.keys(cur[x]||{}).length)cur[x]=sd.settings[x]});
          (sd.settings.ownAccounts||[]).forEach(a=>own.add(a));cur.rules={...(sd.settings.rules||{}),...(cur.rules||{})}}
        Object.keys(sd).filter(k=>/^m-\d{4}-\d{2}$/.test(k)).forEach(k=>{(sd[k].items||[]).forEach(i=>{if(have.has(i.id)){dupes++;return}have.add(i.id);(docs[k]=docs[k]||{items:[]}).items=items(k).concat(i);added++})});
        if(sd.accounts&&!(docs.accounts&&docs.accounts.list&&docs.accounts.list.length))docs.accounts=sd.accounts;
      }else if(o.kind==="kc-vault"){toast("That's a backup. Use Restore a backup instead.");return}else bad++}catch(_){bad++}}
    else csvs.push(t)}
  // learn every account in this batch first, so transfers between them are left out
  csvs.forEach(t=>{const r=rbParseCSV(t);const ix=r[0]?r[0].indexOf("Account number"):-1;if(ix>=0)r.slice(1).forEach(x=>x[ix]&&own.add(x[ix]))});
  const s=settings();const opts={ownAccounts:[...own],emergencyTarget:s.targets["Emergency savings"],rules:st.rules||{}};
  csvs.forEach(t=>{const res=rbToItems(t,opts);if(res.error){bad++;return}transfers+=res.skipped;
    res.items.forEach(i=>{if(have.has(i.id)){dupes++;return}have.add(i.id);i.ts=Date.now();const k="m-"+i.date.slice(0,7);(docs[k]=docs[k]||{items:[]}).items=items(k).concat(i);added++})});
  st.ownAccounts=[...own];
  if(!added&&!dupes&&bad){toast("Those files aren't Raiffeisenbank Movements exports or a Kč Ledger starter file.");return}
  await persist();render();
  toast((starter?"Starter loaded. ":"")+"Added "+added+" entr"+(added===1?"y":"ies")+(dupes?", "+dupes+" already here":"")+(transfers?", "+transfers+" transfers between your accounts left out":"")+".");
  if(starter)setTimeout(()=>toast("Now delete the starter file from your phone's Downloads."),3600);
});

/* ---------- backup / restore / CSV ---------- */
async function offerFile(name,blob,hintEl){
  const file=new File([blob],name,{type:blob.type});
  if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:name});return true}catch(e){if(e&&e.name==="AbortError")return false}}
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);return true;
}
$("backupBtn").addEventListener("click",async()=>{await saving;const rec=await idbGet();if(!rec)return;rec.kind="kc-vault";
  const ok=await offerFile("kc-ledger-backup-"+new Date().toISOString().slice(0,10)+".json",new Blob([JSON.stringify(rec)],{type:"application/json"}));
  if(ok){$("backupHint").className="hint ok";$("backupHint").textContent="Backup saved. It's encrypted with your current passcode."}});
let pendingBackup=null;
$("restoreBtn").addEventListener("click",()=>$("restoreFile").click());
$("restoreFile").addEventListener("change",async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;
  try{const o=JSON.parse(await f.text());if(o.kind!=="kc-vault"||!o.ct)throw 0;pendingBackup=o;$("restoreWrap").hidden=false;$("restorePass").focus();$("backupHint").className="hint";$("backupHint").textContent="Restoring replaces everything on this phone with the backup."}
  catch(_){$("backupHint").className="hint err";$("backupHint").textContent="That file isn't a Kč Ledger backup."}});
$("restoreCancel").addEventListener("click",()=>{pendingBackup=null;$("restoreWrap").hidden=true;$("restorePass").value="";$("backupHint").textContent=""});
$("restoreGo").addEventListener("click",async()=>{if(!pendingBackup)return;const h=$("backupHint");h.className="hint";h.textContent="Checking passcode…";
  try{const o=await open(pendingBackup,$("restorePass").value);key=o.key;docs=o.data||{};salt=pendingBackup.salt;iter=pendingBackup.iter;
    await saving;await idbPut({...pendingBackup,kind:"kc-vault"});pendingBackup=null;$("restoreWrap").hidden=true;$("restorePass").value="";
    h.className="hint ok";h.textContent="Backup restored. Its passcode is now this phone's passcode.";delete $("tab-settings").dataset.dirty;render()}
  catch(_){h.className="hint err";h.textContent="That passcode doesn't open this backup."}});
$("csvBtn").addEventListener("click",()=>{const rows=[["date","type","category","amount","currency","amount_czk","note"]];
  Object.keys(docs).filter(k=>k.startsWith("m-")).sort().forEach(k=>items(k).forEach(i=>rows.push([i.date,i.type,i.cat,i.amount,i.cur,i.czk,i.note||""])));
  const csv=rows.map(r=>r.map(v=>{v=String(v==null?"":v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}).join(",")).join("\n");
  offerFile("kc-ledger-"+new Date().toISOString().slice(0,10)+".csv",new Blob([csv],{type:"text/csv"}));
  toast("This CSV is not encrypted. Delete it once you're done with it.")});

/* ---------- passcode change, erase ---------- */
$("passForm").addEventListener("submit",async e=>{e.preventDefault();const h=$("passHint");h.className="hint";
  const o=$("pOld").value,n=$("pNew").value;
  if(n.length<6){h.textContent="Use at least 6 characters.";h.className="hint err";return}
  if(n!==$("pNew2").value){h.textContent="The new passcodes don't match.";h.className="hint err";return}
  h.textContent="Checking…";await saving;
  try{await open(await idbGet(),o)}catch(_){h.textContent="Your current passcode isn't right.";h.className="hint err";return}
  salt=b64(crypto.getRandomValues(new Uint8Array(16)));iter=ITER;key=await deriveKey(n,unb64(salt),iter);await persist();
  ["pOld","pNew","pNew2"].forEach(i=>$(i).value="");h.className="hint ok";h.textContent="Passcode changed. Older backups still open with the old passcode."});
$("eraseBtn").addEventListener("click",async()=>{const b=$("eraseBtn");if(!b.classList.contains("confirm")){b.classList.add("confirm");b.textContent="Tap again to erase everything";setTimeout(()=>{b.classList.remove("confirm");b.textContent="Erase all data"},4000);return}
  await saving;await idbDel();lock();});

/* ---------- offline ---------- */
if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
boot();
})();
