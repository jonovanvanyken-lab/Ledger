(function(){
/* Kč Ledger — a private budgeting app. Everything stays on this device, encrypted.
   A random data key encrypts the ledger and images. That key is stored wrapped by your passcode
   (PBKDF2-SHA256, 600k rounds → AES-GCM) and, if you turn it on, by a Face ID passkey (WebAuthn PRF → HKDF → AES-GCM). */
"use strict";
const ITER=600000,DAY=864e5,APP_VERSION=9;
const $=id=>document.getElementById(id);
const te=new TextEncoder(),td=new TextDecoder();
const b64=buf=>{let s="";const b=buf instanceof Uint8Array?buf:new Uint8Array(buf);for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s)};
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const rnd=n=>crypto.getRandomValues(new Uint8Array(n));
const parseNum=s=>{const v=parseFloat(String(s).replace(/\s/g,"").replace(",","."));return isFinite(v)?v:NaN};
const pad=n=>String(n).padStart(2,"0");
const mKey=(y,m)=>"m-"+y+"-"+pad(m+1);
const iso=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const todayIso=()=>iso(new Date());
const dOf=s=>new Date(s+"T00:00");
const uid=p=>(p||"")+Date.now().toString(36)+b64(rnd(6)).replace(/[^a-z0-9]/gi,"").slice(0,6);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
let toastT;function toast(msg){const d=$("toast");d.textContent=msg;d.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>d.hidden=true,3600)}
const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");

/* ---------- language ---------- */
let LANG="en";
function t(s,v){const d=window.KC_CS||{};let r=LANG==="cs"&&d[s]!=null?d[s]:s;if(v)r=r.replace(/\{(\w+)\}/g,(m,k)=>v[k]!=null?String(v[k]):m);return r}
// plural word for n: pl(3,"day") → "days" / "dny"
function pl(n,key){const f=(window.KC_PL||{})[key]||{};const a=Math.abs(Math.round(n));
  if(LANG==="cs"&&f.cs)return a===1?f.cs[0]:(a>=2&&a<=4?f.cs[1]:f.cs[2]);const en=f.en||[key,key+"s"];return a===1?en[0]:en[1]}
const LOC=()=>LANG==="cs"?"cs-CZ":"en-GB";
function translateDom(root){
  const d=window.KC_CS||{};root=root||document.body;
  const tw=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];let n;while((n=tw.nextNode()))nodes.push(n);
  nodes.forEach(n=>{if(n.__en==null){const s=n.nodeValue.trim();if(!s||d[s]==null)return;n.__en=n.nodeValue}const s=n.__en.trim();n.nodeValue=LANG==="cs"&&d[s]!=null?n.__en.replace(s,d[s]):n.__en});
  root.querySelectorAll("[placeholder],[aria-label],[title]").forEach(e=>["placeholder","aria-label","title"].forEach(a=>{if(!e.hasAttribute(a))return;const k="__en_"+a;
    if(e[k]==null){const v=e.getAttribute(a);if(d[v]==null)return;e[k]=v}e.setAttribute(a,LANG==="cs"&&d[e[k]]!=null?d[e[k]]:e[k])}));
}
function setLang(l){LANG=l==="cs"?"cs":"en";document.documentElement.lang=LANG;try{localStorage.setItem("kc-lang",LANG)}catch(_){}translateDom(document.body);
  document.querySelectorAll("[data-lang]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.lang===LANG)))}
const mName=(y,m,short)=>new Date(y,m,1).toLocaleDateString(LOC(),short?{month:"short"}:{month:"long",year:"numeric"});
const dShort=s=>dOf(s).toLocaleDateString(LOC(),{day:"numeric",month:"short"});
const dLong=s=>dOf(s).toLocaleDateString(LOC(),{day:"numeric",month:"long",year:"numeric"});
const dDay=s=>LANG==="cs"?(+s.slice(8,10))+".":String(+s.slice(8,10));
function ord(n){if(LANG==="cs")return n+".";return n+(n%10===1&&n!==11?"st":n%10===2&&n!==12?"nd":n%10===3&&n!==13?"rd":"th")}
const WEEKDAYS=()=>[0,1,2,3,4,5,6].map(i=>new Date(2024,0,1+i).toLocaleDateString(LOC(),{weekday:"long"}));
const WD_SHORT=()=>[0,1,2,3,4,5,6].map(i=>new Date(2024,0,1+i).toLocaleDateString(LOC(),{weekday:"short"}).replace(".","").slice(0,2));

/* ---------- money ---------- */
const CURRENCIES=["CZK","EUR","USD","GBP","AUD","PLN","HUF","CHF","SEK","NOK","DKK","CAD","NZD","RON","BGN","JPY","ZAR"];
const SYM={CZK:"Kč",EUR:"€",USD:"$",GBP:"£",AUD:"A$",PLN:"zł",HUF:"Ft",CHF:"CHF",SEK:"kr",NOK:"kr",DKK:"kr",CAD:"C$",NZD:"NZ$",RON:"lei",BGN:"лв",JPY:"¥",ZAR:"R"};
const PREFIX=new Set(["EUR","USD","GBP","AUD","CAD","NZD","JPY","ZAR"]);
function money(v,c,dec){c=c||"CZK";const a=Math.abs(v);const n=new Intl.NumberFormat(LOC(),{maximumFractionDigits:dec||0,minimumFractionDigits:0}).format(dec?a:Math.round(a));
  const s=SYM[c]||c;const pre=LANG!=="cs"&&PREFIX.has(c);return (v<0?"−":"")+(pre?s+n:n+" "+s)}
function baseCur(){return (docs.settings||{}).currency||"CZK"}
function cur2(){return (docs.settings||{}).currency2||""}
function rateOf(c){if(!c||c===baseCur())return 1;const r=((docs.settings||{}).rates||{})[c];return Number(r)||0}
function dispAlt(){const s=docs.settings||{};return !!(s.dispCur&&s.dispCur!==baseCur()&&s.dispCur===cur2()&&rateOf(s.dispCur)>0)}
function dispCode(){return dispAlt()?docs.settings.dispCur:baseCur()}
function conv(n){return dispAlt()?n/rateOf(docs.settings.dispCur):n}
function fmt(n){return money(conv(Number(n)||0),dispCode())}
const fmtCur=(n,c)=>money(n,c,2);
function short(n){const v=conv(n);return Math.abs(v)>=1000?(Math.round(v/100)/10)+"k":String(Math.round(v))}
function curOptions(extra){const l=[baseCur(),cur2(),"EUR","USD","GBP"].concat(extra||[]).filter(Boolean);return [...new Set(l)]}

/* ---------- IndexedDB: one encrypted ledger record + encrypted images ---------- */
let dbp=null;
function idb(){return dbp||(dbp=new Promise((res,rej)=>{const r=indexedDB.open("kc-ledger",2);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("vault"))d.createObjectStore("vault");if(!d.objectStoreNames.contains("files"))d.createObjectStore("files")};r.onsuccess=()=>res(r.result);r.onerror=()=>{dbp=null;rej(r.error)}}))}
function tx(store,mode,fn){return idb().then(d=>new Promise((res,rej)=>{const tr=d.transaction(store,mode);const st=tr.objectStore(store);let out;const q=fn(st);if(q)q.onsuccess=()=>out=q.result;tr.oncomplete=()=>res(out);tr.onerror=()=>rej(tr.error)}))}
const idbGet=()=>tx("vault","readonly",st=>st.get("main")).then(v=>v||null);
const idbPut=v=>tx("vault","readwrite",st=>st.put(v,"main"));
const idbDel=()=>tx("vault","readwrite",st=>st.delete("main"));
const fileGet=id=>tx("files","readonly",st=>st.get(id));
const filePut=(id,v)=>tx("files","readwrite",st=>st.put(v,id));
const fileDel=id=>tx("files","readwrite",st=>st.delete(id));
const fileClear=()=>tx("files","readwrite",st=>st.clear());
function fileAll(){return idb().then(d=>new Promise((res,rej)=>{const out={};const tr=d.transaction("files");const c=tr.objectStore("files").openCursor();c.onsuccess=()=>{const cu=c.result;if(cu){out[cu.key]=cu.value;cu.continue()}};tr.oncomplete=()=>res(out);tr.onerror=()=>rej(tr.error)}))}

/* ---------- crypto ---------- */
async function passKey(pass,salt,iter){const base=await crypto.subtle.importKey("raw",te.encode(pass),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:iter,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
const dataKey=raw=>crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"]);
async function wrap(raw,wk){const iv=rnd(12);return {iv:b64(iv),ct:b64(await crypto.subtle.encrypt({name:"AES-GCM",iv},wk,raw))}}
async function unwrap(w,wk){return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(w.iv)},wk,unb64(w.ct)))}
async function encBytes(k,bytes){const iv=rnd(12);return {iv:b64(iv),ct:await crypto.subtle.encrypt({name:"AES-GCM",iv},k,bytes)}}
async function decBytes(k,rec){return crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(rec.iv)},k,rec.ct instanceof ArrayBuffer?rec.ct:unb64(rec.ct))}
async function seal(obj,kk){const iv=rnd(12);const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,te.encode(JSON.stringify(obj||docs)));return {kind:"kc-vault",v:2,keys:kk||keys,iv:b64(iv),ct:b64(ct),saved:Date.now()}}
const stripDevice=d=>{const o={...d};delete o._device;return o};
async function openBody(k,rec){return JSON.parse(td.decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(rec.iv)},k,unb64(rec.ct))))}
async function openWithPass(rec,pass){
  if(rec.v===2){const p=rec.keys.pass;const raw=await unwrap(p,await passKey(pass,unb64(p.salt),p.iter));const k=await dataKey(raw);return {raw,key:k,docs:await openBody(k,rec)}}
  const lk=await passKey(pass,unb64(rec.salt),rec.iter);const d=await openBody(lk,rec);return {legacyKey:lk,docs:d};
}
async function passWrap(raw,pass){const salt=rnd(16);return {salt:b64(salt),iter:ITER,ts:Date.now(),...(await wrap(raw,await passKey(pass,salt,ITER)))}}

/* ---------- session (cleared on lock) ---------- */
let key=null,rawKey=null,keys=null,docs={},type="expense";
const now=new Date();let cur={y:now.getFullYear(),m:now.getMonth()};
let saving=Promise.resolve(),inSync=false;
function persist(){saving=saving.then(async()=>{if(!key)return;await idbPut(await seal())});if(!inSync)syncSoon(4000);return saving.catch(e=>{toast(t("Couldn't save on this device: ")+(e&&e.message||"storage error"));throw e})}
async function startSession(raw,k,d,kk){rawKey=raw;key=k;docs=d||{};keys=kk}
async function upgradeLegacy(legacyKey,pass,filesSrc){
  const raw=rnd(32),k=await dataKey(raw);const fs=filesSrc||await fileAll();
  for(const id of Object.keys(fs)){const f=fs[id];const bytes=await decBytes(legacyKey,f);await filePut(id,{...(await encBytes(k,bytes)),type:f.type||"image/jpeg"})}
  return {raw,k,keys:{pass:await passWrap(raw,pass)}};
}

/* ---------- lock screen ---------- */
let mode="unlock",failCount=0;
async function boot(){
  if(!window.crypto||!crypto.subtle||!window.indexedDB){$("lockSub").textContent=t("This browser can't run Kč Ledger securely. Open it in Safari or Chrome over https.");return}
  let rec=null;try{rec=await idbGet()}catch(e){}
  mode=rec?"unlock":"setup";$("lockForm").hidden=false;$("lockFine").hidden=false;$("lockLangs").hidden=mode!=="setup";
  $("bioBtn").hidden=!(rec&&rec.v===2&&rec.keys&&rec.keys.prf);
  if(mode==="setup"){$("lockSub").textContent=t("Choose a passcode to encrypt your data on this device. Use at least 6 characters; four or five random words are best.");$("pass1Label").textContent=t("New passcode");$("pass2Wrap").hidden=false;$("lockBtn").textContent=t("Create my ledger");$("pass2").required=true}
  else{$("lockSub").textContent=$("bioBtn").hidden?t("Enter your passcode to unlock."):t("Unlock with Face ID, or enter your passcode.");$("pass1Label").textContent=t("Passcode");$("pass2Wrap").hidden=true;$("lockBtn").textContent=t("Unlock");$("pass2").required=false}
  if($("bioBtn").hidden)setTimeout(()=>$("pass1").focus(),50);
}
document.querySelectorAll("[data-lang]").forEach(b=>b.addEventListener("click",()=>{setLang(b.dataset.lang);boot()}));
$("lockForm").addEventListener("submit",async e=>{
  e.preventDefault();const p1=$("pass1").value,h=$("lockHint");h.className="hint";
  if(p1.length<6){h.textContent=t("Use at least 6 characters.");h.className="hint err";return}
  $("lockBtn").disabled=true;
  try{
    if(mode==="setup"){
      if(p1!==$("pass2").value){h.textContent=t("The two passcodes don't match.");h.className="hint err";return}
      h.textContent=t("Setting up encryption…");const raw=rnd(32);
      await startSession(raw,await dataKey(raw),{},{pass:await passWrap(raw,p1)});
      docs.settings=newSettings();await persist();try{await navigator.storage?.persist?.()}catch(_){}
    }else{
      h.textContent=t("Unlocking…");const rec=await idbGet();let o;
      try{o=await openWithPass(rec,p1)}catch(_){failCount++;h.textContent=failCount<2?t("That passcode didn't work. Try again."):t("That passcode didn't work. If you're sure it's right, close the app completely and reopen it: it may still be finishing an update. Your data is safe.");h.className="hint err";$("pass1").select();return}
      if(o.legacyKey){h.textContent=t("Upgrading your ledger's encryption…");const u=await upgradeLegacy(o.legacyKey,p1);await startSession(u.raw,u.k,o.docs,u.keys);await persist()}
      else await startSession(o.raw,o.key,o.docs,rec.keys);
    }
    $("pass1").value="";$("pass2").value="";h.textContent="";failCount=0;await enterApp();
  }finally{$("lockBtn").disabled=false}
});
async function enterApp(){
  if(!docs.settings)docs.settings=newSettings();
  await migrate();applyPrefs();$("lock").hidden=true;
  if(!docs.settings.onboarded){startWizard();armIdle();return}
  showApp();
}
async function showApp(){
  $("wizard").hidden=true;$("app").hidden=false;cur=periodOfDate(new Date());$("fDate").value=defaultDate();
  if(docs.settings.hideOnOpen)setPrivate(true);
  if(await runAuto())await persist();
  showTab("health");render();armIdle();updateRates(false);syncSoon(800);
}
function lock(){
  clearTimeout(syncT);pendingJoin=null;key=null;rawKey=null;keys=null;docs={};closeViewer();closeReview();closeSheet();
  ["ledger","bars","accts","trend","pace","bills","donut","donutLegend","heat","dayList","merchants","goals","invSplit","invChart","netChart","auChart","banners","recap","hDial","hSum","hChecks","hCompare","setCats","setSave","recList","wzBody","kidList","kidSugg","kidBalance","kidMonth","kidChart","setInc","rateRows"].forEach(id=>{const e=$(id);if(e)e.replaceChildren()});
  document.querySelectorAll("#app input,#wizard input").forEach(i=>{if(i.type!=="file"&&i.type!=="checkbox"&&i.type!=="radio")i.value=""});
  $("app").hidden=true;$("wizard").hidden=true;$("lock").hidden=false;$("lockSub").textContent=t("Checking this device…");setPrivate(false);boot();
}
$("lockNow").addEventListener("click",lock);
let hiddenAt=0,idleT=null;
const lockMins=()=>Number((docs.settings||{}).autoLock)||1;
function armIdle(){clearTimeout(idleT);if(key)idleT=setTimeout(lock,lockMins()*60000)}
["pointerdown","keydown","scroll","touchstart"].forEach(ev=>addEventListener(ev,armIdle,{passive:true}));
document.addEventListener("visibilitychange",()=>{if(document.hidden)hiddenAt=Date.now();else if(key&&hiddenAt&&Date.now()-hiddenAt>lockMins()*60000)lock()});
function setPrivate(on){document.body.classList.toggle("private",on);const b=$("hideBtn");if(b){b.setAttribute("aria-pressed",String(on));const l=on?t("Show amounts"):t("Hide amounts");b.setAttribute("aria-label",l);b.title=l}}
function applyTheme(th){const r=document.documentElement;if(th==="light"||th==="dark")r.dataset.theme=th;else delete r.dataset.theme}
function applyPrefs(){const s=docs.settings||{};setLang(s.lang||LANG);applyTheme(s.theme);applyCats();fillFilterCats();fillCats()}

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
  try{const rec=await idbGet();const p=rec.keys.prf;h.textContent=t("Waiting for Face ID…");
    const raw=await unwrap(p,await prfKey(await prfEval(p.cred,p.salt)));const k=await dataKey(raw);const d=await openBody(k,rec);
    await startSession(raw,k,d,rec.keys);h.textContent="";await enterApp();
  }catch(e){h.className="hint err";h.textContent=e&&e.message==="noprf"?t("Face ID isn't available for this app on this device. Use your passcode."):t("Face ID didn't unlock it. Use your passcode.")}});
// returns true when Face ID was turned on
async function enrolBio(infoEl){
  if(!window.PublicKeyCredential){infoEl.textContent=t("This browser doesn't support Face ID for web apps.");return false}
  try{
    infoEl.textContent=t("Follow the Face ID prompt…");
    const c=await navigator.credentials.create({publicKey:{rp:{name:"Kč Ledger",id:location.hostname},user:{id:rnd(16),name:"Kč Ledger",displayName:"Kč Ledger"},challenge:rnd(32),
      pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}],authenticatorSelection:{authenticatorAttachment:"platform",residentKey:"preferred",userVerification:"required"},timeout:60000,extensions:{prf:{}}}});
    const ext=c.getClientExtensionResults?c.getClientExtensionResults():{};if(ext.prf&&ext.prf.enabled===false)throw new Error("noprf");
    const cred=b64(new Uint8Array(c.rawId)),salt=b64(rnd(32));infoEl.textContent=t("One more Face ID check to finish…");
    const out=await prfEval(cred,salt);keys.prf={cred,salt,...(await wrap(rawKey,await prfKey(out)))};await persist();infoEl.textContent=t("Face ID unlock is on.");return true;
  }catch(e){infoEl.textContent=e&&e.message==="noprf"?t("This device can't use Face ID for web apps yet (iPhones need iOS 18 or later). Your passcode still works."):t("Face ID wasn't set up. You can try again.");return false}
}
$("bioToggle").addEventListener("click",async()=>{
  if(keys&&keys.prf){delete keys.prf;await persist();renderBio();toast(t("Face ID unlock turned off"));return}
  await enrolBio($("bioInfo"));renderBio();
});
function renderBio(){const on=!!(keys&&keys.prf);$("bioToggle").textContent=on?t("Turn off"):t("Turn on");$("bioInfo").textContent=on?t("On. Your passcode keeps working too."):t("Unlock with Face ID instead of typing your passcode. Your passcode keeps working too.")}

/* ---------- categories ---------- */
const KINDS={expense:["rent","utilities","groceries","dining","transport","phone","health","household","misc","hobbies","kids","insurance","subscriptions","travel","other"],
  saving:["emergency","investing","goal"],income:["salary","maintenance","benefits","rental","interest","transfer","other"]};
const DEF_NAMES={expense:{rent:["Rent or mortgage","Nájem nebo hypotéka"],utilities:["Energy","Energie"],groceries:["Groceries","Potraviny"],dining:["Eating out & cafés","Restaurace a kavárny"],
    transport:["Transport","Doprava"],phone:["Phone & internet","Telefon a internet"],health:["Health & pharmacy","Zdraví a lékárna"],household:["Household","Domácnost"],
    misc:["Clothing & shopping","Oblečení a nákupy"],hobbies:["Hobbies & sport","Koníčky a sport"],kids:["Children","Děti"],insurance:["Insurance","Pojištění"],
    subscriptions:["Subscriptions","Předplatné"],travel:["Travel & holidays","Cestování a dovolená"],other:["Other","Ostatní výdaje"]},
  saving:{emergency:["Emergency savings","Finanční rezerva"],investing:["Investing","Investice"],goal:["Saving for goals","Spoření na cíle"]},
  income:{salary:["Salary","Mzda"],maintenance:["Child maintenance","Výživné"],benefits:["Benefits & allowances","Dávky a příspěvky"],rental:["Rental income","Příjem z pronájmu"],
    interest:["Interest","Úroky"],transfer:["Transfers in","Převody z jiných účtů"],other:["Other income","Ostatní příjmy"]}};
const defName=(kind,ty,lang)=>((DEF_NAMES[ty]||{})[kind]||[kind,kind])[(lang||LANG)==="cs"?1:0];
const LEGACY={expense:[["Rent","rent"],["Groceries","groceries"],["Eating out & cafés","dining"],["Gas & electricity","utilities"],["Travel","travel"],["Clothing & misc","misc"],["Household & cleaning","household"],["Gym & hobbies","hobbies"],["Health & pharmacy","health"],["Public transport","transport"],["Phone","phone"]],
  saving:[["Emergency savings","emergency"],["Investing","investing"]],income:[["Salary","salary"],["Rental income","rental"],["Transfer from Australia","transfer"],["Interest","interest"],["Other income","other"]]};
let EXP_CATS=LEGACY.expense.map(x=>x[0]),SAVE_CATS=LEGACY.saving.map(x=>x[0]),INC_CATS=LEGACY.income.map(x=>x[0]);
function catList(ty){const c=((docs.settings||{}).cats||{})[ty];return Array.isArray(c)&&c.length?c:LEGACY[ty].map(([n,k])=>({n,k}))}
function applyCats(){EXP_CATS=catList("expense").map(c=>c.n);SAVE_CATS=catList("saving").map(c=>c.n);INC_CATS=catList("income").map(c=>c.n)}
const catsOf=ty=>ty==="expense"?EXP_CATS:ty==="saving"?SAVE_CATS:INC_CATS;
function kindOf(name,ty){const types=ty?[ty]:["expense","saving","income"];for(const x of types){const c=catList(x).find(c=>c.n===name);if(c)return c.k}return "other"}
function catOfKind(kind,ty){const l=catList(ty);const c=l.find(c=>c.k===kind);if(c)return c.n;
  if(ty==="expense")return (l.find(c=>c.k==="other")||l.find(c=>c.k==="misc")||l[l.length-1]||{n:"Other"}).n;
  if(ty==="income")return (l.find(c=>c.k==="other")||l[l.length-1]||{n:"Other income"}).n;return (l[0]||{n:"Savings"}).n}
const typeOfCat=c=>EXP_CATS.includes(c)?"expense":SAVE_CATS.includes(c)?"saving":INC_CATS.includes(c)?"income":"expense";
const isTransferCat=c=>INC_CATS.includes(c)&&kindOf(c,"income")==="transfer";

/* ---------- settings ---------- */
const ALL_MIGRATIONS=["v3-oneoff","v3-invest","v3-rates","v3-bills","v3-goals","v3-history","v6-recurring","v8-salarywords","v9-general"];
function newSettings(){return {onboarded:false,lang:LANG,currency:"CZK",currency2:"",rates:{},autoRates:true,cats:{expense:[],saving:[],income:[]},budget:{},targets:{},
  ownAccounts:[],rules:{},salaryWords:[],autoLock:1,period:{type:"calendar",day:1},importPref:{method:"csv"},features:{},theme:"system",backupEvery:30,migrations:[...ALL_MIGRATIONS]}}
const ensureSettings=()=>docs.settings||(docs.settings=newSettings());
function settings(){
  const s=docs.settings||{};const budget={},targets={};
  EXP_CATS.forEach(c=>budget[c]=Number((s.budget||{})[c])||0);SAVE_CATS.forEach(c=>targets[c]=Number((s.targets||{})[c])||0);
  const inv=s.invest||{short:0,long:0};
  return {budget,targets,invest:{short:Number(inv.short)||0,long:Number(inv.long)||0}};
}
const childCfg=()=>{const c=((docs.settings||{}).features||{}).child;return c&&c.on?c:null};

/* ---------- entries and totals ---------- */
const items=k=>((docs[k]||{}).items||[]).filter(i=>i&&typeof i==="object");
const monthKeys=()=>Object.keys(docs).filter(k=>/^m-\d{4}-\d{2}$/.test(k)).sort();
function allItems(){const out=[];monthKeys().forEach(k=>items(k).forEach(i=>out.push({k,i})));return out}
function allIds(){return new Set(allItems().map(x=>x.i.id))}
function partsOf(i){return i.type==="expense"&&Array.isArray(i.parts)&&i.parts.length?i.parts:[{cat:i.cat,czk:Number(i.czk)||0}]}
function totalsList(list){
  const tt={expense:0,oneoff:0,saving:0,income:0,fromIn:0,byCat:{}};
  list.forEach(i=>{const v=Number(i.czk)||0;
    if(i.type==="expense"){if(i.oneoff){tt.oneoff+=v;return}tt.expense+=v;partsOf(i).forEach(p=>tt.byCat["expense:"+p.cat]=(tt.byCat["expense:"+p.cat]||0)+(Number(p.czk)||0))}
    else if(i.type==="income"){if(i.childRepay)return;if(isTransferCat(i.cat))tt.fromIn+=v;else tt.income+=v;tt.byCat["income:"+i.cat]=(tt.byCat["income:"+i.cat]||0)+v}
    else{tt.saving+=v;tt.byCat["saving:"+i.cat]=(tt.byCat["saving:"+i.cat]||0)+v}});
  return tt;
}
const totals=k=>totalsList(items(k));
const budgetTotal=s=>EXP_CATS.reduce((a,c)=>a+s.budget[c],0);
const targetTotal=s=>SAVE_CATS.reduce((a,c)=>a+s.targets[c],0);

/* ---------- budget periods: calendar month, or payday to payday ---------- */
function payDay(){const p=(docs.settings||{}).period||{};return p.type==="payday"?clamp(+p.day||1,1,31):1}
function periodStart(y,m){const dim=new Date(y,m+1,0).getDate();return new Date(y,m,Math.min(payDay(),dim))}
function period(y,m){const s=periodStart(y,m);const n=new Date(y,m+1,1);const e=periodStart(n.getFullYear(),n.getMonth());e.setDate(e.getDate()-1);
  return {y,m,start:s,end:e,s:iso(s),e:iso(e),days:Math.round((e-s)/DAY)+1,cal:payDay()===1}}
function periodOfDate(d){let y=d.getFullYear(),m=d.getMonth();const day=new Date(y,m,d.getDate());if(day<periodStart(y,m)){m--;if(m<0){m=11;y--}}return {y,m}}
const curP=()=>period(cur.y,cur.m);
function shiftP(p,n){const d=new Date(p.y,p.m+n,1);return period(d.getFullYear(),d.getMonth())}
function pItemsK(p){const out=[];[...new Set([p.s.slice(0,7),p.e.slice(0,7)])].forEach(km=>items("m-"+km).forEach(i=>{if(i.date>=p.s&&i.date<=p.e)out.push({k:"m-"+km,i})}));return out}
const pItems=p=>pItemsK(p).map(x=>x.i);
const totalsP=p=>totalsList(pItems(p));
const isCurP=p=>{const tI=todayIso();return tI>=p.s&&tI<=p.e};
const isFutureP=p=>p.s>todayIso();
const isPastP=p=>p.e<todayIso();
function pLabel(p,shortForm){if(p.cal)return mName(p.y,p.m,shortForm);if(shortForm)return dShort(p.s);return dShort(p.s)+" – "+dShort(p.e)}
const dayIdx=(p,dIso)=>Math.round((dOf(dIso)-p.start)/DAY)+1;

/* ---------- one-time upgrades of your data ---------- */
async function migrate(){
  if(!docs.settings)return;const st=docs.settings;st.migrations=st.migrations||[];const done=new Set(st.migrations);let changed=false;
  const run=(id,fn)=>{if(!done.has(id)){fn();st.migrations.push(id);changed=true}};
  // Generic upgrades only: personal defaults come from a private setup file, never from this public code.
  run("v3-oneoff",()=>{});
  run("v3-invest",()=>{if(!st.invest)st.invest={short:0,long:Number((st.targets||{}).Investing)||0,seeded:true}});
  run("v3-rates",()=>{if(st.autoRates===undefined)st.autoRates=true});
  run("v3-bills",()=>{});
  run("v3-goals",()=>{if(!docs.goals){const bt=Object.values(st.budget||{}).reduce((a,b)=>a+(+b||0),0);docs.goals={list:[{id:uid("g"),name:"Emergency fund",target:bt*3,date:"",start:0,src:"cat:Emergency savings",created:todayIso(),seeded:true}]}}});
  run("v3-history",()=>{snapshotNet()});
  run("v6-recurring",()=>{if(docs.recurring)return;const td0=todayIso();
    const list=((docs.bills||{}).list||[]).filter(b=>b&&b.name).map(b=>({id:b.id||uid("r"),name:b.name,cat:b.cat,amount:+b.amount||0,cur:"CZK",freq:"monthly",day:+b.day||1,wd:0,time:"09:00",start:td0,auto:true,remind:true,before:1,match:b.match||"",seeded:true}));
    docs.recurring={list}});
  run("v8-salarywords",()=>{if(st.salaryWords)return;const w=[];((docs.recurring||{}).list||[]).filter(r=>r.cat==="Salary").forEach(r=>String(r.match||"").split(/[,|]/).forEach(x=>{x=x.trim().toLowerCase();if(x&&!w.includes(x))w.push(x)}));st.salaryWords=w});
  run("v9-general",()=>{
    if(st.onboarded===undefined)st.onboarded=true;
    st.lang=st.lang||"en";st.currency=st.currency||"CZK";
    if(st.currency2===undefined)st.currency2=st.rates&&st.rates.AUD?"AUD":"";
    if(!st.cats||!st.cats.expense||!st.cats.expense.length){
      const mk=ty=>{const l=LEGACY[ty].map(([n,k])=>({n,k}));const seen=new Set(l.map(c=>c.n));
        const extra=[...Object.keys(ty==="expense"?st.budget||{}:ty==="saving"?st.targets||{}:{}),...allItems().filter(x=>x.i.type===ty).map(x=>x.i.cat)];
        extra.forEach(n=>{if(n&&!seen.has(n)){seen.add(n);l.push({n,k:"other"})}});return l};
      st.cats={expense:mk("expense"),saving:mk("saving"),income:mk("income")};
    }
    st.period=st.period||{type:"calendar",day:1};st.importPref=st.importPref||{method:"raiffeisen"};st.features=st.features||{};
    if(st.invest&&(st.invest.short||st.invest.long)&&st.features.investSplit===undefined)st.features.investSplit=true;
    st.theme=st.theme||"system";st.backupEvery=st.backupEvery||30;
  });
  if(changed)await persist();
}

/* ---------- exchange rates (European Central Bank reference, via frankfurter) ---------- */
async function updateRates(force){
  const st=docs.settings;if(!st||!key)return;if(!force&&(!st.autoRates||(st.ratesFetched&&Date.now()-st.ratesFetched<12*3600e3)))return;
  const need=[...new Set([baseCur(),...curOptions(),...((docs.accounts||{}).list||[]).map(a=>a.cur)])].filter(c=>c&&CURRENCIES.includes(c));
  const syms=need.filter(c=>c!=="EUR");if(!syms.length&&baseCur()==="EUR")return;
  const urls=["https://api.frankfurter.dev/v1/latest?base=EUR&symbols="+syms.join(","),"https://api.frankfurter.app/latest?from=EUR&to="+syms.join(",")];
  for(const u of urls){try{const r=await fetch(u,{cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"});if(!r.ok)continue;const j=await r.json();const R={EUR:1,...(j.rates||{})};const b=R[baseCur()];if(!(b>0))continue;
    if(!key)return;const rates={...(st.rates||{})};need.forEach(c=>{if(c!==baseCur()&&R[c]>0)rates[c]=Number((b/R[c]).toPrecision(6))});
    st.rates=rates;st.ratesDate=j.date;st.ratesFetched=Date.now();if(force)st.autoRates=true;await persist();render();if(force)toast(t("Exchange rates updated."));return}catch(_){}}
  if(force)toast(t("Couldn't reach the rates service. Your current rates stay in use."));
}

/* ---------- tabs ---------- */
function showTab(name){
  if(name==="kids"&&!childCfg())name="health";
  document.querySelectorAll(".tab").forEach(x=>x.hidden=x.id!=="tab-"+name);
  document.querySelectorAll(".tabbar button").forEach(b=>{if(b.dataset.tab===name)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  if(name==="health"&&key){hCurve=0;const rg=$("hDial").querySelector(".ring");if(rg){rg.style.transition="none";rg.setAttribute("stroke-dashoffset",rg.getAttribute("stroke-dasharray"));rg.getBoundingClientRect();rg.style.transition=""}requestAnimationFrame(renderHealth)}
  scrollTo(0,0);requestAnimationFrame(renderCharts);
}
document.querySelectorAll(".tabbar button").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));
const NS="http://www.w3.org/2000/svg";
function svgEl(W,H,label){const s=document.createElementNS(NS,"svg");s.setAttribute("viewBox","0 0 "+W+" "+H);s.setAttribute("width","100%");s.setAttribute("role","img");s.setAttribute("aria-label",label);
  s.add=(tag,attrs,text)=>{const e=document.createElementNS(NS,tag);for(const a in attrs)e.setAttribute(a,attrs[a]);if(text!=null)e.textContent=text;s.appendChild(e);return e};return s}
const boxW=box=>Math.max(280,box.clientWidth||Math.min(688,document.documentElement.clientWidth-64));
function niceTick(max){const step=Math.pow(10,Math.floor(Math.log10(Math.max(1,max)/4)));return [1,2,2.5,5,10].map(x=>x*step).find(x=>max/x<=5)||step*10}
function axisY(svg,max,min,y,pl,W,pr){const tick=niceTick(conv(max-(min||0)));for(let v=Math.ceil(conv(min||0)/tick)*tick;v<=conv(max)+1e-9;v+=tick){const yy=y(dispAlt()?v*rateOf(docs.settings.dispCur):v);
  svg.add("line",{x1:pl,x2:W-pr,y1:yy,y2:yy,stroke:"var(--line)"});svg.add("text",{x:pl-6,y:yy+4,"text-anchor":"end",class:"amt"},v>=1000?(Math.round(v/100)/10)+"k":String(Math.round(v)))}}
function chartTip(box,svg,W,pl,pr,n,text){
  const tip=el("div","tip amt");tip.hidden=true;box.replaceChildren(svg,tip);
  const show=e=>{const r=box.getBoundingClientRect();const xs=(e.clientX-r.left)/r.width*W;const ix=clamp(Math.floor((xs-pl)/((W-pl-pr)/n)),0,n-1);
    const tx=text(ix);if(!tx){tip.hidden=true;return}tip.textContent=tx;tip.hidden=false;const xx=e.clientX-r.left-tip.offsetWidth/2;tip.style.left=clamp(xx,0,r.width-tip.offsetWidth)+"px";tip.style.top="0px"};
  svg.addEventListener("pointerdown",show);svg.addEventListener("pointermove",show);svg.addEventListener("pointerleave",()=>tip.hidden=true);
}

/* ---------- render ---------- */
function render(){
  if(!key||!docs.settings||!docs.settings.onboarded)return;
  const p=curP();$("monthLabel").textContent=pLabel(p);
  const cb=$("curBtn");cb.hidden=!cur2()||cur2()===baseCur();cb.textContent=SYM[dispCode()]||dispCode();cb.setAttribute("aria-label",t("Switch currency"));
  $("tabKids").hidden=!childCfg();if(childCfg())$("tabKids").textContent=childCfg().child||t("Child");
  const s=settings(),tt=totalsP(p),bt=budgetTotal(s),tg=targetTotal(s);
  $("kSpent").textContent=fmt(tt.expense);$("kSpentOf").textContent=t("of {x}",{x:fmt(bt)});
  const pct=bt?tt.expense/bt:0,pill=$("kSpentPill");pill.className="pill "+(pct>1?"bad":pct>.85?"warn":"ok");pill.textContent=bt?Math.round(pct*100)+"%":t("no budget");
  const left=bt-tt.expense;$("kLeft").textContent=fmt(left);
  const hc=healthCalc(p);
  if(hc.mode==="current")$("kLeftSub").textContent=hc.left>=0?t("≈ {x} a day after bills, {n} {d} left",{x:fmt(hc.perDay),n:hc.daysLeft,d:pl(hc.daysLeft,"day")}):t("bills still to come exceed it");
  else $("kLeftSub").textContent=left<0?t("over budget"):t("at the end of the period");
  $("kSaved").textContent=fmt(tt.saving);$("kSavedOf").textContent=t("of {x} target",{x:fmt(tg)});
  $("kIncome").textContent=fmt(tt.income);$("kIncomeSub").textContent=tt.fromIn?t("+ {x} transferred in",{x:fmt(tt.fromIn)}):t("earned this period");
  const os=$("oneoffStrip");os.hidden=!tt.oneoff;if(tt.oneoff){os.replaceChildren(el("span","",t("One-off costs, kept out of the budget")),el("b","amt",fmt(tt.oneoff)));os.onclick=()=>filterTo("__oneoff")}
  setSyncUI();renderHealth();renderBars(tt,s);renderBills();renderBanners();renderRecap();renderMerchants();renderEntries();renderGoals();renderInvest();renderAccounts();renderAU();renderBio();renderKids();
  if(!$("tab-settings").dataset.dirty)fillSettings();renderRecList();
  renderCharts();
}
function renderCharts(){if(!key||!docs.settings||!docs.settings.onboarded)return;renderPace();renderDonut();renderHeat();renderTrend();renderInvChart();renderNet();renderAUChart();renderKidChart()}
function renderBars(tt,s){
  const box=$("bars");box.replaceChildren();
  EXP_CATS.forEach(c=>{const spent=tt.byCat["expense:"+c]||0,b=s.budget[c];if(!b&&!spent)return;const p2=b?spent/b:(spent?1.01:0);
    const bar=el("button","bar");bar.type="button";bar.setAttribute("aria-label",t("{c}: {a} of {b}. Show entries",{c,a:fmt(spent),b:fmt(b)}));
    const top=el("div","bar-top");top.append(el("span","",c),el("span","v amt",fmt(spent)+" / "+fmt(b)));
    const tr=el("div","track"),f=el("div","fill "+(p2>1?"bad":p2>.85?"warn":""));f.style.width=Math.min(100,p2*100).toFixed(1)+"%";tr.appendChild(f);bar.append(top,tr);
    bar.addEventListener("click",()=>filterTo(c));box.appendChild(bar)});
  if(!box.children.length)box.appendChild(el("p","empty",t("Set budgets for your categories in Settings.")));
}
function renderPace(){
  const box=$("pace");const p=curP();const s=settings(),bt=budgetTotal(s);
  if(!bt){box.replaceChildren(el("div","empty",t("Set a monthly budget in Settings to see your pace.")));$("paceNote").textContent="";return}
  if(isFutureP(p)){box.replaceChildren(el("div","empty",t("This period hasn't started yet.")));$("paceNote").textContent="";return}
  const dim=p.days,curM=isCurP(p),upto=curM?dayIdx(p,todayIso()):dim;
  const bills=monthBills(p);const billSum=bills.reduce((a,b)=>a+b.amount,0);const rest=Math.max(0,bt-billSum)/dim;
  const plan=[0],act=[0];const daily=Array(dim+1).fill(0);
  pItems(p).forEach(i=>{if(i.type==="expense"&&!i.oneoff){const d=dayIdx(p,i.date);if(d>=1&&d<=dim)daily[d]+=+i.czk||0}});
  for(let d=1;d<=dim;d++){plan[d]=plan[d-1]+rest+bills.filter(b=>b.idx===d).reduce((a,b)=>a+b.amount,0);act[d]=act[d-1]+daily[d]}
  const diff=act[upto]-plan[upto];const note=$("paceNote");note.className="pill "+(diff>0?(diff>bt*.05?"bad":"warn"):"ok");note.textContent=(diff>0?t("{x} over plan",{x:fmt(diff)}):t("{x} under plan",{x:fmt(-diff)}))+(curM?" "+t("today"):"");
  const W=boxW(box),H=190,pl2=40,pr=10,pt=10,pb=22;const max=Math.max(plan[dim],act[upto])*1.06||1;
  const x=d=>pl2+(W-pl2-pr)*(d/dim),y=v=>pt+(H-pt-pb)*(1-v/max);const svg=svgEl(W,H,t("Cumulative spending against plan"));axisY(svg,max,0,y,pl2,W,pr);
  const dateAt=d=>{const z=new Date(p.start);z.setDate(z.getDate()+d-1);return z};
  [1,Math.round(dim/4)+1,Math.round(dim/2)+1,Math.round(3*dim/4)+1,dim].forEach(d=>svg.add("text",{x:x(d),y:H-6,"text-anchor":"middle"},String(dateAt(d).getDate())));
  let pp="M"+x(0)+" "+y(0);for(let d=1;d<=dim;d++)pp+=" L"+x(d)+" "+y(plan[d]);svg.add("path",{d:pp,fill:"none",stroke:"var(--muted)","stroke-width":1.5,"stroke-dasharray":"5 4"});
  let ap="M"+x(0)+" "+y(0);for(let d=1;d<=upto;d++)ap+=" L"+x(d)+" "+y(act[d]);
  svg.add("path",{d:ap+" L"+x(upto)+" "+y(0)+" Z",fill:"var(--accent)",opacity:.12});svg.add("path",{d:ap,fill:"none",stroke:"var(--accent)","stroke-width":2.5,"stroke-linejoin":"round"});
  svg.add("circle",{cx:x(upto),cy:y(act[upto]),r:4.5,fill:"var(--accent)",stroke:"var(--panel)","stroke-width":2});
  chartTip(box,svg,W,pl2,pr,dim,ix=>{const d=ix+1;return dShort(iso(dateAt(d)))+" · "+(d<=upto?t("spent")+" "+fmt(act[d])+" · ":"")+t("plan")+" "+fmt(plan[d])});
}
function renderBills(){
  const ul=$("bills");ul.replaceChildren();const st=billStatus(curP());
  if(!st.length){ul.appendChild(el("li","empty",t("Nothing scheduled. Add salary, transfers and bills in Settings.")));return}
  st.forEach(s=>{const li=el("li");const l=el("div");
    l.append(el("div","bn",s.r.name),el("div","bs",(s.ty==="income"?t("Income")+" · ":s.ty==="saving"?t("Saving")+" · ":"")+s.r.cat+" · "+dDay(s.dIso)+(s.r.time?" "+s.r.time:"")+(s.r.auto?" · "+t("auto"):"")));
    const r=el("div","bcol");r.append(el("span","ba amt",(s.ty==="income"?"+":"")+fmt(s.hit?s.hit.czk:recCzk(s.r))),el("span","st "+s.st,s.label));li.append(l,r);ul.appendChild(li)});
}
$("billsEdit").addEventListener("click",()=>{showTab("settings");setTimeout(()=>{const d=$("secRecurring");d.open=true;d.scrollIntoView({behavior:"smooth"})},50)});
function renderBanners(){
  const box=$("banners");box.replaceChildren();
  const st=billStatus(period(periodOfDate(new Date()).y,periodOfDate(new Date()).m));
  const late=st.filter(s=>s.st==="late"),soon=st.filter(s=>s.st==="soon"&&s.dueSoon);
  if(late.length){const b=el("div","banner bad");b.append(el("span","",late.length===1?t("{n} looks {l}.",{n:late[0].r.name,l:late[0].label.toLowerCase()}):t("{n} items look late: {l}.",{n:late.length,l:late.map(s=>s.r.name).join(", ")})));box.appendChild(b)}
  soon.forEach(s=>{const b=el("div","banner warn");b.append(el("span","",s.r.name+": "+s.label.toLowerCase()+" · "+fmt(recCzk(s.r))+(s.r.auto?". "+t("It will be added automatically."):".")));box.appendChild(b)});
  const lb=(docs.settings||{}).lastBackup;const every=+(docs.settings||{}).backupEvery||0;const n=allItems().length;
  if(every&&n&&(!lb||Date.now()-lb>every*DAY)){const b=el("div","banner warn");const tx=el("span");
    tx.append(el("b","",lb?t("Last backup {n} days ago.",{n:Math.floor((Date.now()-lb)/DAY)}):t("No backup yet.")),document.createTextNode(" "+t("Your data only lives on this device.")));
    const btn=el("button","icon-btn",t("Back up"));btn.addEventListener("click",doBackup);b.append(tx,btn);box.appendChild(b)}
}
function recapFor(p){
  const s=settings(),tt=totalsP(p),bt=budgetTotal(s),tg=targetTotal(s),pp=shiftP(p,-1),pt=totalsP(pp);
  const lines=[];lines.push(t("Spent {a} of {b}",{a:fmt(tt.expense),b:fmt(bt)})+(bt?" ("+Math.round(tt.expense/bt*100)+" %)":"")+".");
  if(tg)lines.push(t("Saved and invested {a} of the {b} target.",{a:fmt(tt.saving),b:fmt(tg)}));
  const diffs=EXP_CATS.map(c=>({c,d:(tt.byCat["expense:"+c]||0)-s.budget[c]})).filter(x=>s.budget[x.c]||x.d>0);
  const over=diffs.filter(x=>x.d>0).sort((a,b)=>b.d-a.d).slice(0,2),under=diffs.filter(x=>x.d<0).sort((a,b)=>a.d-b.d).slice(0,2);
  if(over.length)lines.push(t("Over budget: {l}.",{l:over.map(x=>t("{c} by {x}",{c:x.c,x:fmt(x.d)})).join(", ")}));
  if(under.length)lines.push(t("Under budget: {l}.",{l:under.map(x=>t("{c} by {x}",{c:x.c,x:fmt(-x.d)})).join(", ")}));
  if(pt.expense)lines.push(t(tt.expense>=pt.expense?"Spending up {n} % on the period before.":"Spending down {n} % on the period before.",{n:Math.abs(Math.round((tt.expense/pt.expense-1)*100))}));
  if(tt.oneoff)lines.push(t("One-off costs: {x}.",{x:fmt(tt.oneoff)}));
  return lines;
}
function renderRecap(){
  const box=$("recap");box.replaceChildren();const p=curP();let rp=null,dismiss=false;
  if(isPastP(p)&&pItems(p).length)rp=p;
  else if(isCurP(p)&&dayIdx(p,todayIso())<=7){const pp=shiftP(p,-1);if(pItems(pp).length&&(docs.settings||{}).recapSeen!==pp.s){rp=pp;dismiss=true}}
  if(!rp)return;const c=el("div","recap");const head=el("div","rhead");head.appendChild(el("h2","",t("{p} in review",{p:pLabel(rp)})));
  if(dismiss){const x=el("button","link",t("Dismiss"));x.addEventListener("click",()=>{ensureSettings().recapSeen=rp.s;persist().then(render)});head.appendChild(x)}
  const ul=el("ul");recapFor(rp).forEach(l=>ul.appendChild(el("li","amt",l)));c.append(head,ul);box.appendChild(c);
}
const COLORS=["var(--c1)","var(--c2)","var(--c3)","var(--c4)","var(--c5)","var(--c6)","var(--c7)","var(--c8)"];
function renderDonut(){
  const box=$("donut"),lg=$("donutLegend");const tt=totalsP(curP());
  const cats=EXP_CATS.map(c=>({c,v:tt.byCat["expense:"+c]||0})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
  lg.replaceChildren();if(!cats.length){box.replaceChildren();lg.appendChild(el("li","empty",t("No spending yet this period.")));return}
  const tot=cats.reduce((a,x)=>a+x.v,0);const S=150,R=70,r=46,cx=75,cy=75;const svg=svgEl(S,S,t("Spending by category"));let a0=-Math.PI/2;
  cats.forEach((x,ix)=>{const a1=a0+x.v/tot*Math.PI*2;const large=a1-a0>Math.PI?1:0;const pt=(a,rr)=>[cx+rr*Math.cos(a),cy+rr*Math.sin(a)];
    const [x0,y0]=pt(a0,R),[x1,y1]=pt(a1-1e-4,R),[x2,y2]=pt(a1-1e-4,r),[x3,y3]=pt(a0,r);
    const path=svg.add("path",{d:"M"+x0+" "+y0+" A"+R+" "+R+" 0 "+large+" 1 "+x1+" "+y1+" L"+x2+" "+y2+" A"+r+" "+r+" 0 "+large+" 0 "+x3+" "+y3+" Z",fill:COLORS[ix%8],stroke:"var(--panel)","stroke-width":1.5});
    path.style.cursor="pointer";path.addEventListener("click",()=>filterTo(x.c));a0=a1;
    const li=el("li");const b=el("button");b.type="button";const sw=el("i");sw.style.background=COLORS[ix%8];b.append(sw,el("span","",x.c),el("span","p amt",fmt(x.v)+" · "+Math.round(x.v/tot*100)+" %"));b.addEventListener("click",()=>filterTo(x.c));li.appendChild(b);lg.appendChild(li)});
  svg.add("text",{x:cx,y:cy-2,"text-anchor":"middle",class:"lab amt"},short(tot));svg.add("text",{x:cx,y:cy+14,"text-anchor":"middle"},SYM[dispCode()]||dispCode());
  box.replaceChildren(svg);
}
let selDay=null;
function renderHeat(){
  const box=$("heat");box.replaceChildren();const p=curP();
  WD_SHORT().forEach(d=>box.appendChild(el("div","dow",d)));
  const daily={};pItems(p).forEach(i=>{if(i.type==="expense"&&!i.oneoff)daily[i.date]=(daily[i.date]||0)+(+i.czk||0)});
  const max=Math.max(1,...Object.values(daily));const lead=(p.start.getDay()+6)%7;for(let i=0;i<lead;i++)box.appendChild(el("span"));
  const tI=todayIso();
  for(let d=0;d<p.days;d++){const z=new Date(p.start);z.setDate(z.getDate()+d);const ds=iso(z);const v=daily[ds]||0;const lvl=v?clamp(Math.ceil(Math.sqrt(v/max)*4),1,4):0;
    const b=el("button","l"+lvl,String(z.getDate()));b.type="button";if(v)b.style.background="color-mix(in srgb, var(--accent) "+[0,22,45,70,95][lvl]+"%, var(--track))";
    if(ds===tI)b.classList.add("today");b.setAttribute("aria-pressed",String(selDay===ds));b.setAttribute("aria-label",dShort(ds)+": "+fmt(v));
    b.addEventListener("click",()=>{selDay=selDay===ds?null:ds;renderHeat()});box.appendChild(b)}
  const dl=$("dayList");dl.replaceChildren();if(selDay&&selDay>=p.s&&selDay<=p.e){const list=pItemsK(p).filter(x=>x.i.date===selDay);
    dl.appendChild(el("h3","",dOf(selDay).toLocaleDateString(LOC(),{weekday:"long",day:"numeric",month:"long"})));
    if(!list.length)dl.appendChild(el("p","small muted",t("Nothing logged.")));const ul=el("ul","ledger");list.forEach(x=>ul.appendChild(entryRow(x.k,x.i,false)));dl.appendChild(ul)}
}
function merchantKey(i){return (i.key||rbKey(i.note||"",""))||(i.note||"").toLowerCase()}
function renderMerchants(){
  const ol=$("merchants");ol.replaceChildren();const p=curP();const g={};
  [0,1,2].forEach(n=>pItems(shiftP(p,-n)).forEach(i=>{if(i.type!=="expense")return;const mk=merchantKey(i);if(!mk)return;const e=g[mk]||(g[mk]={name:i.note||i.cat,n:0,v:0,last:""});e.n++;e.v+=+i.czk||0;if(i.date>e.last){e.last=i.date;e.name=i.note||i.cat}}));
  const top=Object.values(g).sort((a,b)=>b.v-a.v).slice(0,8);if(!top.length){ol.appendChild(el("li","empty",t("Nothing yet.")));return}
  const mx=top[0].v;top.forEach(m=>{const li=el("li");li.append(el("span","mn",m.name),el("span","mt amt",fmt(m.v)),el("span","mc",m.n+" "+pl(m.n,"payment")));
    const bar=el("span","mbar");const f=el("i");f.style.width=(m.v/mx*100).toFixed(1)+"%";bar.appendChild(f);li.appendChild(bar);ol.appendChild(li)});
}
function last6(){const p=curP();const out=[];for(let i=5;i>=0;i--){const q=shiftP(p,-i);out.push({p:q,lab:pLabel(q,true)})}return out}
function renderTrend(){
  const box=$("trend");const s=settings(),bt=budgetTotal(s);const ms=last6().map(x=>{const tt=totalsP(x.p);return {lab:x.lab,sp:tt.expense,one:tt.oneoff,sv:tt.saving}});
  if(!ms.some(m=>m.sp||m.sv||m.one)){box.replaceChildren(el("div","empty",t("The chart fills in as you add entries.")));return}
  const W=boxW(box),H=200,pl2=40,pr=6,pt=10,pb=24;const max=Math.max(bt,...ms.map(m=>Math.max(m.sp+m.one,m.sv)))*1.08||1;
  const y=v=>pt+(H-pt-pb)*(1-v/max),gw=(W-pl2-pr)/6,bw=Math.min(20,gw*.3);const svg=svgEl(W,H,t("Spending and saving over six periods"));axisY(svg,max,0,y,pl2,W,pr);
  ms.forEach((m,i)=>{const cx=pl2+gw*i+gw/2;
    svg.add("rect",{x:cx-bw-2,y:y(m.sp),width:bw,height:Math.max(0,H-pb-y(m.sp)),rx:2,fill:"var(--accent)"});
    if(m.one)svg.add("rect",{x:cx-bw-2,y:y(m.sp+m.one),width:bw,height:Math.max(0,y(m.sp)-y(m.sp+m.one)),rx:2,fill:"var(--one)"});
    svg.add("rect",{x:cx+2,y:y(m.sv),width:bw,height:Math.max(0,H-pb-y(m.sv)),rx:2,fill:"var(--ok)"});
    svg.add("text",{x:cx,y:H-7,"text-anchor":"middle",class:i===5?"now":""},m.lab)});
  if(bt)svg.add("line",{x1:pl2,x2:W-pr,y1:y(bt),y2:y(bt),stroke:"var(--muted)","stroke-width":1.5,"stroke-dasharray":"5 4"});
  chartTip(box,svg,W,pl2,pr,6,ix=>{const m=ms[ix];return m.lab+" · "+t("spent")+" "+fmt(m.sp)+(m.one?" + "+fmt(m.one)+" "+t("one-off"):"")+" · "+t("saved")+" "+fmt(m.sv)});
}

/* ---------- health: is this period's spending on track? ---------- */
function healthCalc(p){
  const s=settings(),B=budgetTotal(s),tt=totalsP(p),S=tt.expense,dim=p.days;
  const curM=isCurP(p),future=isFutureP(p);
  const bills=monthBills(p);const planned=bills.reduce((a,b)=>a+b.amount,0);
  const upcoming=curM?bills.filter(b=>!b.x.hit):[];const U=upcoming.reduce((a,b)=>a+b.amount,0);
  const paid=bills.filter(b=>b.x.hit).reduce((a,b)=>a+(+b.x.hit.czk||0),0);
  const tI=todayIso();const today=curM?dayIdx(p,tI):dim,daysLeft=curM?dim-today+1:0;
  const normal=Math.max(0,B-planned)/dim;
  let plan=0;for(let d=1;d<=today;d++)plan+=normal+bills.filter(b=>b.idx===d).reduce((a,b)=>a+b.amount,0);
  const spentToday=curM?pItems(p).filter(i=>i.type==="expense"&&!i.oneoff&&i.date===tI).reduce((a,i)=>a+(+i.czk||0),0):0;
  const o={B,S,U,upcoming,planned,paid,dim,today,daysLeft,normal,plan,spentToday,oneoff:tt.oneoff,mode:!B?"nobudget":future?"future":curM?"current":"past"};
  if(o.mode==="current"){o.left=B-S-U;o.perDay=o.left/daysLeft;o.r=o.left<0?0:(normal>0?o.perDay/normal:1);
    const everyday=Math.max(0,S-paid),rate=everyday/Math.max(1,today);o.rate=rate;o.projected=S+rate*(dim-today)+U;o.forecastOk=today>=3}
  else if(o.mode==="past"){o.left=B-S;o.r=S<=B?1.15:Math.max(0,1-(S-B)/B*3)}else o.r=null;
  return o;
}
const healthMix=r=>r==null?null:Math.round(clamp((r-.7)/.3,0,1)*100);
const healthCurve=r=>r==null?0:clamp((r-.85)/.15,-1,1);
let hCurve=0,hAnim=null;
function drawDial(fracUsed,fracExpected,curve,neutral){
  const box=$("hDial");const C=110,R=98,SW=14,circ=2*Math.PI*R;let svg=box.querySelector("svg");
  if(!svg){svg=document.createElementNS(NS,"svg");svg.setAttribute("viewBox","0 0 220 220");svg.setAttribute("role","img");
    const mk=(tag,a)=>{const e=document.createElementNS(NS,tag);for(const k in a)e.setAttribute(k,a[k]);svg.appendChild(e);return e};
    mk("circle",{cx:C,cy:C,r:R,fill:"none","stroke-width":SW,class:"track"});
    mk("circle",{cx:C,cy:C,r:R,fill:"none","stroke-width":SW,class:"ring","stroke-linecap":"round",transform:"rotate(-90 "+C+" "+C+")","stroke-dasharray":circ,"stroke-dashoffset":circ});
    mk("line",{class:"tick","stroke-width":4,"stroke-linecap":"round"});mk("circle",{cx:C,cy:C,r:74,class:"face"});
    mk("ellipse",{cx:86,cy:94,rx:8,ry:10,class:"feat eye"});mk("ellipse",{cx:134,cy:94,rx:8,ry:10,class:"feat eye"});
    mk("path",{class:"feat mouth",fill:"none","stroke-width":9,"stroke-linecap":"round"});box.replaceChildren(svg)}
  const ring=svg.querySelector(".ring"),tick=svg.querySelector(".tick");
  ring.setAttribute("stroke-dashoffset",String(circ*(1-clamp(fracUsed,0,1))));ring.style.opacity=fracUsed>0?1:0;
  if(fracExpected==null)tick.style.display="none";else{tick.style.display="";const a=-Math.PI/2+2*Math.PI*clamp(fracExpected,0,1);const r1=R-SW/2-5,r2=R+SW/2+5;
    tick.setAttribute("x1",C+r1*Math.cos(a));tick.setAttribute("y1",C+r1*Math.sin(a));tick.setAttribute("x2",C+r2*Math.cos(a));tick.setAttribute("y2",C+r2*Math.sin(a))}
  const mouth=svg.querySelector(".mouth");const setMouth=c=>{const y0=140-c*4,dy=c*26;mouth.setAttribute("d","M80 "+y0+" Q110 "+(y0+dy)+" 140 "+y0)};
  svg.setAttribute("aria-label",neutral?t("No health reading for this period"):t("Budget used {a} %",{a:Math.round(fracUsed*100)})+(fracExpected!=null?", "+t("expected {e} % by today",{e:Math.round(fracExpected*100)}):""));
  cancelAnimationFrame(hAnim);const from=hCurve,reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(reduce||Math.abs(from-curve)<.01){setMouth(curve);hCurve=curve;return}
  const t0=performance.now(),dur=650;const step=tm=>{const q=Math.min(1,(tm-t0)/dur),e=1-Math.pow(1-q,3);hCurve=from+(curve-from)*e;setMouth(hCurve);if(q<1)hAnim=requestAnimationFrame(step)};hAnim=requestAnimationFrame(step);
}
function renderHealth(){
  if(!key)return;const p=curP();const o=healthCalc(p);const tab=$("tab-health");const mix=healthMix(o.r);
  const hc=mix==null?"var(--muted)":"color-mix(in oklch, var(--h-good) "+mix+"%, var(--h-off))";tab.style.setProperty("--hc",hc);$("hHero").style.setProperty("--hc",hc);
  const nm=(docs.settings||{}).name;$("hHello").textContent=nm?t("Hi {n}",{n:nm}):"";$("hHello").hidden=!nm;
  const used=o.B?o.S/o.B:0;const curve=o.mode==="current"&&o.left<0?-1:healthCurve(o.r);
  drawDial(used,o.mode==="current"?o.plan/o.B:null,o.r==null?0:curve,o.r==null);$("hKey").hidden=o.mode!=="current";
  const st=$("hStatus"),sub=$("hSub"),lab=$("hAllowLabel"),big=$("hPerDay"),bs=$("hPerDaySub"),cmp=$("hCompare");cmp.replaceChildren();
  const bigSet=(amount,unit)=>{big.replaceChildren(document.createTextNode(amount));if(unit)big.appendChild(el("small",""," "+unit))};
  if(o.mode==="nobudget"){st.textContent=t("No budget yet");sub.textContent=t("Set your monthly spending budget in Settings to see how the month is going.");lab.textContent=t("You can spend");bigSet("—");bs.textContent=""}
  else if(o.mode==="future"){st.textContent=t("Not started");sub.textContent=t("{p} hasn't begun yet.",{p:pLabel(p)});lab.textContent=t("Budget for the period");bigSet(fmt(o.B));bs.textContent=o.planned?t("{x} of it is for bills.",{x:fmt(o.planned)}):""}
  else if(o.mode==="past"){
    st.textContent=o.S<=o.B?t("Finished on budget"):o.r>=.85?t("Finished slightly over"):t("Finished over budget");
    sub.textContent=o.S<=o.B?t("You stayed within your budget for {p}.",{p:pLabel(p)}):t("Spending went past your budget for {p}.",{p:pLabel(p)});
    lab.textContent=o.left>=0?t("Left over at the end"):t("Over budget by");bigSet(fmt(Math.abs(o.left)));bs.textContent=t("Spent {a} of {b}.",{a:fmt(o.S),b:fmt(o.B)});
  }else{
    st.textContent=o.left<0?t("Over budget"):o.r>=1?t("On track"):o.r>=.85?t("Slightly behind"):t("Not on track");
    sub.textContent=o.left<0?t("Bills still to come take you past this period's budget."):o.r>=1?t("You've spent less than planned for this point in the period.")
      :o.r>=.85?t("You've spent a little more than planned so far. Easing off for a few days puts you back on track."):t("You're spending faster than your budget allows. Keep to the daily amount below to finish on budget.");
    lab.textContent=o.left<0?t("Everyday spending left"):t("You can spend");
    if(o.left<0){bigSet(fmt(0),t("a day"));bs.textContent=t("Bills still to come put you {x} over budget.",{x:fmt(-o.left)})}
    else{bigSet(fmt(o.perDay),t("a day"));bs.textContent=t("for the {n} {d} left, including today, and still finish on budget.",{n:o.daysLeft,d:pl(o.daysLeft,"day")})}
    if(o.normal>0){cmp.appendChild(el("span","amt",t("Usual allowance {x} a day",{x:fmt(o.normal)})));const d=o.left<0?-o.normal:o.perDay-o.normal;
      cmp.appendChild(el("span","hchip amt",(d>=0?"+":"−")+fmt(Math.abs(d))+" "+(d>=0?t("a day spare"):t("a day short"))))}
    if(o.spentToday)cmp.appendChild(el("span","amt muted","· "+t("spent today {x}",{x:fmt(o.spentToday)})));
  }
  const dl=$("hSum");dl.replaceChildren();const row=(op,label,note,val,tot)=>{const dt=el("dt","",op),dd=el("dd",tot?"tot":"",label);if(note)dd.appendChild(el("span","note",note));dl.append(dt,dd,el("dd","v amt"+(tot?" tot":""),val))};
  const oneNote=o.oneoff?t("Leaves out {x} of one-off costs",{x:fmt(o.oneoff)}):null;
  if(o.mode==="current"){row("",t("Spending budget for the period"),null,fmt(o.B));row("−",t("Spent so far"),oneNote,fmt(o.S));
    row("−",t("Bills still to come"),o.upcoming.length?o.upcoming.map(b=>b.x.r.name+" ("+dDay(b.x.dIso)+")").join(", "):t("None left this period"),fmt(o.U));
    row("=",t("Left for everyday spending"),null,fmt(o.left),true);row("÷",t("Days left, including today"),null,String(o.daysLeft));row("=",t("Each day"),null,o.left<0?fmt(0):fmt(o.perDay),true)}
  else if(o.mode==="past"){row("",t("Spending budget for the period"),null,fmt(o.B));row("−",t("Spent"),oneNote,fmt(o.S));row("=",o.left>=0?t("Left over"):t("Over budget"),null,fmt(Math.abs(o.left)),true)}
  else if(o.mode==="future"){row("",t("Spending budget for the period"),null,fmt(o.B));row("−",t("Bills planned"),null,fmt(o.planned));row("=",t("For everyday spending"),null,fmt(o.B-o.planned),true)}
  const fc=$("hForecast");fc.textContent="";
  if(o.mode==="current"&&o.forecastOk){const diff=o.B-o.projected;fc.textContent=t(diff>=0?"At your pace so far ({r} a day on everyday spending), you'd finish about {x} under budget.":"At your pace so far ({r} a day on everyday spending), you'd finish about {x} over budget.",{r:fmt(o.rate),x:fmt(Math.abs(diff))})}
  const ul=$("hChecks");ul.replaceChildren();const sched=billStatus(p);const tt=totalsP(p);const s=settings();
  const check=(ok,title,detail,tabName)=>{const li=el("li"),b=el("button");b.type="button";b.append(el("span","dot "+(ok==null?"":ok?"ok":"off")),el("span","ct",title),el("span","go","›"),el("span","cd amt",detail));b.addEventListener("click",()=>showTab(tabName));li.appendChild(b);ul.appendChild(li)};
  if(o.mode!=="nobudget"){
    const eb=sched.filter(x=>x.ty==="expense");const tI=todayIso();const late=eb.filter(x=>x.st==="late"&&(dOf(tI)-dOf(x.dIso))/DAY>=3);const dueNow=eb.filter(x=>!x.hit&&x.dIso<=tI&&!late.includes(x));const paidN=eb.filter(x=>x.hit).length;
    if(eb.length)check(!late.length,t("Bills"),late.length?late.map(x=>x.r.name+" "+x.label.toLowerCase()).join(", ")+". "+t("Check it was paid."):t("{a} of {b} paid",{a:paidN,b:eb.length})+(dueNow.length?" · "+t("{l} due now; banks can take a few days to show it.",{l:dueNow.map(x=>x.r.name).join(", ")}):paidN<eb.length?", "+t("the rest not due yet."):"."),"overview");
    const tg=targetTotal(s);if(tg){const upS=sched.filter(x=>x.ty==="saving"&&!x.hit&&o.mode==="current").reduce((a,x)=>a+recCzk(x.r),0);const will=tt.saving+upS;
      check(will>=tg,t("Savings"),t("{a} saved",{a:fmt(tt.saving)})+(upS?" + "+t("{x} scheduled",{x:fmt(upS)}):"")+" "+t("of your {x} target",{x:fmt(tg)})+(will>=tg?".":" · "+t("{x} short.",{x:fmt(tg-will)})),"savings")}
    const inc=sched.filter(x=>x.ty==="income");if(inc.length){const missing=inc.filter(x=>!x.hit&&x.st!=="due"&&x.st!=="soon");
      check(!missing.length,t("Income"),inc.map(x=>x.r.name+": "+(x.hit?t("received {d}",{d:dDay(x.hit.date)}):x.label.toLowerCase())).join(" · "),"entries")}
    const cc=childCfg();if(cc&&cc.balance!==false){const bal=kidBalanceTo(p.e);if(Math.abs(bal)>=1)check(null,cc.name,bal>0?t("{o} owes you {x}",{o:cc.other||t("The other parent"),x:fmt(bal)}):t("You owe {o} {x}",{o:cc.other||t("the other parent"),x:fmt(-bal)}),"kids")}
  }
  if(!ul.children.length)ul.appendChild(el("li","empty",t("Nothing to check yet.")));
}

/* ---------- entries: list, search, filters ---------- */
function fillFilterCats(){const sel=$("fltCat");if(!sel)return;const v=sel.value;sel.replaceChildren();const add=(val,tx)=>{const o=el("option","",tx);o.value=val;sel.appendChild(o)};
  add("",t("All categories"));add("__oneoff",t("One-offs only"));add("__img",t("With images"));if(childCfg())add("__kid",t("For {c}",{c:childCfg().child||t("child")}));
  [[t("Spending"),EXP_CATS],[t("Saving"),SAVE_CATS],[t("Income"),INC_CATS]].forEach(([lab,list])=>{const g=el("optgroup");g.label=lab;list.forEach(c=>{const o=el("option","",c);o.value=c;g.appendChild(o)});sel.appendChild(g)});sel.value=v}
function filterTo(cat){fillFilterCats();$("fltCat").value=cat;$("q").value="";showTab("entries");renderEntries();setTimeout(()=>$("entriesTitle").scrollIntoView({behavior:"smooth",block:"start"}),60)}
["q","fltCat","fltAll"].forEach(id=>$(id).addEventListener(id==="q"?"input":"change",renderEntries));
function entryRow(k,i,showMonth){
  const li=el("li");const d=el("span","d",dDay(i.date||"0000-00-01").replace(".",""));if(showMonth)d.appendChild(el("span","mo",dOf(i.date).toLocaleDateString(LOC(),{month:"short"})));if(i.time)d.appendChild(el("span","tm",i.time));
  const w=el("div");const c=el("div","c",i.type==="expense"&&i.parts&&i.parts.length?t("Split")+" · "+i.parts.map(p=>p.cat).join(", "):(i.cat||t("Uncategorised")));
  if(i.type!=="expense")c.appendChild(el("span","tag "+(i.type==="income"?"in":"sv"),i.type==="income"?t("in"):t("saved")));w.appendChild(c);
  if(i.note)w.appendChild(el("div","n",i.note));
  const bd=el("div","badges");const cc=childCfg();
  if(cc&&i.child)bd.appendChild(el("span","badge kid",(cc.child||t("Child"))+" · "+(100-(+i.child.share||0))+"/"+(+i.child.share||0)));
  if(cc&&i.childRepay)bd.appendChild(el("span","badge kid",t("repayment")));
  if(i.oneoff)bd.appendChild(el("span","badge one",t("one-off")));if((i.att||[]).length)bd.appendChild(el("span","badge",i.att.length>1?i.att.length+" "+pl(i.att.length,"image"):t("image")));
  if(i.src==="shot")bd.appendChild(el("span","badge",t("screenshot")));if(i.src==="auto")bd.appendChild(el("span","badge auto",t("added automatically")));if(i.conflict)bd.appendChild(el("span","badge one",t("edited on two devices")));
  if(bd.childNodes.length)w.appendChild(bd);
  const a=el("div","a amt",(i.type==="income"&&i.czk>0?"+":"")+fmt(i.czk));if(i.orig||(i.cur&&i.cur!==baseCur()))a.appendChild(el("small","",i.orig||fmtCur(i.amount,i.cur)));
  li.append(d,w,a);li.tabIndex=0;li.setAttribute("role","button");li.setAttribute("aria-label",t("Edit {n}, {x}",{n:i.note||i.cat,x:fmt(i.czk)}));
  li.addEventListener("click",()=>openEditor(k,i.id));li.addEventListener("keydown",e=>{if(e.key==="Enter")openEditor(k,i.id)});return li;
}
function renderEntries(){
  const q=$("q").value.trim().toLowerCase(),cat=$("fltCat").value,all=$("fltAll").checked||!!q;const ul=$("ledger");ul.replaceChildren();const p=curP();
  let list=all?allItems():pItemsK(p);
  if(cat==="__oneoff")list=list.filter(x=>x.i.oneoff);else if(cat==="__img")list=list.filter(x=>(x.i.att||[]).length);else if(cat==="__kid")list=list.filter(x=>x.i.child||x.i.childRepay);
  else if(cat)list=list.filter(x=>x.i.cat===cat||partsOf(x.i).some(pp=>pp.cat===cat));
  if(q){const n=parseNum(q);list=list.filter(x=>((x.i.note||"")+" "+(x.i.cat||"")+" "+(x.i.orig||"")).toLowerCase().includes(q)||(!isNaN(n)&&Math.abs((+x.i.czk||0)-n)<1))}
  list.sort((a,b)=>(b.i.date||"").localeCompare(a.i.date||"")||(b.i.time||"").localeCompare(a.i.time||"")||(b.i.ts||0)-(a.i.ts||0));
  const filtered=!!(q||cat);$("entriesTitle").textContent=filtered?t("Results"):t("Entries");
  const sum=list.reduce((a,x)=>a+(x.i.type==="expense"?(+x.i.czk||0):0),0);
  $("entryCount").textContent=list.length?(list.length+" · "+(all?t("all periods"):pLabel(p,true))+(filtered&&sum?" · "+t("{x} spent",{x:fmt(sum)}):"")):"";
  if(!list.length){ul.appendChild(el("li","empty",filtered?t("No entries match."):t("Nothing logged for {p} yet.",{p:pLabel(p)})));return}
  list.slice(0,300).forEach(x=>ul.appendChild(entryRow(x.k,x.i,all)));
}

/* ---------- bottom sheet ---------- */
let sheetUrls=[];
function openSheet(title,body){$("sheetTitle").textContent=title;$("sheetBody").replaceChildren(...body);$("sheet").hidden=false;document.body.style.overflow="hidden";$("sheetBody").scrollTop=0}
function closeSheet(){$("sheet").hidden=true;$("sheetBody").replaceChildren();document.body.style.overflow="";sheetUrls.forEach(u=>URL.revokeObjectURL(u));sheetUrls=[];if(sheetClosed){const f=sheetClosed;sheetClosed=null;f()}}
let sheetClosed=null;
$("sheetClose").addEventListener("click",closeSheet);
$("sheet").addEventListener("click",e=>{if(e.target===$("sheet"))closeSheet()});
function fld(label,input,hint){const f=el("div","field");const l=el("label","label",label);if(!input.id)input.id=uid("f");l.htmlFor=input.id;f.append(l,input);if(hint)f.appendChild(el("span","fine",hint));return f}
function selOf(opts,val){const s=el("select");opts.forEach(o=>{const [v,tx]=Array.isArray(o)?o:[o,o];const op=el("option","",tx);op.value=v;s.appendChild(op)});if(val!=null)s.value=val;return s}
function inp(val,ty,mode){const i=el("input");if(ty)i.type=ty;if(mode)i.inputMode=mode;if(val!=null)i.value=val;return i}
function chk(label,checked){const c=el("input");c.type="checkbox";c.checked=!!checked;c.id=uid("c");const l=el("label","check");l.htmlFor=c.id;l.append(c,document.createTextNode(" "+label));l.input=c;return l}

/* ---------- entry editor ---------- */
function openEditor(k,id){
  const i=items(k).find(x=>x.id===id);if(!i)return;let ty=i.type;const cc=childCfg();
  const seg=el("div","seg");seg.setAttribute("role","group");seg.setAttribute("aria-label",t("Entry type"));const tb={};
  [["expense",t("Spent")],["saving",t("Saved")],["income",t("Income")]].forEach(([v,tx])=>{const b=el("button","",tx);b.type="button";b.setAttribute("aria-pressed",String(v===ty));
    b.addEventListener("click",()=>{ty=v;Object.keys(tb).forEach(x=>tb[x].setAttribute("aria-pressed",String(x===v)));fillCat();partsWrap.hidden=ty!=="expense";oneWrap.hidden=ty!=="expense";if(kidWrap)kidWrap.hidden=ty!=="expense";if(repWrap)repWrap.hidden=ty!=="income"});tb[v]=b;seg.appendChild(b)});
  const amt=inp(String(i.amount).replace(".",","),"","decimal"),curS=selOf(curOptions([i.cur]),i.cur||baseCur()),date=inp(i.date,"date"),note=inp(i.note||"");note.maxLength=80;
  const cat=el("select");const fillCat=()=>{const list=catsOf(ty);const v=cat.value||i.cat;cat.replaceChildren(...list.map(c=>el("option","",c)));cat.value=list.includes(v)?v:list[0]};fillCat();
  const r1=el("div","row2");r1.append(fld(t("Amount"),amt),fld(t("Currency"),curS));const r2=el("div","row2 row2-date");r2.append(fld(t("Note"),note),fld(t("Date"),date));const tm=inp(i.time||"","time");
  const oneWrap=chk(t("One-off (keep out of the monthly budget)"),i.oneoff);oneWrap.hidden=ty!=="expense";const one=oneWrap.input;
  let kidWrap=null,kidOn=null,kidShare=null,repWrap=null;
  if(cc){kidWrap=el("div","sub-sec kidbox");const kc=chk(t("For {c}",{c:cc.child||t("my child")}),!!i.child);kidOn=kc.input;
    kidShare=selOf(Array.from({length:21},(_,n)=>[String(n*5),t("{o} pays {p} %",{o:cc.other||t("The other parent"),p:n*5})]),String(i.child?+i.child.share:+cc.share||50));
    const sf=fld(t("Split"),kidShare);sf.hidden=!kidOn.checked;kidOn.addEventListener("change",()=>sf.hidden=!kidOn.checked);kidWrap.append(kc,sf);kidWrap.hidden=ty!=="expense";
    repWrap=chk(t("Repayment from {o} for {c}",{o:cc.other||t("the other parent"),c:cc.child||t("my child")}),!!i.childRepay);repWrap.hidden=ty!=="income"}
  const partsWrap=el("div","sub-sec");partsWrap.hidden=ty!=="expense";const ph=el("div","panel-head");ph.appendChild(el("b","",t("Split across categories")));const addP=el("button","link",t("+ Add part"));addP.type="button";ph.appendChild(addP);
  const parts=el("div","parts");const leftNote=el("div","left-note");partsWrap.append(ph,parts,leftNote);
  const totalBase=()=>{const a=parseNum(amt.value);const c=curS.value;return c===baseCur()?a:(a===i.amount&&c===i.cur?+i.czk:a*rateOf(c))};
  const upd=()=>{const rows=[...parts.children];if(!rows.length){leftNote.textContent=t("Not split.");leftNote.className="left-note";return}const sum=rows.reduce((a,r)=>a+(r._get().czk||0),0);const left=Math.round((totalBase()-sum)*100)/100;
    leftNote.textContent=Math.abs(left)<1?t("Parts add up."):(left>0?t("{x} still to assign",{x:fmtCur(left,baseCur())}):t("{x} too much",{x:fmtCur(-left,baseCur())}));leftNote.className="left-note "+(Math.abs(left)<1?"ok":"bad")};
  const partRow=pp=>{const r=el("div","part");const c=selOf(EXP_CATS,pp.cat);c.setAttribute("aria-label",t("Part category"));const v=inp(pp.czk!=null&&pp.czk!==""?String(pp.czk).replace(".",","):"","","decimal");v.setAttribute("aria-label",t("Part amount"));v.className="amt";
    const x=el("button","x","×");x.type="button";x.setAttribute("aria-label",t("Remove part"));x.addEventListener("click",()=>{r.remove();upd()});v.addEventListener("input",upd);r.append(c,v,x);r._get=()=>({cat:c.value,czk:parseNum(v.value)});parts.appendChild(r)};
  (i.parts||[]).forEach(partRow);
  addP.addEventListener("click",()=>{if(!parts.children.length)partRow({cat:cat.value,czk:Math.round(totalBase()*100)/100});partRow({cat:EXP_CATS[0],czk:""});upd()});amt.addEventListener("input",upd);upd();
  const imgs=el("div","sub-sec");const ih=el("div","panel-head");ih.appendChild(el("b","",t("Images")));const addI=el("button","link",t("+ Add image"));addI.type="button";addI.addEventListener("click",()=>pickAttach(k,i.id,true));ih.appendChild(addI);
  const th=el("div","thumbs");imgs.append(ih,th);
  (i.att||[]).forEach((aid,ix)=>{const b=el("button");b.type="button";b.setAttribute("aria-label",t("Open image {n}",{n:ix+1}));th.appendChild(b);b.addEventListener("click",()=>openViewer(k,i,ix));
    fileGet(aid).then(async rec=>{if(!rec||!key)return;const bytes=await decBytes(key,rec);const u=URL.createObjectURL(new Blob([bytes],{type:rec.type||"image/jpeg"}));sheetUrls.push(u);const im=el("img");im.src=u;im.alt="";b.appendChild(im)}).catch(()=>{})});
  if(!(i.att||[]).length)th.appendChild(el("span","small muted",t("None attached.")));
  const hint=el("p","hint");
  const save=el("button","primary",t("Save changes"));save.type="button";const del=el("button","danger",t("Delete entry"));del.type="button";const row=el("div","btnrow");row.append(save,del);
  save.addEventListener("click",async()=>{
    const a=parseNum(amt.value),c=curS.value,dt=date.value;hint.className="hint err";
    if(!(a>0)){hint.textContent=t("Enter an amount above zero.");return}if(!/^\d{4}-\d{2}-\d{2}$/.test(dt)){hint.textContent=t("Choose a date.");return}if(!rateOf(c)){hint.textContent=t("Set the {c} exchange rate in Settings first.",{c});return}
    const base=Math.round(totalBase()*100)/100;const plist=[...parts.children].map(r=>r._get()).filter(pp=>pp.czk>0);
    if(ty==="expense"&&plist.length){const sum=plist.reduce((s2,pp)=>s2+pp.czk,0);if(Math.abs(sum-base)>=1){hint.textContent=t("The parts need to add up to {x}.",{x:fmtCur(base,baseCur())});return}}
    const n2={...i,type:ty,amount:a,cur:c,czk:base,date:dt,time:tm.value||"",note:note.value.trim().slice(0,80),cat:cat.value,oneoff:ty==="expense"&&one.checked};
    if(!n2.time)delete n2.time;if(i.src==="auto"){n2.src="hand";delete n2.rec;(docs.autoSkip=docs.autoSkip||{})[i.id]=1;n2.id=uid("e")}
    if(ty==="expense"&&plist.length>1){n2.parts=plist;n2.cat=plist.slice().sort((x,y)=>y.czk-x.czk)[0].cat}else delete n2.parts;
    if(!n2.oneoff)delete n2.oneoff;if(c!==i.cur||a!==i.amount){if(c===baseCur())delete n2.orig;else n2.orig=a+" "+c}
    if(cc){if(ty==="expense"&&kidOn.checked){n2.child={share:+kidShare.value};delete n2.childNo}else{if(i.child)n2.childNo=true;delete n2.child}
      if(ty==="income"&&repWrap.input.checked)n2.childRepay=true;else delete n2.childRepay}
    if(n2.cat!==i.cat&&(i.src==="rb"||i.src==="shot"||i.src==="csv")&&i.key&&!n2.parts){const st=ensureSettings();st.rules=st.rules||{};st.rules[i.key]=n2.cat}
    if(cc&&kidOn&&!!i.child!==kidOn.checked)kidLearn();
    const nk="m-"+dt.slice(0,7);docs[k].items=items(k).filter(x=>x.id!==i.id);(docs[nk]=docs[nk]||{items:[]}).items=items(nk).concat(n2);
    await persist();closeSheet();toast(t("Saved."));render()});
  del.addEventListener("click",async()=>{if(!del.classList.contains("confirm")){del.classList.add("confirm");del.textContent=t("Tap again to delete");return}
    docs[k].items=items(k).filter(x=>x.id!==i.id);if(i.src==="auto")(docs.autoSkip=docs.autoSkip||{})[i.id]=1;await persist();await dropUnused(i.att);closeSheet();toast(t("Entry deleted"));render()});
  const meta=el("p","fine",(i.src==="rb"?t("From your Raiffeisen export"):i.src==="csv"?t("From a bank export"):i.src==="shot"?t("From a screenshot"):i.src==="auto"?t("Added automatically from a recurring item"):t("Added by hand"))+(i.orig?" · "+t("original amount {x}",{x:i.orig}):""));
  openSheet(t("Edit entry"),[seg,r1,fld(t("Category"),cat),r2,fld(t("Time"),tm),oneWrap,kidWrap,repWrap,partsWrap,imgs,meta,row,hint].filter(Boolean));
}

/* ---------- add entry, header controls ---------- */
function defaultDate(){const p=curP();return isCurP(p)?todayIso():p.s}
function move(n){const d=new Date(cur.y,cur.m+n,1);cur={y:d.getFullYear(),m:d.getMonth()};selDay=null;$("fDate").value=defaultDate();render()}
$("prevM").addEventListener("click",()=>move(-1));$("nextM").addEventListener("click",()=>move(1));
$("hideBtn").addEventListener("click",()=>setPrivate(!document.body.classList.contains("private")));
$("curBtn").addEventListener("click",()=>{const st=ensureSettings();const c2=cur2();if(!c2)return;if(st.dispCur!==c2&&!rateOf(c2)){toast(t("Set the {c} exchange rate in Settings first.",{c:c2}));return}st.dispCur=st.dispCur===c2?baseCur():c2;persist().then(render)});
function fillCats(){const sel=$("fCat");if(!sel)return;const list=catsOf(type),prev=sel.value;sel.replaceChildren(...list.map(c=>el("option","",c)));if(list.includes(prev))sel.value=prev;
  const cs=$("fCur");const v=cs.value;cs.replaceChildren(...curOptions().map(c=>el("option","",c)));cs.value=curOptions().includes(v)?v:baseCur();
  const kw=$("fKidWrap");if(kw){const cc=childCfg();kw.hidden=!cc||type!=="expense";if(cc)$("fKidLabel").textContent=t("For {c}",{c:cc.child||t("my child")})}}
document.querySelectorAll("#addPanel .seg button").forEach(b=>b.addEventListener("click",()=>{type=b.dataset.type;document.querySelectorAll("#addPanel .seg button").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));fillCats();
  $("saveBtn").textContent=type==="expense"?t("Add expense"):type==="saving"?t("Add saving"):t("Add income");$("fOneoff").parentElement.hidden=type!=="expense"}));
$("entryForm").addEventListener("submit",e=>{e.preventDefault();if(!key)return;const h=$("formHint");
  const amt=parseNum($("fAmt").value),c=$("fCur").value;
  if(!(amt>0)){h.textContent=t("Enter an amount above zero.");h.className="hint err";return}
  if(!rateOf(c)){h.textContent=t("Set the {c} exchange rate in Settings first.",{c});h.className="hint err";return}
  const date=$("fDate").value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;const k="m-"+date.slice(0,7);
  const it={id:uid("e"),type,cat:$("fCat").value,amount:amt,cur:c,czk:Math.round(amt*rateOf(c)*100)/100,note:$("fNote").value.trim().slice(0,80),date,ts:Date.now()};if($("fTime").value)it.time=$("fTime").value;
  if(c!==baseCur())it.orig=amt+" "+c;if(type==="expense"&&$("fOneoff").checked)it.oneoff=true;
  const cc=childCfg();if(cc&&type==="expense"&&$("fKid").checked)it.child={share:+cc.share||50};
  const rf=$("fReceipt").files[0];
  (rf?storeImage(rf).then(id=>{it.att=[id]}):Promise.resolve()).then(()=>{(docs[k]=docs[k]||{items:[]}).items=items(k).concat(it);return persist()})
  .then(()=>{["fAmt","fNote","fTime","fReceipt"].forEach(x=>$(x).value="");$("fReceiptName").textContent="";$("fOneoff").checked=false;$("fKid").checked=false;h.className="hint ok";h.textContent=t("Added {c} · {x}",{c:it.cat,x:fmt(it.czk)});render()})
  .catch(()=>{h.className="hint err";h.textContent=t("Couldn't save that image. Try a smaller one.")});
});

/* ---------- goals and investing ---------- */
function goalList(){return ((docs.goals||{}).list||[])}
const investCats=()=>catList("saving").filter(c=>c.k==="investing").map(c=>c.n);
function investTotalSince(since){const ic=investCats();return allItems().filter(x=>x.i.type==="saving"&&ic.includes(x.i.cat)&&(!since||x.i.date>=since)).reduce((a,x)=>a+(+x.i.czk||0),0)}
function shares(){const s=settings().invest;const tt=s.short+s.long;return tt?{short:s.short/tt,long:s.long/tt}:{short:0,long:1}}
const splitOn=()=>!!((docs.settings||{}).features||{}).investSplit;
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
  if(!months.length)return null;let sum=0;const ic=investCats();
  months.forEach(k=>{const tt=totals(k);sum+=src.startsWith("cat:")?(tt.byCat["saving:"+src.slice(4)]||0):ic.reduce((a,c)=>a+(tt.byCat["saving:"+c]||0),0)*shares()[src.slice(4)]});
  return sum/months.length;
}
function srcLabel(g){const s=g.src||"manual";if(s.startsWith("cat:"))return t("Counts your {c} entries",{c:s.slice(4)});if(s==="inv:long")return t("Counts the long-term share of your investing");if(s==="inv:short")return t("Counts the short-term share of your investing");
  if(s.startsWith("acct:")){const a=((docs.accounts||{}).list||[]).find(a=>a.id===s.slice(5));return a?t("Follows your {a} balance",{a:a.name}):t("Account not found")}return t("Updated by hand")}
const monthsBetween=(a,b)=>(b.getFullYear()-a.getFullYear())*12+(b.getMonth()-a.getMonth());
function renderGoals(){
  const box=$("goals");box.replaceChildren();const list=goalList();
  if(!list.length){box.appendChild(el("p","empty",t("No goals yet. Add one to track it here.")));return}
  list.forEach(g=>{const pr=goalProgress(g),tg=+g.target||0,pace=goalPace(g);const c=el("div","goal");
    const h=el("div","gh");h.append(el("span","gn",g.name),el("span","gv amt",tg?t("{a} of {b}",{a:fmt(pr),b:fmt(tg)}):fmt(pr)));c.appendChild(h);
    const tr=el("div","gt");const f=el("i");f.style.width=(tg?Math.min(100,pr/tg*100):0).toFixed(1)+"%";tr.appendChild(f);c.appendChild(tr);
    const parts=[];
    if(!tg)parts.push(t("Set a target to see progress."));
    else if(pr>=tg)parts.push(t("Reached. Well done."));
    else{const left=tg-pr;if(g.date){const end=new Date(g.date+"-01");const ml=Math.max(1,monthsBetween(now,end));parts.push(t("Needs {x} a month to reach it by {d}.",{x:fmt(left/ml),d:mName(end.getFullYear(),end.getMonth())}))}
      if(pace>0){const mm=Math.ceil(left/pace);const d=new Date(now.getFullYear(),now.getMonth()+mm,1);parts.push(t("At {x} a month you'd get there by {d}.",{x:fmt(pace),d:mName(d.getFullYear(),d.getMonth())}))}
      else if(pace!==null)parts.push(t("Nothing added in the last 3 months."))}
    c.appendChild(el("div","gm amt",parts.join(" ")));
    const foot=el("div","panel-head");foot.style.margin="0";foot.append(el("span","small muted",srcLabel(g)));const ed=el("button","link",t("Edit"));ed.addEventListener("click",()=>openGoal(g.id));foot.appendChild(ed);c.appendChild(foot);
    box.appendChild(c)});
}
$("goalAdd").addEventListener("click",()=>openGoal(null));
function openGoal(id){
  const g=id?goalList().find(x=>x.id===id):{id:uid("g"),name:"",target:"",date:"",start:0,src:"manual",created:todayIso()};if(!g)return;
  const name=inp(g.name);name.maxLength=40;const target=inp(g.target?String(g.target):"","","decimal");const date=inp(g.date||"","month");
  const accts=((docs.accounts||{}).list||[]);const srcOpts=[["manual",t("I'll update the amount myself")]].concat(SAVE_CATS.map(c=>["cat:"+c,t("My {c} entries",{c})]));
  if(splitOn())srcOpts.push(["inv:long",t("Long-term share of my investing")],["inv:short",t("Short-term share of my investing")]);
  accts.forEach(a=>srcOpts.push(["acct:"+a.id,t("Balance of {a}",{a:a.name})]));
  const src=selOf(srcOpts,g.src||"manual");const start=inp(String(g.start||0),"","decimal");const startF=fld(g.src==="manual"?t("Amount saved so far"):t("Already saved before tracking"),start);
  src.addEventListener("change",()=>{startF.querySelector("label").textContent=src.value==="manual"?t("Amount saved so far"):t("Already saved before tracking");startF.hidden=src.value.startsWith("acct:")});startF.hidden=(g.src||"").startsWith("acct:");
  const hint=el("p","hint err");const save=el("button","primary",t("Save goal"));const del=el("button","danger",id?t("Delete goal"):t("Cancel"));const row=el("div","btnrow");row.append(save,del);
  save.addEventListener("click",async()=>{if(!name.value.trim()){hint.textContent=t("Give the goal a name.");return}
    const ng={...g,seeded:undefined,name:name.value.trim(),target:parseNum(target.value)||0,date:date.value||"",src:src.value,start:parseNum(start.value)||0};
    docs.goals=docs.goals||{list:[]};const l=goalList();const ix=l.findIndex(x=>x.id===g.id);if(ix>=0)l[ix]=ng;else l.push(ng);docs.goals.list=l;await persist();closeSheet();render()});
  del.addEventListener("click",async()=>{if(!id){closeSheet();return}if(!del.classList.contains("confirm")){del.classList.add("confirm");del.textContent=t("Tap again to delete");return}
    docs.goals.list=goalList().filter(x=>x.id!==id);await persist();closeSheet();render()});
  openSheet(id?t("Edit goal"):t("New goal"),[fld(t("Name"),name),fld(t("Target ({c})",{c:baseCur()}),target),fld(t("Target date (optional)"),date),fld(t("How progress is counted"),src),startF,row,hint]);
}
function renderInvest(){
  const panel=$("investPanel");const ic=investCats();panel.hidden=!ic.length;if(!ic.length)return;
  const s=settings();const tg=ic.reduce((a,c)=>a+s.targets[c],0);const tt=totalsP(curP());const m=ic.reduce((a,c)=>a+(tt.byCat["saving:"+c]||0),0);const total=investTotalSince(null);
  const first=allItems().filter(x=>x.i.type==="saving"&&ic.includes(x.i.cat)).map(x=>x.i.date).sort()[0];
  $("invMonth").textContent=fmt(m);$("invMonthOf").textContent=tg?t("of {x} target",{x:fmt(tg)}):"";$("invTotal").textContent=fmt(total);
  $("invSince").textContent=first?t("since {d}",{d:dOf(first).toLocaleDateString(LOC(),{month:"short",year:"numeric"})}):"";
  const box=$("invSplit");box.replaceChildren();$("invNote").textContent="";
  if(splitOn()){const sh=shares();$("invNote").textContent=t("{a} + {b} a month",{a:fmt(s.invest.short),b:fmt(s.invest.long)});
    [[t("Short term (around 2 years)"),sh.short,s.invest.short],[t("Long term (5+ years)"),sh.long,s.invest.long]].forEach(([lab,share,monthly])=>{
      const bar=el("div","bar");const top=el("div","bar-top");top.append(el("span","",lab),el("span","v amt",t("{x} total",{x:fmt(total*share)})));
      const tr=el("div","track"),f=el("div","fill ok");f.style.width=(monthly?Math.min(100,m*share/monthly*100):0).toFixed(1)+"%";tr.appendChild(f);
      bar.append(top,tr,el("span","small muted amt",t("{a} of {b} this period",{a:fmt(m*share),b:fmt(monthly)})));box.appendChild(bar)})}
}
function barsChart(box,vals,labels,target,label,color){
  if(!vals.some(v=>v)){box.replaceChildren(el("div","empty",t("Nothing yet.")));return}
  const W=boxW(box),H=170,pl2=40,pr=6,pt=10,pb=24;const max=Math.max(target||0,...vals)*1.1||1;const n=vals.length;
  const y=v=>pt+(H-pt-pb)*(1-v/max),gw=(W-pl2-pr)/n,bw=Math.min(26,gw*.5);const svg=svgEl(W,H,label);axisY(svg,max,0,y,pl2,W,pr);
  vals.forEach((v,i)=>{const cx=pl2+gw*i+gw/2;svg.add("rect",{x:cx-bw/2,y:y(v),width:bw,height:Math.max(0,H-pb-y(v)),rx:3,fill:color});svg.add("text",{x:cx,y:H-7,"text-anchor":"middle",class:i===n-1?"now":""},labels[i])});
  if(target)svg.add("line",{x1:pl2,x2:W-pr,y1:y(target),y2:y(target),stroke:"var(--muted)","stroke-width":1.5,"stroke-dasharray":"5 4"});
  chartTip(box,svg,W,pl2,pr,n,ix=>labels[ix]+" · "+fmt(vals[ix]));
}
function renderInvChart(){const ic=investCats();if(!ic.length)return;const s=settings();const l=last6();barsChart($("invChart"),l.map(x=>{const tt=totalsP(x.p);return ic.reduce((a,c)=>a+(tt.byCat["saving:"+c]||0),0)}),l.map(x=>x.lab),ic.reduce((a,c)=>a+s.targets[c],0),t("Investing against target"),"var(--ok)")}

/* ---------- accounts, savings over time, money transferred in ---------- */
function netTotal(){let net=0,missing=false;((docs.accounts||{}).list||[]).forEach(a=>{const r=rateOf(a.cur);if(!r)missing=true;else net+=(+a.balance||0)*r});return {net,missing}}
function snapshotNet(){const acc=(docs.accounts||{}).list||[];if(!acc.length)return;const {net}=netTotal();docs.history=docs.history||{snap:{}};docs.history.snap[todayIso()]=Math.round(net);
  const ks=Object.keys(docs.history.snap).sort();if(ks.length>500)ks.slice(0,ks.length-500).forEach(k=>delete docs.history.snap[k])}
function renderAccounts(){
  const acc=((docs.accounts||{}).list||[]),box=$("accts");box.replaceChildren();const {net,missing}=netTotal();
  $("kNet").textContent=acc.length?fmt(net):"—";$("kNetSub").textContent=acc.length?(missing?t("Some balances skipped: set the exchange rate in Settings."):t("converted to {c}",{c:dispCode()})):t("Add your accounts below.");
  acc.forEach(a=>{const row=el("div","acct");const l=el("div");l.style.minWidth="0";l.append(el("div","nm",a.name),el("div","meta",a.updated?t("updated {d}",{d:dShort(iso(new Date(a.updated)))}):""));
    const bal=el("div","bal amt",fmtCur(+a.balance||0,a.cur));if(a.cur!==dispCode()&&rateOf(a.cur))bal.appendChild(el("small","","≈ "+fmt((+a.balance||0)*rateOf(a.cur))));
    const ed=el("div","edit");const up=el("button","link",t("Update balance"));
    up.addEventListener("click",()=>{ed.replaceChildren();const i2=inp(String(a.balance),"","decimal");i2.setAttribute("aria-label",t("New balance"));
      const ok=el("button","link",t("Save")),rm=el("button","link",t("Delete"));rm.style.color="var(--bad)";
      ok.addEventListener("click",()=>{const v=parseNum(i2.value);if(isNaN(v))return;a.balance=v;a.updated=Date.now();snapshotNet();persist().then(render)});
      rm.addEventListener("click",()=>{if(rm.textContent!==t("Tap to confirm")){rm.textContent=t("Tap to confirm");return}docs.accounts.list=acc.filter(x=>x!==a);snapshotNet();persist().then(render)});
      ed.append(i2,ok,rm);i2.focus()});
    ed.appendChild(up);row.append(l,bal,ed);box.appendChild(row)});
  const ac=$("aCur");const v=ac.value;ac.replaceChildren(...curOptions().map(c=>el("option","",c)));ac.value=curOptions().includes(v)?v:baseCur();
}
$("acctForm").addEventListener("submit",e=>{e.preventDefault();if(!key)return;const v=parseNum($("aBal").value),n=$("aName").value.trim();if(!n||isNaN(v))return;
  docs.accounts=docs.accounts||{list:[]};docs.accounts.list.push({id:uid("a"),name:n.slice(0,40),cur:$("aCur").value,balance:v,updated:Date.now()});snapshotNet();
  $("aName").value="";$("aBal").value="";persist().then(render)});
function renderNet(){
  const box=$("netChart");const snap=(docs.history||{}).snap||{};const ks=Object.keys(snap).sort();
  if(ks.length<2){box.replaceChildren(el("div","empty",ks.length?t("The line appears after a balance update on another day."):t("Add your accounts to start the line.")));return}
  const W=boxW(box),H=170,pl2=44,pr=10,pt=10,pb=24;const vals=ks.map(k=>snap[k]);const lo=Math.min(...vals),hi=Math.max(...vals);const sp=(hi-lo)*.15||hi*.05||1;const min=Math.max(0,lo-sp),max=hi+sp;
  const t0=dOf(ks[0]).getTime(),t1=dOf(ks[ks.length-1]).getTime();const x=k=>pl2+(W-pl2-pr)*((dOf(k).getTime()-t0)/((t1-t0)||1)),y=v=>pt+(H-pt-pb)*(1-(v-min)/(max-min));
  const svg=svgEl(W,H,t("Total savings over time"));axisY(svg,max,min,y,pl2,W,pr);
  let d="";ks.forEach((k,i)=>d+=(i?" L":"M")+x(k)+" "+y(snap[k]));svg.add("path",{d:d+" L"+x(ks[ks.length-1])+" "+(H-pb)+" L"+x(ks[0])+" "+(H-pb)+" Z",fill:"var(--ok)",opacity:.12});
  svg.add("path",{d,fill:"none",stroke:"var(--ok)","stroke-width":2.5});const lk=ks[ks.length-1];svg.add("circle",{cx:x(lk),cy:y(snap[lk]),r:4.5,fill:"var(--ok)",stroke:"var(--panel)","stroke-width":2});
  [ks[0],lk].forEach((k,i)=>svg.add("text",{x:x(k),y:H-7,"text-anchor":i?"end":"start"},dShort(k)));
  chartTip(box,svg,W,pl2,pr,ks.length,ix=>dShort(ks[ix])+" · "+fmt(snap[ks[ix]]));
}
function renderAU(){const tc=catList("income").filter(c=>c.k==="transfer").map(c=>c.n);const panel=$("auPanel");panel.hidden=!tc.length;if(!tc.length)return;
  $("auTitle").textContent=tc.join(", ");const p=curP();$("auMonth").textContent=fmt(totalsP(p).fromIn);let y=0;for(let i=0;i<12;i++)y+=totalsP(shiftP(p,-i)).fromIn;$("auYear").textContent=fmt(y)}
function renderAUChart(){if($("auPanel").hidden)return;const l=last6();barsChart($("auChart"),l.map(x=>totalsP(x.p).fromIn),l.map(x=>x.lab),0,t("Money transferred in per period"),"var(--c4)")}

/* ---------- recurring items: salary, transfers to goals, bills ---------- */
function recList(){return ((docs.recurring||{}).list||[]).filter(r=>r&&r.name)}
const recCzk=r=>(+r.amount||0)*(rateOf(r.cur||baseCur())||1);
function recWhen(r){const tm=r.time?" "+t("at {t}",{t:r.time}):"";const wd=WEEKDAYS()[+r.wd||0];
  if(r.freq==="weekly")return t("weekly on {w}",{w:wd})+tm;if(r.freq==="fortnightly")return t("every two weeks on {w}",{w:wd})+tm;
  return (+r.day>=31?t("monthly on the last day"):t("monthly on the {d}",{d:ord(+r.day||1)}))+tm}
function occurrences(r,from,to){
  const out=[];const start=r.start?dOf(r.start):new Date(2000,0,1);const [hh,mm]=(r.time||"09:00").split(":").map(Number);
  const at=d=>{const x=new Date(d);x.setHours(hh||0,mm||0,0,0);return x};
  if(r.freq==="weekly"||r.freq==="fortnightly"){const step=r.freq==="weekly"?7:14;let d=new Date(start);while(((d.getDay()+6)%7)!==(+r.wd||0))d.setDate(d.getDate()+1);
    while(at(d)<from)d.setDate(d.getDate()+step);for(;at(d)<=to;d.setDate(d.getDate()+step))if(d>=start)out.push(iso(d));return out}
  let y=from.getFullYear(),m=from.getMonth();
  for(let i=0;i<40;i++){const dim=new Date(y,m+1,0).getDate();const d=new Date(y,m,Math.min(+r.day||1,dim));const tt=at(d);if(tt>to)break;if(tt>=from&&d>=start)out.push(iso(d));m++;if(m>11){m=0;y++}}
  return out;
}
const atTime=(r,dIso)=>{const [hh,mm]=(r.time||"09:00").split(":").map(Number);const x=dOf(dIso);x.setHours(hh||0,mm||0,0,0);return x};
function recWords(r){return String(r.match||r.name).toLowerCase().split(/[,|]/).map(w=>w.trim()).filter(Boolean)}
function recMatch(r,dIso,pool,used){
  const amt=recCzk(r),tol=Math.max(amt*.1,50),ty=typeOfCat(r.cat),words=recWords(r),t0=dOf(dIso).getTime();
  return pool.filter(i=>!(used&&used.has(i.id))&&i.type===ty&&Math.abs(dOf(i.date).getTime()-t0)<=4*DAY&&Math.abs((+i.czk||0)-amt)<=tol&&
    (i.cat===r.cat||words.some(w=>((i.note||"")+" "+(i.cat||"")).toLowerCase().includes(w))))
    .sort((a,b)=>(a.src==="auto")-(b.src==="auto")||Math.abs((+a.czk||0)-amt)-Math.abs((+b.czk||0)-amt))[0]||null;
}
const autoId=(r,dIso)=>"auto-"+r.id+"-"+dIso;
async function runAuto(){
  if(!key||!docs.settings)return 0;const nowD=new Date();const skip=docs.autoSkip||(docs.autoSkip={});const have=allIds();let added=0;
  const pool=allItems().map(x=>x.i).filter(i=>i.src!=="auto");
  recList().filter(r=>r.auto).forEach(r=>{const from=new Date(Math.max(dOf(r.start||todayIso()).getTime(),nowD.getTime()-62*DAY));
    occurrences(r,from,nowD).forEach(dIso=>{const id=autoId(r,dIso);if(have.has(id)||skip[id])return;
      if(recMatch(r,dIso,pool)){skip[id]=1;return}
      const ty=typeOfCat(r.cat);const it={id,type:ty,cat:r.cat,amount:+r.amount||0,cur:r.cur||baseCur(),czk:Math.round(recCzk(r)*100)/100,note:r.name,date:dIso,time:r.time||"",ts:0,src:"auto",rec:r.id};
      if((r.cur||baseCur())!==baseCur())it.orig=r.amount+" "+r.cur;if(r.child&&ty==="expense"&&childCfg())it.child={share:+r.child.share};const k="m-"+dIso.slice(0,7);(docs[k]=docs[k]||{items:[]}).items=items(k).concat(it);have.add(id);added++})});
  monthKeys().forEach(k=>{const before=items(k).length;docs[k].items=items(k).filter(i=>!(i.src==="auto"&&skip[i.id]));if(docs[k].items.length!==before)added++});
  return added;
}
function findAutoTwin(i){for(const {k,i:x} of allItems()){if(x.src!=="auto"||x.type!==i.type)continue;const r=recList().find(r=>r.id===x.rec);
  const amt=+x.czk||0,tol=Math.max(amt*.1,50);if(Math.abs(dOf(x.date)-dOf(i.date))<=4*DAY&&Math.abs((+i.czk||0)-amt)<=tol&&(!r||i.cat===x.cat||recWords(r).some(w=>((i.note||"")+" "+(i.cat||"")).toLowerCase().includes(w))))return {k,it:x}}return null}
function billStatus(p){
  const first=new Date(p.start),last=new Date(p.end);last.setHours(23,59,59,999);const used=new Set();const list=pItems(p);const out=[];const nowD=new Date();const tI=todayIso();
  recList().forEach(r=>{const ty=typeOfCat(r.cat);occurrences({...r,start:""},first,last).forEach(dIso=>{
    const hit=recMatch(r,dIso,list,used);if(hit)used.add(hit.id);const due=atTime(r,dIso);let st,label,dueSoon=false;
    const verb=ty==="income"?"Received {d}":ty==="saving"?"Transferred {d}":"Paid {d}";
    if(hit&&hit.src==="auto"){st="auto";label=t("Added automatically")}
    else if(hit){st="paid";label=t(verb,{d:dDay(hit.date)})}
    else if(due>nowD){const dd=Math.round((dOf(dIso)-dOf(tI))/DAY);st=dd<=3?"soon":"due";dueSoon=dd<=1;
      label=dd===0?t("Due today")+(r.time?" "+r.time:""):dd===1?t("Due tomorrow")+(r.time?" "+r.time:""):dd<=3?t("Due in {n} {d}",{n:dd,d:pl(dd,"day")}):(ty==="income"?t("Expected {d}",{d:dDay(dIso)}):t("Due {d}",{d:dDay(dIso)}))}
    else{const late=Math.floor((dOf(tI)-dOf(dIso))/DAY);st=ty==="income"?"due":"late";label=ty==="income"?t("Not seen yet"):(isCurP(p)?(late?t("{n} {d} late",{n:late,d:pl(late,"day")}):t("Due earlier today")):t("Not found"))}
    out.push({r,ty,hit,st,label,dIso,dueSoon,idx:dayIdx(p,dIso)})})});
  return out.sort((a,b)=>a.dIso.localeCompare(b.dIso)||(a.r.time||"").localeCompare(b.r.time||""));
}
function monthBills(p){return billStatus(p).filter(x=>x.ty==="expense").map(x=>({x,amount:recCzk(x.r),idx:x.idx}))}

/* ---------- recurring items editor and calendar reminders ---------- */
function renderRecList(){
  const ul=$("recList");ul.replaceChildren();const list=recList();
  if(!list.length){ul.appendChild(el("li","empty",t("Nothing yet.")));return}
  list.slice().sort((a,b)=>(+a.day||0)-(+b.day||0)).forEach(r=>{const li=el("li");const b=el("button");b.type="button";const ty=typeOfCat(r.cat);
    b.append(el("span","rn",r.name),el("span","ra amt",(ty==="income"?"+":"")+fmtCur(+r.amount||0,r.cur||baseCur())),
      el("span","rs",(ty==="income"?t("Income"):ty==="saving"?t("Saving"):t("Bill"))+" · "+recWhen(r)+(r.auto?" · "+t("adds automatically"):"")+(r.remind?" · "+t("reminder"):"")));
    b.addEventListener("click",()=>openRec(r.id));li.appendChild(b);ul.appendChild(li)});
}
$("recAdd").addEventListener("click",()=>openRec(null));
function openRec(id,preset){
  const r=id?recList().find(x=>x.id===id):Object.assign({id:uid("r"),name:"",cat:EXP_CATS[0],amount:"",cur:baseCur(),freq:"monthly",day:1,wd:0,time:"09:00",start:todayIso(),auto:true,remind:true,before:0,match:""},preset||{});if(!r)return;
  const name=inp(r.name);name.maxLength=40;name.placeholder=t("e.g. Salary");
  const cat=el("select");[[t("Income"),INC_CATS],[t("Saving (transfer to a goal)"),SAVE_CATS],[t("Bill or expense"),EXP_CATS]].forEach(([lab,l])=>{const g=el("optgroup");g.label=lab;l.forEach(c=>g.appendChild(el("option","",c)));cat.appendChild(g)});cat.value=r.cat;
  const amount=inp(r.amount!==""?String(r.amount).replace(".",","):"","","decimal");const cu=selOf(curOptions([r.cur]),r.cur||baseCur());
  const freq=selOf([["monthly",t("Monthly")],["fortnightly",t("Every two weeks")],["weekly",t("Weekly")]],r.freq||"monthly");
  const day=selOf(Array.from({length:31},(_,i)=>[String(i+1),i===30?t("31st (or last day)"):ord(i+1)]),String(r.day||1));const wd=selOf(WEEKDAYS().map((w,i)=>[String(i),w]),String(r.wd||0));
  const time=inp(r.time||"09:00","time");const start=inp(r.start||todayIso(),"date");
  const dayF=fld(t("Day of the month"),day),wdF=fld(t("Day of the week"),wd);const sync2=()=>{dayF.hidden=freq.value!=="monthly";wdF.hidden=freq.value==="monthly"};freq.addEventListener("change",sync2);sync2();
  const autoL=chk(t("Add to my ledger automatically at this date and time"),r.auto);const remL=chk(t("Remind me"),r.remind);
  const before=selOf([["0",t("At the time")],["1",t("1 day before")],["2",t("2 days before")],["3",t("3 days before")]],String(r.before||0));const beforeF=fld(t("When to remind"),before);const s3=()=>beforeF.hidden=!remL.input.checked;remL.input.addEventListener("change",s3);s3();
  const match=inp(r.match||"");match.placeholder=t("e.g. employer name, salary");
  const cc=childCfg();let kidL=null;if(cc){kidL=chk(t("For {c}",{c:cc.child||t("my child")}),!!r.child);const sk=()=>kidL.hidden=typeOfCat(cat.value)!=="expense";cat.addEventListener("change",sk);sk()}
  const r1=el("div","row2");r1.append(fld(t("Amount"),amount),fld(t("Currency"),cu));const r2=el("div","inline2");r2.append(fld(t("Repeats"),freq),fld(t("Time"),time));const r3=el("div","inline2");r3.append(dayF,wdF,fld(t("Starting from"),start));
  const hint=el("p","hint err");const save=el("button","primary",t("Save"));const del=el("button","danger",id?t("Delete"):t("Cancel"));const row=el("div","btnrow");row.append(save,del);
  save.addEventListener("click",async()=>{const a=parseNum(amount.value);if(!name.value.trim()){hint.textContent=t("Give it a name.");return}if(!(a>0)){hint.textContent=t("Enter an amount above zero.");return}if(!rateOf(cu.value)){hint.textContent=t("Set the {c} exchange rate in Settings first.",{c:cu.value});return}
    const n={...r,seeded:undefined,name:name.value.trim(),cat:cat.value,amount:a,cur:cu.value,freq:freq.value,day:+day.value,wd:+wd.value,time:time.value||"09:00",start:start.value||todayIso(),auto:autoL.input.checked,remind:remL.input.checked,before:+before.value,match:match.value.trim()};if(kidL){if(!kidL.input.checked||typeOfCat(n.cat)!=="expense")delete n.child;else n.child={share:r.child?+r.child.share:(+cc.share||50)}}
    if(n.cat&&kindOf(n.cat,"income")==="salary"){const st=ensureSettings();st.salaryWords=[...new Set([...(st.salaryWords||[]),...recWords(n).filter(w=>w.length>=3)])]}
    docs.recurring=docs.recurring||{list:[]};const l=recList();const ix=l.findIndex(x=>x.id===r.id);if(ix>=0)l[ix]=n;else l.push(n);docs.recurring.list=l;
    await runAuto();await persist();closeSheet();render();toast(id?t("Saved."):t("Added. Add it to your calendar below if you want a reminder."))});
  del.addEventListener("click",async()=>{if(!id){closeSheet();return}if(!del.classList.contains("confirm")){del.classList.add("confirm");del.textContent=t("Tap again to delete");return}
    docs.recurring.list=recList().filter(x=>x.id!==id);await persist();closeSheet();render()});
  openSheet(id?t("Edit recurring item"):t("New recurring item"),[fld(t("Name"),name),fld(t("Category"),cat),r1,r2,r3,autoL,kidL,remL,beforeF,fld(t("Words that identify it in bank exports (optional)"),match),
    el("p","fine",t("Automatic entries are replaced by the matching bank entry when you import your bank export, so nothing is counted twice.")),row,hint].filter(Boolean));
}
function icsEsc(s){return String(s).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n")}
function buildICS(withAmounts){
  const L=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Kc Ledger//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:Kč Ledger"];
  const stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d+/,"");let n=0;const BY=["MO","TU","WE","TH","FR","SA","SU"];
  recList().filter(r=>r.remind).forEach(r=>{const first=occurrences(r,new Date(Math.max(dOf(r.start||todayIso()).getTime(),Date.now()-40*DAY)),new Date(Date.now()+400*DAY))[0];if(!first)return;
    const [hh,mm]=(r.time||"09:00").split(":");const ty=typeOfCat(r.cat);
    const rule=r.freq==="weekly"?"FREQ=WEEKLY;BYDAY="+BY[+r.wd||0]:r.freq==="fortnightly"?"FREQ=WEEKLY;INTERVAL=2;BYDAY="+BY[+r.wd||0]:(+r.day>=29?"FREQ=MONTHLY;BYMONTHDAY="+(+r.day>=31?-1:"28,"+r.day)+";BYSETPOS=-1":"FREQ=MONTHLY;BYMONTHDAY="+(+r.day||1));
    const what=(ty==="income"?t("{n} expected",{n:r.name}):ty==="saving"?t("{n}: transfer",{n:r.name}):t("{n} due",{n:r.name}))+(withAmounts?" · "+fmtCur(+r.amount||0,r.cur||baseCur()):"");
    L.push("BEGIN:VEVENT","UID:"+r.id+"@kc-ledger","DTSTAMP:"+stamp,"DTSTART:"+first.replace(/-/g,"")+"T"+hh+mm+"00","DURATION:PT15M","RRULE:"+rule,
      "SUMMARY:"+icsEsc(what),"DESCRIPTION:"+icsEsc(t("Open Kč Ledger to check it off.")),"BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:"+icsEsc(what),"TRIGGER:"+(+r.before?"-P"+(+r.before)+"D":"-PT0M"),"END:VALARM","END:VEVENT");n++});
  L.push("END:VCALENDAR");return {text:L.join("\r\n")+"\r\n",n};
}
$("icsBtn").addEventListener("click",async()=>{const h=$("icsHint");const {text,n}=buildICS($("icsAmounts").checked);
  if(!n){h.className="hint err";h.textContent=t("No items have “Remind me” turned on yet.");return}
  await offerFile("kc-ledger-reminders.ics",new Blob([text],{type:"text/calendar"}));
  h.className="hint ok";h.textContent=t("{n} repeating reminders ready. Open the file and choose Add All. If you change items later, delete the old Kč Ledger events before adding the new file.",{n});});

/* ---------- settings ---------- */
const IMPORT_METHODS=[["raiffeisen","Raiffeisenbank"],["csob","ČSOB"],["cs","Česká spořitelna (George)"],["kb","Komerční banka"],["fio","Fio banka"],["airbank","Air Bank"],["mbank","mBank"],["moneta","MONETA Money Bank"],["revolut","Revolut"],["wise","Wise"],["csv","Another bank (CSV file)"],["manual","Screenshots and typing only"]];
function importHowTo(m){
  if(m==="raiffeisen")return t("In Raiffeisen internet banking, open the account's transaction history and export it as CSV (the file is called Movements_….csv). Export each of your accounts and import the files together, so transfers between them are left out.");
  if(m==="revolut")return t("In the Revolut app, open your account's statement, choose the CSV/Excel format and the period, then save the file and import it here.");
  if(m==="wise")return t("On the Wise website or app, open the balance, choose Statements, pick CSV and the period, then save the file and import it here.");
  if(m==="manual")return t("Add entries by hand, or use Read a screenshot on the Entries tab to pick up transactions from a banking-app screenshot or a receipt.");
  return t("In your internet banking, open the account's transaction history, choose export and pick CSV. The first time you import, Kč Ledger shows which columns it found so you can check them; after that it remembers.");
}
function fillSettings(){
  const st=docs.settings||{};const s=settings();
  $("setName").value=st.name||"";$("setLang").value=LANG;$("setTheme").value=st.theme||"system";
  const sc=$("setCur"),sc2=$("setCur2");sc.replaceChildren(...CURRENCIES.map(c=>el("option","",c)));sc.value=baseCur();
  sc2.replaceChildren(el("option","",t("None")),...CURRENCIES.map(c=>el("option","",c)));sc2.options[0].value="";sc2.value=cur2();
  $("setPeriod").value=(st.period||{}).type==="payday"?"payday":"calendar";const pd=$("setPayday");pd.replaceChildren(...Array.from({length:31},(_,i)=>{const o=el("option","",ord(i+1));o.value=String(i+1);return o}));pd.value=String((st.period||{}).day||1);$("setPaydayWrap").hidden=$("setPeriod").value!=="payday";
  // exchange rates
  $("autoRates").checked=!!st.autoRates;const rb=$("rateRows");rb.replaceChildren();
  curOptions(((docs.accounts||{}).list||[]).map(a=>a.cur)).filter(c=>c!==baseCur()).forEach(c=>{const f=el("div","field");const l=el("label","small muted",t("1 {c} = … {b}",{c,b:baseCur()}));const i=el("input","amt");i.id="rate_"+c;i.inputMode="decimal";i.value=rateOf(c)||"";i.dataset.cur=c;l.htmlFor=i.id;i.addEventListener("input",()=>$("ratesSave").disabled=false);f.append(l,i);rb.appendChild(f)});
  $("ratesSave").disabled=true;$("ratesInfo").textContent=st.ratesDate?t("Using the ECB reference rate of {d}.",{d:dLong(st.ratesDate)}):t("Using rates typed in by hand.");
  fillCatEditor();
  // import
  const im=$("setImport");im.replaceChildren(...IMPORT_METHODS.map(([v,n])=>{const o=el("option","",n==="Another bank (CSV file)"||n==="Screenshots and typing only"?t(n):n);o.value=v;return o}));im.value=(st.importPref||{}).method||"csv";$("importHow").textContent=importHowTo(im.value);
  $("setOwn").value=(st.ownAccounts||[]).join("\n");$("mapsInfo").textContent=Object.keys(st.csvMaps||{}).length?t("{n} saved column matches.",{n:Object.keys(st.csvMaps).length}):t("No saved column matches.");
  // child tracker
  const cc=(st.features||{}).child||{};$("kOn").checked=!!cc.on;$("kName").value=cc.name||"";$("kChild").value=cc.child||"";$("kOther").value=cc.other||"";
  const ks=$("kShare");ks.replaceChildren(...Array.from({length:21},(_,n)=>{const o=el("option","",t("{o} pays {p} %",{o:cc.other||t("The other parent"),p:n*5}));o.value=String(n*5);return o}));ks.value=String(cc.share!=null?cc.share:50);
  $("kBal").checked=cc.balance!==false;$("kFields").hidden=!cc.on;
  // security & backup
  $("autoLock").value=String(lockMins());$("hideOpen").checked=!!st.hideOnOpen;$("backupEvery").value=String(st.backupEvery==null?30:st.backupEvery);
  $("lastBackup").textContent=st.lastBackup?t("Last backup: {d}.",{d:dShort(iso(new Date(st.lastBackup)))}):t("No backup yet.");
}
const markDirty=()=>{$("tab-settings").dataset.dirty="1"};
// profile
$("setName").addEventListener("change",()=>{ensureSettings().name=$("setName").value.trim().slice(0,40);persist().then(render)});
$("setLang").addEventListener("change",()=>{const from=LANG;ensureSettings().lang=$("setLang").value;setLang($("setLang").value);relabelDefaults(from,LANG);fillFilterCats();fillCats();persist().then(()=>{delete $("tab-settings").dataset.dirty;render()})});
$("setTheme").addEventListener("change",()=>{ensureSettings().theme=$("setTheme").value;applyTheme($("setTheme").value);persist()});
// categories still called by their default name follow the language
function relabelDefaults(from,to){if(from===to)return;const st=ensureSettings();if(!st.cats)return;
  ["expense","saving","income"].forEach(ty=>(st.cats[ty]||[]).forEach(c=>{const nn=defName(c.k,ty,to);if(c.n===defName(c.k,ty,from)&&nn!==c.n&&!st.cats[ty].some(x=>x.n===nn)){renameCat(c.n,nn,ty);c.n=nn}}));applyCats()}
// money
$("setCur").addEventListener("change",async()=>{const c=$("setCur").value;if(c===baseCur())return;const st=ensureSettings();
  if(allItems().length&&!confirmInline($("curHint"),t("Your existing amounts stay as they are; only new entries use {c}. Change it anyway? Tap the selector again to confirm.",{c}))){$("setCur").value=baseCur();return}
  st.currency=c;st.rates={};st.ratesDate="";st.dispCur=c;await persist();await updateRates(true);render()});
let confirmArm=null;function confirmInline(h,msg){if(confirmArm===h){confirmArm=null;h.textContent="";return true}confirmArm=h;h.className="hint err";h.textContent=msg;return false}
$("setCur2").addEventListener("change",async()=>{const st=ensureSettings();st.currency2=$("setCur2").value;if(st.dispCur&&st.dispCur!==baseCur()&&st.dispCur!==st.currency2)st.dispCur=baseCur();await persist();await updateRates(true);render()});
$("ratesSave").addEventListener("click",()=>{const st=ensureSettings();st.rates=st.rates||{};$("rateRows").querySelectorAll("input").forEach(i=>{const v=parseNum(i.value);if(v>0)st.rates[i.dataset.cur]=v});st.ratesDate="";st.autoRates=false;
  persist().then(()=>{toast(t("Rates saved. Daily updates are off until you tick the box again."));render()})});
$("autoRates").addEventListener("change",()=>{ensureSettings().autoRates=$("autoRates").checked;persist().then(()=>{if($("autoRates").checked)updateRates(true)})});
$("ratesNow").addEventListener("click",()=>updateRates(true));
// pay period
$("setPeriod").addEventListener("change",()=>{$("setPaydayWrap").hidden=$("setPeriod").value!=="payday";savePeriod()});
$("setPayday").addEventListener("change",savePeriod);
function savePeriod(){const st=ensureSettings();st.period={type:$("setPeriod").value,day:+$("setPayday").value||1};cur=periodOfDate(new Date());persist().then(render)}
// categories and budgets
function fillCatEditor(){
  const mk=(boxId,ty,amounts)=>{const box=$(boxId);box.replaceChildren();catList(ty).forEach(c=>box.appendChild(catRow(ty,c.n,amounts?amounts[c.n]:null,c.k)))};
  const s=settings();mk("setCats","expense",s.budget);mk("setSave","saving",s.targets);mk("setInc","income",null);
  $("investSplit").checked=splitOn();$("invShort").value=s.invest.short||"";$("invLong").value=s.invest.long||"";$("splitFields").hidden=!splitOn();$("splitWrap").hidden=!investCats().length;
  $("catTotal").textContent=t("Total spending budget: {x}",{x:fmtCur(budgetTotal(s),baseCur())});$("saveSettings").disabled=true;
}
function catRow(ty,name,amount,kind){
  const r=el("div","cat-row");r.dataset.old=name||"";r.dataset.kind=kind||"other";
  const n=inp(name||"");n.placeholder=t("Category name");n.setAttribute("aria-label",t("Category name"));n.maxLength=40;r.appendChild(n);
  if(amount!==null&&amount!==undefined||ty!=="income"){const a=inp(amount?String(amount):"","","decimal");a.className="amt";a.placeholder="0";a.setAttribute("aria-label",ty==="saving"?t("Monthly target"):t("Monthly budget"));r.appendChild(a);r._a=a;
    if(ty==="saving"&&kind==="investing"&&splitOn())a.disabled=true}
  const x=el("button","x","×");x.type="button";x.setAttribute("aria-label",t("Remove category"));x.addEventListener("click",()=>{r.remove();markCats()});r.appendChild(x);
  r.querySelectorAll("input").forEach(i=>i.addEventListener("input",markCats));r._n=n;r._ty=ty;return r;
}
function markCats(){markDirty();$("saveSettings").disabled=false;$("setHint").textContent=t("Unsaved changes")}
[["catAdd","setCats","expense"],["saveAdd","setSave","saving"],["incAdd","setInc","income"]].forEach(([b,box,ty])=>$(b).addEventListener("click",()=>{$(box).appendChild(catRow(ty,"",ty==="income"?null:"",guessKind("",ty)));markCats();$(box).lastChild._n.focus()}));
$("investSplit").addEventListener("change",()=>{$("splitFields").hidden=!$("investSplit").checked;markCats()});
["invShort","invLong"].forEach(id=>$(id).addEventListener("input",markCats));
function guessKind(name,ty){const h=norm(name);if(ty==="saving")return /invest/.test(h)?"investing":/rezerv|emergenc|nouz/.test(h)?"emergency":"goal";
  if(ty==="income")return /mzd|plat|salar|wage/.test(h)?"salary":/vyzivn|mainten|child support/.test(h)?"maintenance":/uroky|urok|interest/.test(h)?"interest":/prevod|transfer/.test(h)?"transfer":"other";
  const k=kindFromText(h);return k||(/(deti|dite|child|kid)/.test(h)?"kids":"other")}
$("saveSettings").addEventListener("click",async()=>{
  const st=ensureSettings();const before={expense:catList("expense"),saving:catList("saving"),income:catList("income")};const out={};let err="";
  for(const [box,ty] of [["setCats","expense"],["setSave","saving"],["setInc","income"]]){const rows=[...$(box).children];const list=[];const seen=new Set();
    rows.forEach(r=>{const n=r._n.value.trim();if(!n)return;if(seen.has(n)){err=t("Two categories are called {n}.",{n});return}seen.add(n);const old=r.dataset.old;
      list.push({n,k:old?(before[ty].find(c=>c.n===old)||{}).k||r.dataset.kind:guessKind(n,ty),old,amount:r._a?parseNum(r._a.value)||0:null})});
    if(!list.length)err=t("Keep at least one category of each type.");out[ty]=list}
  if(err){$("setHint").className="hint err";$("setHint").textContent=err;return}
  for(const ty of ["expense","saving","income"]){
    out[ty].forEach(c=>{if(c.old&&c.old!==c.n)renameCat(c.old,c.n,ty)});
    const keepOld=new Set(out[ty].map(c=>c.old).filter(Boolean));const fallbackName=()=>{const l=out[ty];return (l.find(c=>c.k==="other")||l[l.length-1]).n};
    before[ty].forEach(c=>{if(!keepOld.has(c.n))renameCat(c.n,fallbackName(),ty)});
    st.cats[ty]=out[ty].map(c=>({n:c.n,k:c.k}))}
  st.budget={};out.expense.forEach(c=>st.budget[c.n]=c.amount||0);const tg={};out.saving.forEach(c=>tg[c.n]=c.amount||0);
  st.features=st.features||{};st.features.investSplit=$("investSplit").checked&&out.saving.some(c=>c.k==="investing");
  if(st.features.investSplit){st.invest={short:parseNum($("invShort").value)||0,long:parseNum($("invLong").value)||0};const ic=out.saving.filter(c=>c.k==="investing");if(ic.length){ic.forEach(c=>tg[c.n]=0);tg[ic[0].n]=st.invest.short+st.invest.long}}
  st.targets=tg;applyCats();fillFilterCats();fillCats();
  await persist();delete $("tab-settings").dataset.dirty;$("setHint").className="hint ok";$("setHint").textContent=t("Saved.");render()});
function renameCat(oldN,newN,ty){if(oldN===newN)return;
  allItems().forEach(({i})=>{if(i.type!==ty)return;if(i.cat===oldN)i.cat=newN;if(Array.isArray(i.parts))i.parts.forEach(p=>{if(p.cat===oldN)p.cat=newN})});
  recList().forEach(r=>{if(r.cat===oldN)r.cat=newN});const st=docs.settings;Object.keys(st.rules||{}).forEach(k=>{if(st.rules[k]===oldN)st.rules[k]=newN});
  goalList().forEach(g=>{if(g.src==="cat:"+oldN)g.src="cat:"+newN});
  if(st.budget&&oldN in st.budget){st.budget[newN]=(st.budget[newN]||0)+st.budget[oldN];delete st.budget[oldN]}if(st.targets&&oldN in st.targets){st.targets[newN]=(st.targets[newN]||0)+st.targets[oldN];delete st.targets[oldN]}}
// import preferences
$("setImport").addEventListener("change",()=>{ensureSettings().importPref={method:$("setImport").value};$("importHow").textContent=importHowTo($("setImport").value);persist()});
$("setOwn").addEventListener("change",()=>{ensureSettings().ownAccounts=[...new Set($("setOwn").value.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean))];persist()});
$("mapsReset").addEventListener("click",()=>{ensureSettings().csvMaps={};persist().then(()=>{fillSettings();toast(t("Saved column matches cleared."))})});
// child tracker
$("kOn").addEventListener("change",()=>{$("kFields").hidden=!$("kOn").checked;saveKids()});
["kName","kChild","kOther","kShare","kBal"].forEach(id=>$(id).addEventListener("change",saveKids));
function saveKids(){const st=ensureSettings();st.features=st.features||{};const old=st.features.child||{};const child=$("kChild").value.trim().slice(0,30);
  st.features.child={...old,on:$("kOn").checked,name:$("kName").value.trim().slice(0,40)||(child?t("{c} expenses",{c:child}):t("Child expenses")),child,other:$("kOther").value.trim().slice(0,30),share:+$("kShare").value,balance:$("kBal").checked,start:old.start||todayIso()};
  if(!$("kName").value.trim())$("kName").value=st.features.child.name;persist().then(()=>{fillFilterCats();fillCats();render()})}
// security
$("autoLock").addEventListener("change",()=>{ensureSettings().autoLock=Number($("autoLock").value);persist().then(armIdle)});
$("hideOpen").addEventListener("change",()=>{ensureSettings().hideOnOpen=$("hideOpen").checked;persist()});
$("backupEvery").addEventListener("change",()=>{ensureSettings().backupEvery=Number($("backupEvery").value);persist().then(render)});
$("rerunSetup").addEventListener("click",()=>{startWizard(true)});

/* ---------- backup / restore / CSV ---------- */
async function offerFile(name,blob){
  const file=new File([blob],name,{type:blob.type});
  if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:name});return true}catch(e){if(e&&e.name==="AbortError")return false}}
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);return true;
}
async function doBackup(){await saving;if(!key)return;const rec=await seal(stripDevice(docs),{pass:keys.pass});
  const fs=await fileAll();const ids=Object.keys(fs);if(ids.length){rec.files={};ids.forEach(id=>{const f=fs[id];rec.files[id]={iv:f.iv,ct:b64(f.ct),type:f.type}})}
  const ok=await offerFile("kc-ledger-backup-"+todayIso()+".json",new Blob([JSON.stringify(rec)],{type:"application/json"}));
  if(ok){ensureSettings().lastBackup=Date.now();await persist();$("backupHint").className="hint ok";$("backupHint").textContent=t("Backup saved. It opens with your current passcode.");render()}}
$("backupBtn").addEventListener("click",doBackup);
let pendingBackup=null;
$("restoreBtn").addEventListener("click",()=>$("restoreFile").click());
$("restoreFile").addEventListener("change",async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;
  try{const o=JSON.parse(await f.text());if(o.kind!=="kc-vault"||!o.ct)throw 0;pendingBackup=o;$("restoreWrap").hidden=false;$("restorePass").focus();$("backupHint").className="hint";$("backupHint").textContent=t("Restoring replaces everything on this device with the backup.")}
  catch(_){$("backupHint").className="hint err";$("backupHint").textContent=t("That file isn't a Kč Ledger backup.")}});
$("restoreCancel").addEventListener("click",()=>{pendingBackup=null;$("restoreWrap").hidden=true;$("restorePass").value="";$("backupHint").textContent=""});
$("restoreGo").addEventListener("click",async()=>{if(!pendingBackup)return;const h=$("backupHint");h.className="hint";h.textContent=t("Checking passcode…");const pass=$("restorePass").value;
  let o;try{o=await openWithPass(pendingBackup,pass)}catch(_){h.className="hint err";h.textContent=t("That passcode doesn't open this backup.");return}
  await saving;const files=pendingBackup.files||{};await fileClear();
  if(o.legacyKey){const src={};Object.keys(files).forEach(id=>src[id]={iv:files[id].iv,ct:unb64(files[id].ct).buffer,type:files[id].type});
    const u=await upgradeLegacy(o.legacyKey,pass,src);await startSession(u.raw,u.k,o.docs,u.keys)}
  else{for(const id of Object.keys(files))await filePut(id,{iv:files[id].iv,ct:unb64(files[id].ct).buffer,type:files[id].type});await startSession(o.raw,o.key,o.docs,{pass:pendingBackup.keys.pass})}
  await migrate();applyPrefs();await persist();pendingBackup=null;$("restoreWrap").hidden=true;$("restorePass").value="";
  h.className="hint ok";h.textContent=t("Backup restored. Its passcode is now this device's passcode. Turn Face ID back on below if you use it.");delete $("tab-settings").dataset.dirty;render()});
$("csvBtn").addEventListener("click",()=>{const rows=[["date","time","type","category","amount","currency","amount_"+baseCur().toLowerCase(),"one_off","child","note"]];
  allItems().forEach(({i})=>rows.push([i.date,i.time||"",i.type,i.parts?i.parts.map(p=>p.cat+" "+p.czk).join(" | "):i.cat,i.amount,i.cur,i.czk,i.oneoff?"yes":"",i.child?(100-(+i.child.share||0))+"/"+(+i.child.share||0):"",i.note||""]));
  const csv=rows.map(r=>r.map(v=>{v=String(v==null?"":v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}).join(",")).join("\n");
  offerFile("kc-ledger-"+todayIso()+".csv",new Blob([csv],{type:"text/csv"}));toast(t("This CSV is not encrypted. Delete it once you're done with it."))});

/* ---------- passcode change, erase ---------- */
$("passForm").addEventListener("submit",async e=>{e.preventDefault();const h=$("passHint");h.className="hint";
  const o=$("pOld").value,n=$("pNew").value;
  if(n.length<6){h.textContent=t("Use at least 6 characters.");h.className="hint err";return}
  if(n!==$("pNew2").value){h.textContent=t("The new passcodes don't match.");h.className="hint err";return}
  h.textContent=t("Checking…");await saving;
  try{const p=keys.pass;await unwrap(p,await passKey(o,unb64(p.salt),p.iter))}catch(_){h.textContent=t("Your current passcode isn't right.");h.className="hint err";return}
  keys.pass=await passWrap(rawKey,n);await persist();
  ["pOld","pNew","pNew2"].forEach(i=>$(i).value="");h.className="hint ok";h.textContent=t("Passcode changed. Older backups still open with the old passcode.")});
$("eraseBtn").addEventListener("click",async()=>{const b=$("eraseBtn");if(!b.classList.contains("confirm")){b.classList.add("confirm");b.textContent=t("Tap again to erase everything");setTimeout(()=>{b.classList.remove("confirm");b.textContent=t("Erase all data")},4000);return}
  await saving;await idbDel();await fileClear();lock();});

/* ---------- import ---------- */
async function readText(file){const buf=await file.arrayBuffer();let tx=new TextDecoder("utf-8").decode(buf);if(tx.indexOf("�")>=0){try{tx=new TextDecoder("windows-1250").decode(buf)}catch(_){}}return tx}
$("importBtn").addEventListener("click",()=>$("importFile").click());
$("importBtn2").addEventListener("click",()=>$("importFile").click());
$("importFile").addEventListener("change",async e=>{const files=[...e.target.files];e.target.value="";if(files.length&&key)await handleImport(files)});
const MAP_FIELDS=()=>[["date",t("Date"),true],["amount",t("Amount (with minus for money out)")],["out",t("Money out")],["inn",t("Money in")],["currency",t("Currency")],["name",t("Description or merchant"),true],["message",t("Message or note")],["counter",t("Other side's account number")],["own",t("Your account number")],["id",t("Transaction ID")],["time",t("Time")]];
function askMapping(pc,fileName){return new Promise(resolve=>{
  const map={...pc.guess};const sels={};const prev=el("div","map-preview");const hint=el("p","hint err");
  const colOpts=[["",t("— not in this file —")]].concat(pc.header.map((h,i)=>[String(i),h||t("Column {n}",{n:i+1})]));
  const fields=el("div","map-fields");
  MAP_FIELDS().forEach(([f,lab,req])=>{const s=selOf(colOpts,map[f]!=null?String(map[f]):"");sels[f]=s;s.addEventListener("change",()=>{if(s.value==="")delete map[f];else map[f]=+s.value;draw()});fields.appendChild(fld(lab+(req?" *":""),s))});
  const draw=()=>{prev.replaceChildren();let its=[];try{its=KCImport.previewRows(pc,map,6)}catch(_){}
    if(!its.length){prev.appendChild(el("p","small muted",t("No rows could be read with these choices yet.")));return}
    const ul=el("ul","ledger");its.forEach(i=>{const li=el("li");li.append(el("span","d",dDay(i.date)),el("div","",i.note||"—"),el("div","a amt",(i.type==="income"?"+":"−")+fmtCur(i.amount,i.cur)));ul.appendChild(li)});prev.appendChild(ul)};
  const remember=chk(t("Remember this for files from this bank"),true);
  const ok=el("button","primary",t("Import"));const cancel=el("button","icon-btn",t("Skip this file"));const row=el("div","btnrow");row.append(ok,cancel);let done=false;
  ok.addEventListener("click",()=>{if(map.date==null||map.name==null||(map.amount==null&&map.out==null&&map.inn==null)){hint.textContent=t("Choose at least the date, the amount and the description.");return}
    done=true;if(remember.input.checked){const st=ensureSettings();st.csvMaps=st.csvMaps||{};st.csvMaps[pc.sig]=map}sheetClosed=null;closeSheet();resolve({...map})});
  cancel.addEventListener("click",()=>{done=true;sheetClosed=null;closeSheet();resolve(null)});
  sheetClosed=()=>{if(!done)resolve(null)};
  openSheet(t("Check the columns"),[el("p","small",t("{f}: Kč Ledger matched these columns. Check them against the preview, then import.",{f:fileName})),fields,el("h3","",t("Preview")),prev,remember,row,hint]);draw();
})}
async function handleImport(files){
  const st=ensureSettings();const own=new Set(st.ownAccounts||[]);const have=allIds();
  let added=0,dupes=0,transfers=0,bad=0,merged=0,noRate=0,starter=false,setupApplied=false;const csvs=[];
  for(const f of files){const tx=await readText(f);
    if(/^\s*\{/.test(tx)){try{const o=JSON.parse(tx);
      if(o.kind==="kc-starter"&&o.docs){starter=true;const sd=o.docs;
        if(sd.settings){const c2=ensureSettings();["budget","targets","rates"].forEach(x=>{if(sd.settings[x]&&!Object.keys(c2[x]||{}).length)c2[x]=sd.settings[x]});
          (sd.settings.ownAccounts||[]).forEach(a=>own.add(a));c2.rules={...(sd.settings.rules||{}),...(c2.rules||{})}}
        Object.keys(sd).filter(k=>/^m-\d{4}-\d{2}$/.test(k)).forEach(k=>{(sd[k].items||[]).forEach(i=>{if(have.has(i.id)){dupes++;return}have.add(i.id);(docs[k]=docs[k]||{items:[]}).items=items(k).concat(i);added++})});
        if(sd.accounts&&!(docs.accounts&&docs.accounts.list&&docs.accounts.list.length))docs.accounts=sd.accounts;
        if(sd.settings){const c3=ensureSettings();if(sd.settings.invest&&(!c3.invest||c3.invest.seeded))c3.invest={short:+sd.settings.invest.short||0,long:+sd.settings.invest.long||0};
          if(Array.isArray(sd.settings.salaryWords))c3.salaryWords=[...new Set([...(c3.salaryWords||[]),...sd.settings.salaryWords])];if(sd.settings.salaryWords||sd.settings.invest)setupApplied=true}
        if(sd.recurring&&Array.isArray(sd.recurring.list)){docs.recurring=docs.recurring||{list:[]};sd.recurring.list.forEach(r=>{const ex=docs.recurring.list.find(x=>x.name===r.name);
          if(!ex)docs.recurring.list.push({...r,id:uid("r"),start:todayIso()});else if(ex.seeded){Object.assign(ex,{time:r.time||ex.time,day:r.day||ex.day});delete ex.seeded}});setupApplied=true}
        if(sd.goals&&Array.isArray(sd.goals.list)){docs.goals=docs.goals||{list:[]};sd.goals.list.forEach(g=>{const ex=docs.goals.list.find(x=>x.name===g.name);if(!ex)docs.goals.list.push({...g,id:uid("g")});else if(ex.seeded){Object.assign(ex,{...g,id:ex.id});delete ex.seeded}else if(!ex.target&&g.target)ex.target=g.target});setupApplied=true}
        if(Array.isArray(sd.oneoff)){const ids=new Set(sd.oneoff);monthKeys().forEach(k=>{docs[k].items=items(k).map(i=>ids.has(i.id)?{...i,oneoff:true}:i)});setupApplied=true}
      }else if(o.kind==="kc-vault"){toast(t("That's a backup. Use Restore a backup instead."));return}else bad++}catch(_){bad++}}
    else csvs.push({name:f.name,text:tx})}
  // work out each file's format and columns
  const jobs=[];
  for(const c of csvs){const pc=KCImport.sniff(c.text);
    if(pc.format==="rb"){jobs.push({pc,rb:true,text:c.text});continue}
    let map=(st.csvMaps||{})[pc.sig];if(!map&&(pc.format==="revolut"||pc.format==="wise"))map=pc.guess;
    if(!map){if(!pc.header.length||pc.rows.length<2){bad++;continue}map=await askMapping(pc,c.name);if(!map){bad++;continue}}
    jobs.push({pc,map})}
  // learn every account in this batch first, so transfers between them are left out
  jobs.forEach(j=>{if(j.rb){const r=rbParseCSV(j.text);const ix=r[0]?r[0].indexOf("Account number"):-1;if(ix>=0)r.slice(1).forEach(x=>x[ix]&&own.add(x[ix]))}else KCImport.ownAccountsIn(j.pc,j.map).forEach(a=>own.add(a))});
  const s=settings();const emergency=catList("saving").find(c=>c.k==="emergency");
  const opts={ownAccounts:[...own],emergencyTarget:emergency?s.targets[emergency.n]:0,rules:st.rules||{},salaryWords:st.salaryWords||[],base:baseCur()};
  const incoming=[];
  jobs.forEach(j=>{const res=j.rb?rbToItems(j.text,opts):KCImport.convert(j.pc,j.map,{...opts,format:j.pc.format});if(res.error){bad++;return}transfers+=res.skipped||0;incoming.push(...res.items)});
  incoming.forEach(i=>{if(have.has(i.id)){dupes++;return}
    if(i.cat&&!catsOf(i.type).includes(i.cat)){const ty=typeOfCat(i.cat);if(catsOf(ty).includes(i.cat))i.type=ty;else delete i.cat}
    if(!i.cat)i.cat=catOfKind(i.kind||"other",i.type);delete i.kind;
    const c=i.cur||baseCur();
    if(c===baseCur()){if(i.czk==null)i.czk=Math.round(i.amount*100)/100}
    else{const r=rateOf(c);if(!r){noRate++;return}i.czk=Math.round(i.amount*r*100)/100;i.orig=i.orig||(i.amount+" "+c)}
    have.add(i.id);i.ts=Date.now();
    const at=findAutoTwin(i);if(at){i.cat=at.it.cat;if(at.it.att)i.att=at.it.att;if(at.it.child)i.child=at.it.child;docs[at.k].items=items(at.k).filter(x=>x.id!==at.it.id);(docs.autoSkip=docs.autoSkip||{})[at.it.id]=1;merged++}
    const tw=at?null:findShotTwin(i);if(tw){i.cat=tw.it.cat;if(tw.it.parts)i.parts=tw.it.parts;if(tw.it.oneoff)i.oneoff=true;if(tw.it.att)i.att=tw.it.att;if(tw.it.child)i.child=tw.it.child;docs[tw.k].items=items(tw.k).filter(x=>x.id!==tw.it.id);merged++}
    const k="m-"+i.date.slice(0,7);(docs[k]=docs[k]||{items:[]}).items=items(k).concat(i);added++});
  st.ownAccounts=[...own];
  if(!added&&!dupes&&!setupApplied&&bad){toast(t("Those files couldn't be read as bank exports."));return}
  if(starter)await migrate();if(setupApplied)await runAuto();
  await persist();applyCats();render();
  if(setupApplied&&!added&&!dupes&&!csvs.length){toast(t("Your setup was applied. Delete the setup file from your device."));return}
  toast((starter?t("Starter loaded.")+" ":"")+t("Added {n} {e}",{n:added,e:pl(added,"entry")})+(dupes?", "+t("{n} already here",{n:dupes}):"")+(transfers?", "+t("{n} left out (transfers between your accounts or unfinished payments)",{n:transfers}):"")+(merged?", "+t("{n} matched to automatic or screenshot entries",{n:merged}):"")+(noRate?". "+t("{n} skipped: set their currency's exchange rate first",{n:noRate}):"")+".");
}

/* ---------- images: compressed, encrypted, stored apart from the ledger ---------- */
async function shrink(file,maxSide){
  let bmp;try{bmp=await createImageBitmap(file)}catch(_){const url=URL.createObjectURL(file);bmp=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=url})}
  const w=bmp.width,h=bmp.height,sc=Math.min(1,maxSide/Math.max(w,h));const c=document.createElement("canvas");c.width=Math.round(w*sc);c.height=Math.round(h*sc);
  c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);return new Promise(res=>c.toBlob(b=>res(b),"image/jpeg",.82));
}
async function storeImage(file){if(!key)throw new Error("locked");const blob=await shrink(file,1600);const bytes=await blob.arrayBuffer();const id=uid("img-");await filePut(id,{...(await encBytes(key,bytes)),type:"image/jpeg"});return id}
async function imageDataUrl(id){const rec=await fileGet(id);if(!rec)return null;const bytes=await decBytes(key,rec);return new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(new Blob([bytes],{type:rec.type||"image/jpeg"}))})}
function refs(){const n={};allItems().forEach(({i})=>(i.att||[]).forEach(a=>n[a]=(n[a]||0)+1));kidExtra().forEach(x=>(x.att||[]).forEach(a=>n[a]=(n[a]||0)+1));return n}
async function dropUnused(ids){if(!ids||!ids.length)return;const n=refs();for(const id of ids)if(!n[id])await fileDel(id)}
let attachTarget=null;
function pickAttach(k,id,fromSheet){attachTarget={k,id,fromSheet};$("attachFile").click()}
$("attachFile").addEventListener("change",async e=>{const f=e.target.files[0];e.target.value="";if(!f||!attachTarget||!key)return;const tg=attachTarget;attachTarget=null;
  try{const id=await storeImage(f);if(tg.cb){tg.cb(id);return}let nk=tg.k;if(!items(nk).some(x=>x.id===tg.id)){const f2=allItems().find(x=>x.i.id===tg.id);nk=f2&&f2.k}if(!nk)return;
    docs[nk].items=items(nk).map(x=>x.id===tg.id?{...x,att:(x.att||[]).concat(id)}:x);await persist();toast(t("Image attached"));render();if(tg.fromSheet){closeSheet();openEditor(nk,tg.id)}}
  catch(_){toast(t("Couldn't attach that image."))}});
$("fReceipt").addEventListener("change",()=>{const f=$("fReceipt").files[0];$("fReceiptName").textContent=f?f.name:""});
$("fReceiptBtn").addEventListener("click",()=>$("fReceipt").click());
let viewUrl=null,viewing=null;
async function openViewer(k,i,idx){
  const ids=i.att||[];if(!ids.length)return;idx=(idx+ids.length)%ids.length;viewing={k,id:i.id,idx};
  const rec=await fileGet(ids[idx]);if(!rec){toast(t("That image is missing on this device."));return}
  const bytes=await decBytes(key,rec);if(viewUrl)URL.revokeObjectURL(viewUrl);viewUrl=URL.createObjectURL(new Blob([bytes],{type:rec.type||"image/jpeg"}));
  $("viewImg").src=viewUrl;$("viewCap").textContent=(i.note||i.cat||"")+" · "+fmt(i.czk)+(ids.length>1?"  ("+(idx+1)+" / "+ids.length+")":"");
  $("viewNext").hidden=ids.length<2;$("viewDel").textContent=t("Remove image");$("viewDel").classList.remove("confirm");$("viewDel").hidden=!k;$("viewer").hidden=false;
}
function closeViewer(){$("viewer").hidden=true;$("viewImg").removeAttribute("src");if(viewUrl){URL.revokeObjectURL(viewUrl);viewUrl=null}viewing=null}
$("viewClose").addEventListener("click",closeViewer);
$("viewNext").addEventListener("click",()=>{if(!viewing)return;const it=viewing.k?items(viewing.k).find(x=>x.id===viewing.id):kidExtra().find(x=>x.id===viewing.id);if(it)openViewer(viewing.k,it,viewing.idx+1)});
$("viewDel").addEventListener("click",async()=>{const b=$("viewDel");if(!viewing||!viewing.k)return;if(!b.classList.contains("confirm")){b.classList.add("confirm");b.textContent=t("Tap again to remove");return}
  const v=viewing,it=items(v.k).find(x=>x.id===v.id);if(!it)return;const gone=it.att[v.idx];
  docs[v.k].items=items(v.k).map(x=>x.id===v.id?{...x,att:x.att.filter(a=>a!==gone)}:x);await persist();await dropUnused([gone]);closeViewer();toast(t("Image removed"));
  if(!$("sheet").hidden){closeSheet();openEditor(v.k,v.id)}render()});

/* ---------- read transactions from a screenshot (on this device) ---------- */
let ocrWorker=null;
function loadScript(src,check){return new Promise((res,rej)=>{if(check&&check())return res();const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=()=>rej(new Error("load"));document.head.appendChild(s)})}
async function getOcr(progress){
  if(ocrWorker)return ocrWorker;progress(t("Loading text recognition (first time only)…"),0);await loadScript("ocr/tesseract.min.js",()=>window.Tesseract);
  ocrWorker=await Tesseract.createWorker(["eng","ces"],1,{workerPath:"ocr/worker.min.js",corePath:"ocr/",langPath:"ocr",gzip:true,workerBlobURL:false,cacheMethod:"none",
    logger:m=>{if(m.status==="recognizing text")progress(t("Reading text…"),m.progress);else if(/load/.test(m.status||""))progress(t("Loading text recognition (first time only)…"),m.progress||0)}});
  return ocrWorker;
}
const MONTHS={led:1,jan:1,"úno":2,uno:2,feb:2,"bře":3,bre:3,mar:3,dub:4,apr:4,"kvě":5,kve:5,may:5,jun:6,jul:7,srp:8,aug:8,"zář":9,zar:9,sep:9,"říj":10,rij:10,oct:10,okt:10,lis:11,nov:11,pro:12,dec:12};
function monthFrom(word){word=word.toLowerCase();if(/^července|^cervenc|^červenc/.test(word))return 7;if(/^červ|^cerv/.test(word))return 6;for(const k of Object.keys(MONTHS).sort((a,b)=>b.length-a.length))if(word.startsWith(k))return MONTHS[k];return 0}
function findDate(line){
  const tday=new Date();let m;
  if(/\b(dnes|today)\b/i.test(line))return iso(tday);
  if(/\b(včera|vcera|yesterday)\b/i.test(line)){tday.setDate(tday.getDate()-1);return iso(tday)}
  if((m=line.match(/\b(\d{1,2})\s?\.\s?(\d{1,2})\s?\.\s?(\d{4}|\d{2})?\b/))){const d=+m[1],mo=+m[2];let y=m[3]?+m[3]:tday.getFullYear();if(y<100)y+=2000;if(d>=1&&d<=31&&mo>=1&&mo<=12){let dt=new Date(y,mo-1,d);if(!m[3]&&dt>tday)dt=new Date(y-1,mo-1,d);return iso(dt)}}
  if((m=line.match(/\b(\d{1,2})\.?\s+([A-Za-zÀ-ž]{3,})\b(?:\s+(\d{4}))?/))){const mo=monthFrom(m[2]);if(mo){const y=m[3]?+m[3]:tday.getFullYear();let dt=new Date(y,mo-1,+m[1]);if(!m[3]&&dt>tday)dt=new Date(y-1,mo-1,+m[1]);return iso(dt)}}
  return null;
}
const AMT=/([+\-−–]?)\s?((?:\d{1,3}(?:[  .']\d{3})+|\d+)(?:,\d{1,2}|\.\d{2})?)\s?(Kč|Kc|CZK|EUR|€|AUD|A\$|USD|\$|GBP|£)?/g;
function amountsIn(line){
  const out=[];let m;AMT.lastIndex=0;
  while((m=AMT.exec(line))){const raw=m[2];const hasDec=/[,.]\d{1,2}$/.test(raw)&&!/^\d{1,3}\.\d{3}$/.test(raw);const c2=m[3];const sign=m[1];
    if(!c2&&!sign&&!hasDec)continue;
    let num=raw.replace(/[  ']/g,"");if(/,\d{1,2}$/.test(num))num=num.replace(/\./g,"").replace(",",".");else if(/\.\d{3}$/.test(num)||/\.\d{3}\./.test(num))num=num.replace(/\./g,"");
    const v=parseFloat(num);if(!isFinite(v)||v===0||v>10000000)continue;
    out.push({v,sign:sign?(sign==="+"?1:-1):0,cur:c2?(/eur|€/i.test(c2)?"EUR":/aud|a\$/i.test(c2)?"AUD":/usd|\$/i.test(c2)?"USD":/gbp|£/i.test(c2)?"GBP":"CZK"):null,idx:m.index,len:m[0].length})}
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
    return {kind:"receipt",rows:[{date:date||today,name,amount:best.v,cur:best.cur||baseCur(),type:"expense"}]}}
  let date=null;const used=new Set();
  lines.forEach((l,ix)=>{
    const d=findDate(l);const am=amountsIn(l);if(d&&!am.length){date=d;return}if(!am.length)return;
    if(/zůstatek|zustatek|balance|dostupn|available|limit/i.test(l))return;
    const a=am[am.length-1];let name=cleanName(l.slice(0,a.idx).replace(/\b\d{1,2}[:.]\d{2}\b/g,""));
    if(letters(name)<3||NOISE.test(name)){name="";for(let j=ix-1;j>=0&&j>=ix-3;j--){const c=lines[j];if(used.has(j)||amountsIn(c).length)break;if(findDate(c)&&letters(c.replace(/\d/g,""))<6)continue;if(letters(c)>=3&&!NOISE.test(c)){name=cleanName(c);used.add(j);break}}}
    const below=lines[ix+1]||"";const incoming=/příchozí|prichozi|incoming|received|připsáno/i.test(l+" "+below);
    found.push({date:d||date||today,name:name||"Unknown",amount:a.v,cur:a.cur||baseCur(),type:a.sign>0||incoming?"income":"expense"});
  });
  return {kind:"list",rows:found};
}
function guessCat(name,ty){
  if(ty==="income")return catOfKind(KCImport.incomeKind(name,(docs.settings||{}).salaryWords),"income");
  if(ty==="saving")return catOfKind(/invest/i.test(name)?"investing":"emergency","saving");
  const rules=(docs.settings||{}).rules||{};const k=rbKey(name,"");if(rules[k]&&EXP_CATS.includes(rules[k]))return rules[k];
  if(/\brent\b|nájem|najem/i.test(name))return catOfKind("rent","expense");
  return catOfKind(kindFromText(name)||"other","expense");
}
let shotFile=null;
function closeReview(){$("shotPanel").hidden=true;$("shotRows").replaceChildren();shotFile=null;if($("shotPreview").src)URL.revokeObjectURL($("shotPreview").src);$("shotPreview").removeAttribute("src")}
function progress(msg,p){$("shotStatus").textContent=msg+(p>0&&p<1?" "+Math.round(p*100)+" %":"")}
$("shotBtn").addEventListener("click",()=>$("shotFile").click());
$("shotFile").addEventListener("change",async e=>{const f=e.target.files[0];e.target.value="";if(!f||!key)return;
  closeReview();shotFile=f;$("shotPanel").hidden=false;$("shotPreview").src=URL.createObjectURL(f);$("shotActions").hidden=true;$("shotRawWrap").hidden=true;
  $("shotPanel").scrollIntoView({behavior:"smooth",block:"start"});
  try{const w=await getOcr(progress);progress(t("Reading text…"),0);const {data}=await w.recognize(f);if(!key||shotFile!==f)return;
    const res=parseShot(data.text||"");$("shotRaw").textContent=data.text||"";$("shotRawWrap").hidden=false;
    buildReview(res.rows.length?res.rows:[{date:todayIso(),name:"",amount:"",cur:baseCur(),type:"expense"}],res);
  }catch(err){progress(t("Couldn't read that image. You can still enter the details below and keep the screenshot."),0);buildReview([{date:todayIso(),name:"",amount:"",cur:baseCur(),type:"expense"}],{kind:"none",rows:[]})}
});
function buildReview(rows,res){
  const box=$("shotRows");box.replaceChildren();
  progress(res.rows.length?(res.kind==="receipt"?t("Found a receipt total. Check it, then save."):t("Found {n} {w}. Untick any that are wrong or already in your ledger.",{n:res.rows.length,w:pl(res.rows.length,"transaction")})):t("No amounts found. Enter the details yourself and keep the screenshot."),0);
  const have=allItems().map(x=>x.i);
  rows.forEach((r,ix)=>{
    const row=el("div","shot-row");const top=el("div","shot-top");
    const cb=el("input");cb.type="checkbox";cb.checked=true;cb.id="sr"+ix+"_on";cb.setAttribute("aria-label",t("Include"));
    const nm=el("input");nm.value=r.name;nm.placeholder=t("Merchant or description");nm.id="sr"+ix+"_nm";nm.setAttribute("aria-label",t("Description"));top.append(cb,nm);
    const grid=el("div","shot-grid");const dt=el("input");dt.type="date";dt.value=r.date;dt.setAttribute("aria-label",t("Date"));
    const amt=el("input","amt");amt.inputMode="decimal";amt.value=r.amount===""?"":String(r.amount).replace(".",",");amt.setAttribute("aria-label",t("Amount"));
    const cu=el("select");curOptions([r.cur]).forEach(c=>cu.appendChild(el("option","",c)));cu.value=r.cur;cu.setAttribute("aria-label",t("Currency"));
    const ty=el("select");[["expense",t("Spent")],["income",t("Income")],["saving",t("Saved")]].forEach(([v,tx])=>{const o=el("option","",tx);o.value=v;ty.appendChild(o)});ty.value=r.type;ty.setAttribute("aria-label",t("Type"));
    const cat=el("select");cat.setAttribute("aria-label",t("Category"));
    const fillC=()=>{const list=catsOf(ty.value);const g=guessCat(nm.value,ty.value);cat.replaceChildren(...list.map(c=>el("option","",c)));cat.value=list.includes(g)?g:list[0]};
    fillC();ty.addEventListener("change",fillC);nm.addEventListener("change",fillC);grid.append(dt,amt,cu,ty,cat);
    const warn=el("div","shot-warn");
    const dupe=have.find(h=>h.type===r.type&&Math.abs((Number(h.czk)||0)-r.amount)<0.01&&Math.abs(dOf(h.date)-dOf(r.date))<=3*DAY);
    if(dupe&&r.amount!==""){warn.textContent=t("Looks like it's already in your ledger ({n}, {d}). Unticked.",{n:dupe.note||dupe.cat,d:dShort(dupe.date)});cb.checked=false}
    row.append(top,grid,warn);row._get=()=>({on:cb.checked,name:nm.value.trim(),date:dt.value,amount:parseNum(amt.value),cur:cu.value,type:ty.value,cat:cat.value});box.appendChild(row)});
  $("shotActions").hidden=false;
}
$("shotAddRow").addEventListener("click",()=>{const rows=[...$("shotRows").children].map(r=>r._get());buildReview(rows.map(r=>({...r,amount:isNaN(r.amount)?"":r.amount})).concat([{date:todayIso(),name:"",amount:"",cur:baseCur(),type:"expense"}]),{kind:"list",rows:[1]})});
$("shotCancel").addEventListener("click",closeReview);
$("shotSave").addEventListener("click",async()=>{if(!key)return;
  const rows=[...$("shotRows").children].map(r=>r._get()).filter(r=>r.on);
  for(const r of rows){if(!(r.amount>0)){toast(t("Each ticked row needs an amount above zero."));return}if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)){toast(t("Each ticked row needs a date."));return}if(!rateOf(r.cur)){toast(t("Set the {c} exchange rate in Settings first.",{c:r.cur}));return}}
  if(!rows.length){toast(t("Tick at least one row to save."));return}
  $("shotSave").disabled=true;
  try{let attId=null;if($("shotKeep").checked&&shotFile)attId=await storeImage(shotFile);
    rows.forEach(r=>{const k="m-"+r.date.slice(0,7);const it={id:uid("ss-"),type:r.type,cat:r.cat,amount:r.amount,cur:r.cur,czk:Math.round(r.amount*rateOf(r.cur)*100)/100,note:(r.name||t("Screenshot entry")).slice(0,80),date:r.date,ts:Date.now(),src:"shot",key:rbKey(r.name,"")};
      if(r.cur!==baseCur())it.orig=r.amount+" "+r.cur;if(attId)it.att=[attId];(docs[k]=docs[k]||{items:[]}).items=items(k).concat(it)});
    await persist();closeReview();toast(t("Saved {n} {e}",{n:rows.length,e:pl(rows.length,"entry")})+(attId?" "+t("with the screenshot"):""));render();
  }catch(_){toast(t("Couldn't save. Try again."))}finally{$("shotSave").disabled=false}
});
function findShotTwin(i){for(const {k,i:x} of allItems())if(x.src==="shot"&&x.type===i.type&&Math.abs((Number(x.czk)||0)-i.czk)<0.01&&Math.abs(dOf(x.date)-dOf(i.date))<=3*DAY)return {k,it:x};return null}

/* ---------- end-to-end encrypted sync through a private GitHub repository ----------
   The ledger is encrypted with the data key before upload; the access token lives only inside this
   device's encrypted vault (docs._device) and is never synced or included in backups. */
let syncT=null,pendingJoin=null;
const syncCfg=()=>((docs._device||{}).sync)||null;
function syncSoon(ms){clearTimeout(syncT);if(key&&syncCfg())syncT=setTimeout(()=>syncNow(false),ms)}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&key){runAuto().then(n=>{if(n)persist().then(render)});syncSoon(500)}});
addEventListener("online",()=>syncSoon(500));
async function gh(cfg,method,path,body){
  const r=await fetch("https://api.github.com/repos/"+cfg.repo+path,{method,cache:"no-store",referrerPolicy:"no-referrer",credentials:"omit",
    headers:Object.assign({Authorization:"Bearer "+cfg.token,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},body?{"Content-Type":"application/json"}:{}),body:body?JSON.stringify(body):undefined});
  if(r.status===404&&method==="GET")return null;
  if(!r.ok){const e=new Error("github "+r.status);e.status=r.status;throw e}
  return r.status===204?null:r.json();
}
async function ghGetFile(cfg,path){const j=await gh(cfg,"GET","/contents/"+path);if(!j)return null;let c=j.content;
  if(!c||j.encoding==="none"){const bl=await gh(cfg,"GET","/git/blobs/"+j.sha);c=bl.content}
  return {sha:j.sha,text:td.decode(unb64(String(c).replace(/\s/g,"")))}}
const ghPut=(cfg,path,text,sha)=>gh(cfg,"PUT","/contents/"+path,Object.assign({message:"Kč Ledger sync",content:b64(te.encode(text))},sha?{sha}:{}));
// stable JSON for comparisons
function canon(v){if(Array.isArray(v))return "["+v.map(canon).join(",")+"]";if(v&&typeof v==="object")return "{"+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+":"+canon(v[k])).join(",")+"}";return JSON.stringify(v)}
const isObj=v=>v&&typeof v==="object"&&!Array.isArray(v);
const monthsOf=d=>Object.keys(d||{}).filter(k=>/^m-\d{4}-\d{2}$/.test(k));
function flatItems(d){const m={};monthsOf(d).forEach(k=>((d[k]||{}).items||[]).forEach(i=>{if(i&&i.id)m[i.id]=canon(i)}));return m}
function mergeVal(b,l,r,depth){
  const cb=canon(b),cl=canon(l),cr=canon(r);
  if(cl===cr)return l;if(cl===cb)return r;if(cr===cb)return l;
  if(Array.isArray(l)&&Array.isArray(r)&&l.concat(r).every(x=>isObj(x)&&x.id))return mergeList(Array.isArray(b)?b:[],l,r);
  if(isObj(l)&&isObj(r)&&depth<4){const o={};const ks=new Set([...Object.keys(l),...Object.keys(r),...Object.keys(isObj(b)?b:{})]);
    ks.forEach(k=>{const v=mergeVal(isObj(b)?b[k]:undefined,l[k],r[k],depth+1);if(v!==undefined)o[k]=v});return o}
  return l!==undefined?l:r;
}
function mergeList(b,l,r){const by=a=>Object.fromEntries(a.map(x=>[x.id,x]));const B=by(b),L=by(l),R=by(r);const order=[...l.map(x=>x.id),...r.map(x=>x.id).filter(id=>!(id in L))];
  const out=[];order.forEach(id=>{const v=mergeVal(B[id],L[id],R[id],1);if(v!==undefined)out.push(v)});return out}
function mergeDocs(B,L,R){
  B=B||{};const out={};let conflicts=0;
  const fb=flatItems(B),fl=flatItems(L),fr=flatItems(R);const ids=new Set([...Object.keys(fl),...Object.keys(fr)]);const all=[];
  ids.forEach(id=>{const b=fb[id],l=fl[id],r=fr[id];let pick;
    if(l===r)pick=l;else if(l===b)pick=r;else if(r===b)pick=l;
    else if(l&&r){pick=l;const ri=JSON.parse(r);ri.id=id+"~"+uid("").slice(-5);ri.conflict=true;all.push(ri);conflicts++}
    else pick=l||r;
    if(pick)all.push(JSON.parse(pick))});
  all.forEach(i=>{const k="m-"+String(i.date).slice(0,7);(out[k]=out[k]||{items:[]}).items.push(i)});
  const keysAll=new Set([...Object.keys(L),...Object.keys(R)].filter(k=>!/^m-\d{4}-\d{2}$/.test(k)&&k!=="_device"));
  keysAll.forEach(k=>{const v=mergeVal(B[k],L[k],R[k],0);if(v!==undefined)out[k]=v});
  return {docs:out,conflicts};
}
function setSyncUI(){
  const c=syncCfg();$("syncSetup").hidden=!!c||!!pendingJoin;$("syncOn").hidden=!c||!!pendingJoin;$("syncJoin").hidden=!pendingJoin;
  const pill=$("syncPill");if(!c){pill.className="pill";pill.textContent=t("Off")}
  else if(c.error){pill.className="pill bad";pill.textContent=t("Needs attention")}
  else{pill.className="pill ok";pill.textContent=t("On")}
  if(c)$("syncInfo").textContent=t("Syncing with {r}.",{r:c.repo})+" "+(c.last?t("Last synced {d}.",{d:new Date(c.last).toLocaleString(LOC(),{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}):t("Not synced yet."))+(c.error?" "+c.error:"");
}
function syncError(e){
  if(!e)return "";if(e.status===401)return t("GitHub rejected the access token. It may have expired: make a new one and connect again.");
  if(e.status===403||e.status===404)return t("The token can't reach that repository. Check the name and that the token has read and write access to its contents.");
  if(e.message==="public")return t("That repository is public. Make it private on GitHub first.");
  return t("Couldn't reach GitHub. It will try again when you're online.");
}
async function uploadImages(cfg,refsNow){
  let listing=[];try{listing=(await gh(cfg,"GET","/contents/img"))||[]}catch(e){if(e.status!==404)throw e}
  const remote=Object.fromEntries((Array.isArray(listing)?listing:[]).map(f=>[f.name.replace(/\.json$/,""),f.sha]));
  const local=await fileAll();
  for(const id of Object.keys(refsNow)){
    if(local[id]&&!remote[id]){const f=local[id];await ghPut(cfg,"img/"+id+".json",JSON.stringify({iv:f.iv,ct:b64(f.ct),type:f.type}))}
    else if(!local[id]&&remote[id]){const g=await ghGetFile(cfg,"img/"+id+".json");if(g){const o=JSON.parse(g.text);await filePut(id,{iv:o.iv,ct:unb64(o.ct).buffer,type:o.type})}}
  }
  for(const id of Object.keys(remote))if(!refsNow[id])await gh(cfg,"DELETE","/contents/img/"+id+".json",{message:"Kč Ledger sync",sha:remote[id]});
  for(const id of Object.keys(local))if(!refsNow[id])await fileDel(id);
}
async function syncNow(manual){
  const cfg=syncCfg();if(!cfg||!key||inSync||pendingJoin)return;
  if(!navigator.onLine){if(manual)toast(t("You're offline. Sync will run when you're back online."));return}
  inSync=true;const h=$("syncHint");if(manual){h.className="hint";h.textContent=t("Syncing…")}
  try{
    for(let attempt=0;attempt<4;attempt++){
      await saving;const remoteFile=await ghGetFile(cfg,"vault.json");let remoteDocs=null,remoteRec=null;
      if(remoteFile){remoteRec=JSON.parse(remoteFile.text);
        try{remoteDocs=await openBody(key,remoteRec)}catch(_){pendingJoin={rec:remoteRec};setSyncUI();h.className="hint";h.textContent="";showTab("settings");setTimeout(()=>$("syncPanel").scrollIntoView({behavior:"smooth"}),60);return}}
      const local=stripDevice(docs);const base=(docs._device||{}).base||null;
      const merged=remoteDocs?mergeDocs(base,local,remoteDocs):{docs:local,conflicts:0};
      // a passcode changed on another device carries over (same data key underneath)
      let kp=keys.pass;if(remoteRec&&remoteRec.keys&&remoteRec.keys.pass&&(remoteRec.keys.pass.ts||0)>(kp.ts||0))kp=remoteRec.keys.pass;
      const passChanged=kp!==keys.pass;keys.pass=kp;
      const changedRemote=!remoteDocs||canon(merged.docs)!==canon(remoteDocs)||(remoteRec.keys.pass.ts||0)!==(kp.ts||0);
      const n=refsOf(merged.docs);await uploadImages(cfg,n);
      if(changedRemote){const rec=await seal(merged.docs,{pass:kp});rec.kind="kc-sync";
        try{await ghPut(cfg,"vault.json",JSON.stringify(rec),remoteFile&&remoteFile.sha)}catch(e){if(e.status===409||e.status===422)continue;throw e}}
      const dev=docs._device;docs=merged.docs;docs._device=dev;dev.base=JSON.parse(JSON.stringify(merged.docs));dev.sync.last=Date.now();delete dev.sync.error;await runAuto();await migrate();applyCats();fillFilterCats();fillCats();
      await persist();render();setSyncUI();
      if(manual||merged.conflicts||passChanged){h.className="hint ok";h.textContent=t("Synced.")+(merged.conflicts?" "+t("{n} {e} edited on both devices; both versions are kept and marked.",{n:merged.conflicts,e:pl(merged.conflicts,"entry")}):"")+(passChanged?" "+t("Your passcode was changed on another device, so use that one from now on."):"")}
      return;
    }
    throw new Error("busy");
  }catch(e){const c=syncCfg();if(c){c.error=syncError(e);await persist()}h.className="hint err";h.textContent=syncError(e);setSyncUI()}
  finally{inSync=false}
}
function refsOf(d){const n={};monthsOf(d).forEach(k=>((d[k]||{}).items||[]).forEach(i=>(i.att||[]).forEach(a=>n[a]=1)));(((d.child||{}).items)||[]).forEach(x=>(x.att||[]).forEach(a=>n[a]=1));return n}
$("syncConnect").addEventListener("click",async()=>{
  const h=$("syncHint");h.className="hint err";const repo=$("syncRepo").value.trim().replace(/^https?:\/\/github\.com\//,"").replace(/\/$/,"");const token=$("syncToken").value.trim();
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo)){h.textContent=t("Enter the repository as owner/name, for example your-username/ledger-data.");return}
  if(!token){h.textContent=t("Paste your access token.");return}
  h.className="hint";h.textContent=t("Checking the repository…");
  try{const info=await gh({repo,token},"GET","");if(!info)throw Object.assign(new Error("x"),{status:404});if(!info.private)throw new Error("public");
    docs._device=docs._device||{};docs._device.sync={repo,token};delete docs._device.base;$("syncToken").value="";await persist();setSyncUI();h.textContent="";await syncNow(true);
  }catch(e){h.className="hint err";h.textContent=syncError(e)}
});
$("syncNow").addEventListener("click",()=>syncNow(true));
$("syncOff").addEventListener("click",async()=>{const b=$("syncOff");if(b.textContent!==t("Tap again to disconnect")){b.textContent=t("Tap again to disconnect");return}
  b.textContent=t("Disconnect this device");delete docs._device;await persist();setSyncUI();$("syncHint").className="hint";$("syncHint").textContent=t("This device no longer syncs. Its data stays here, and the copy on GitHub is untouched.")});
$("syncJoinCancel").addEventListener("click",async()=>{pendingJoin=null;delete docs._device;await persist();setSyncUI();$("syncHint").textContent=t("Not connected.")});
$("syncJoinGo").addEventListener("click",async()=>{if(!pendingJoin)return;const h=$("syncHint");h.className="hint";h.textContent=t("Checking passcode…");const pass=$("syncJoinPass").value;
  let o;try{o=await openWithPass(pendingJoin.rec,pass)}catch(_){h.className="hint err";h.textContent=t("That passcode doesn't open the synced ledger.");return}
  if(o.legacyKey){h.className="hint err";h.textContent=t("The synced ledger is in an older format. Sync from the other device first.");return}
  h.textContent=t("Joining…");await saving;
  // move this device onto the shared key: re-encrypt local images, merge local entries into the synced ledger
  const fs=await fileAll();for(const id of Object.keys(fs)){const bytes=await decBytes(key,fs[id]);await filePut(id,{...(await encBytes(o.key,bytes)),type:fs[id].type})}
  const dev=docs._device;const merged=mergeDocs({},stripDevice(docs),o.docs);
  rawKey=o.raw;key=o.key;keys={pass:pendingJoin.rec.keys.pass};docs=merged.docs;docs._device=dev;delete dev.base;await migrate();applyPrefs();
  pendingJoin=null;$("syncJoinPass").value="";await persist();renderBio();setSyncUI();await syncNow(true);
  h.className="hint ok";h.textContent=t("Joined. This device now uses the synced ledger's passcode. Turn Face ID back on below if you use it.")});

/* ---------- first-run questionnaire (also re-runnable from Settings) ---------- */
const BILL_PRESETS=[["rent","rent","Rent or mortgage"],["utilities","utilities","Energy"],["phone","phone","Phone"],["internet","phone","Internet"],["insurance","insurance","Insurance"],
  ["subscriptions","subscriptions","Subscriptions"],["childcare","kids","Childcare or school fees"],["loan","other","Loan repayment"]];
const OTHER_INCOME_KINDS=[["maintenance","Child maintenance"],["benefits","Benefits & allowances"],["rental","Rental income"],["other","Other income"]];
let wz=null;
function draftFromDocs(rerun){
  const st=docs.settings||{};const L=LANG;const rec=recList();
  const cats=[];const have=new Map(catList("expense").map(c=>[c.k+"|"+c.n,c]));
  if(rerun&&st.cats&&st.cats.expense&&st.cats.expense.length){st.cats.expense.forEach(c=>cats.push({k:c.k,n:c.n,on:true,amount:+(st.budget||{})[c.n]||""}));
    KINDS.expense.forEach(k=>{if(!cats.some(c=>c.k===k))cats.push({k,n:defName(k,"expense",L),on:false,amount:""})})}
  else KINDS.expense.forEach(k=>cats.push({k,n:defName(k,"expense",L),on:!["kids","insurance","subscriptions"].includes(k),amount:""}));
  const salaryR=rec.find(r=>kindOf(r.cat,"income")==="salary");
  const pay=salaryR?{id:salaryR.id,kind:salaryR.freq||"monthly",amount:salaryR.amount,day:salaryR.day||1,wd:salaryR.wd||0,time:salaryR.time||"09:00",words:salaryR.match||"",auto:salaryR.auto!==false,name:salaryR.name}
    :{kind:rerun?"none":"monthly",amount:"",day:15,wd:4,time:"09:00",words:"",auto:true};
  const otherIncome=rec.filter(r=>typeOfCat(r.cat)==="income"&&r!==salaryR).map(r=>({id:r.id,name:r.name,amount:r.amount,day:r.day||1,kind:kindOf(r.cat,"income"),time:r.time||"09:00",cat:r.cat}));
  const bills=rec.filter(r=>typeOfCat(r.cat)==="expense").map(r=>({id:r.id,name:r.name,amount:r.amount,day:r.day||1,time:r.time||"09:00",cat:r.cat,kind:kindOf(r.cat,"expense"),on:true,remind:!!r.remind}));
  BILL_PRESETS.forEach(([id,kind,label])=>{if(!bills.some(b=>b.kind===kind&&(id!=="internet"||/internet/i.test(b.name))))bills.push({preset:id,name:t(label),amount:"",day:1,time:"09:00",kind,on:false,remind:true})});
  const sc=catList("saving");const tg=st.targets||{};const em=sc.find(c=>c.k==="emergency"),iv=sc.find(c=>c.k==="investing");
  const emGoal=goalList().find(g=>em&&g.src==="cat:"+em.n);const bt=Object.values(st.budget||{}).reduce((a,b)=>a+(+b||0),0);
  const transfers=rec.filter(r=>typeOfCat(r.cat)==="saving").map(r=>({id:r.id,name:r.name,amount:r.amount,day:r.day||1,time:r.time||"09:00",cat:r.cat,on:true}));
  const cc=(st.features||{}).child||{};
  return {name:st.name||"",lang:L,theme:st.theme||"system",currency:st.currency||"CZK",currency2:st.currency2||"",pay,otherIncome,
    period:(st.period||{}).type==="payday"?"payday":"calendar",cats,bills,remind:true,
    save:{emergency:em?+tg[em.n]||"":"",months:emGoal&&bt?Math.round(emGoal.target/bt)||3:3,months0:emGoal&&bt?Math.round(emGoal.target/bt)||3:3,invest:iv?+tg[iv.n]||"":"",split:!!((st.features||{}).investSplit),short:(st.invest||{}).short||"",long:(st.invest||{}).long||"",goals:[],transfers},
    method:(st.importPref||{}).method||(rerun?"csv":"raiffeisen"),own:(st.ownAccounts||[]).join("\n"),
    autoLock:st.autoLock||1,hide:!!st.hideOnOpen,backupEvery:st.backupEvery==null?30:st.backupEvery,
    child:{on:!!cc.on,child:cc.child||"",name:cc.name||"",other:cc.other||"",share:cc.share!=null?cc.share:50,balance:cc.balance!==false},rerun:!!rerun};
}
const WZ_STEPS=["welcome","money","income","period","spending","bills","saving","import","security","extras","done"];
function startWizard(rerun){wz={i:0,d:draftFromDocs(rerun)};$("app").hidden=true;$("wizard").hidden=false;$("wzClose").hidden=!rerun;renderWizard()}
$("wzClose").addEventListener("click",()=>{wz=null;$("wizard").hidden=true;$("app").hidden=false;render()});
$("wzBack").addEventListener("click",()=>{collectStep();if(wz.i>0){wz.i--;if(WZ_STEPS[wz.i]==="period"&&wz.d.pay.kind!=="monthly")wz.i--;renderWizard()}});
$("wzNext").addEventListener("click",async()=>{const err=collectStep();if(err){$("wzHint").textContent=err;return}
  if(wz.i===WZ_STEPS.length-1){await finishWizard();return}wz.i++;if(WZ_STEPS[wz.i]==="period"&&wz.d.pay.kind!=="monthly")wz.i++;renderWizard()});
let wzCollect=null;
function collectStep(){$("wzHint").textContent="";if(!wzCollect)return null;return wzCollect()||null}
function wzSection(title,lead){const b=$("wzBody");b.replaceChildren();b.appendChild(el("h1","wz-title",title));if(lead)b.appendChild(el("p","wz-lead",lead));return b}
function radioCards(name,opts,val,onChange){const box=el("div","choice");opts.forEach(([v,label,desc])=>{const id=uid("r");const r=el("input");r.type="radio";r.name=name;r.value=v;r.id=id;r.checked=v===val;
  const l=el("label","choice-item");l.htmlFor=id;const tx=el("span");tx.append(el("b","",label));if(desc)tx.append(el("small","",desc));l.append(r,tx);box.appendChild(l);r.addEventListener("change",()=>onChange&&onChange(v))});
  box.value=()=>{const c=box.querySelector("input:checked");return c?c.value:val};return box}
function renderWizard(){
  const d=wz.d,step=WZ_STEPS[wz.i];const total=WZ_STEPS.length;$("wzProgress").style.width=((wz.i)/(total-1)*100).toFixed(1)+"%";
  $("wzStep").textContent=t("Step {a} of {b}",{a:wz.i+1,b:total});$("wzBack").hidden=wz.i===0;$("wzNext").textContent=wz.i===total-1?(d.rerun?t("Save changes"):t("Start using Kč Ledger")):t("Next");
  wzCollect=null;$("wzHint").textContent="";const curs=CURRENCIES.map(c=>[c,c+" · "+(SYM[c]||c)]);
  if(step==="welcome"){const b=wzSection(d.rerun?t("Update your setup"):t("Welcome to Kč Ledger"),t("A few questions so the app fits how you earn, spend and save. It takes about five minutes, and you can change any answer later in Settings."));
    const lang=selOf([["en","English"],["cs","Čeština"]],LANG);lang.addEventListener("change",()=>{collectStep();d.lang=lang.value;setLang(lang.value);wz.d=Object.assign(draftFromDocs(d.rerun),{...d,cats:d.cats.map(c=>({...c,n:c.n===defName(c.k,"expense",lang.value==="cs"?"en":"cs")?defName(c.k,"expense",lang.value):c.n}))});renderWizard()});
    const name=inp(d.name);name.maxLength=40;name.placeholder=t("Optional");b.append(fld(t("Language"),lang),fld(t("What should we call you?"),name,t("Used for greetings and on statements you share.")));
    if(!d.rerun){const sk=el("div","wz-skip");sk.appendChild(el("p","small muted",t("Already use Kč Ledger on another device?")));const bt=el("button","link",t("Join a synced ledger or restore a backup instead"));bt.type="button";bt.addEventListener("click",skipWizard);sk.appendChild(bt);b.appendChild(sk)}
    wzCollect=()=>{d.name=name.value.trim().slice(0,40)}}
  else if(step==="money"){const b=wzSection(t("Your money"),t("Which currency do you live in, and do you have money in a second one?"));
    const c1=selOf(curs,d.currency),c2=selOf([["",t("None")]].concat(curs),d.currency2);
    b.append(fld(t("Main currency"),c1,t("Budgets, totals and charts use this currency.")),fld(t("Second currency (optional)"),c2,t("For money in another country. One tap switches every figure to it, and exchange rates update daily.")));
    wzCollect=()=>{d.currency=c1.value;d.currency2=c2.value===c1.value?"":c2.value}}
  else if(step==="income"){const b=wzSection(t("Your income"),t("Tell us about your pay, so the app knows when money arrives and can add it for you."));
    const kind=radioCards("pay",[["monthly",t("Monthly salary")],["fortnightly",t("Every two weeks")],["weekly",t("Weekly")],["none",t("No regular pay")]],d.pay.kind,v=>{d.pay.kind=v;payFields.hidden=v==="none";dayF.hidden=v!=="monthly";wdF.hidden=v==="monthly"||v==="none"});
    const amt=inp(d.pay.amount!==""?String(d.pay.amount):"","","decimal");amt.placeholder="0";const day=selOf(Array.from({length:31},(_,i)=>[String(i+1),i===30?t("31st (or last day)"):ord(i+1)]),String(d.pay.day||1));
    const wd=selOf(WEEKDAYS().map((w,i)=>[String(i),w]),String(d.pay.wd||0));const tm=inp(d.pay.time||"09:00","time");const words=inp(d.pay.words||"");words.placeholder=t("e.g. the employer's name on your statement");
    const auto=chk(t("Add my pay to the ledger automatically on payday"),d.pay.auto);
    const dayF=fld(t("Payday"),day),wdF=fld(t("Payday"),wd);const r1=el("div","inline2");r1.append(fld(t("Take-home pay ({c})",{c:d.currency}),amt),fld(t("Usual time it arrives"),tm));
    const payFields=el("div","fields");payFields.append(r1,dayF,wdF,fld(t("How it appears on your bank statement (optional)"),words,t("Helps the app recognise your salary in bank exports.")),auto);
    payFields.hidden=d.pay.kind==="none";dayF.hidden=d.pay.kind!=="monthly";wdF.hidden=d.pay.kind==="monthly"||d.pay.kind==="none";
    const oi=el("div","wz-rows");const drawOI=()=>{oi.replaceChildren();d.otherIncome.forEach((o,ix)=>{const r=el("div","wz-row");const n=inp(o.name);n.placeholder=t("Name");n.setAttribute("aria-label",t("Name"));
      const a=inp(o.amount!==""&&o.amount!=null?String(o.amount):"","","decimal");a.placeholder=t("Amount");a.setAttribute("aria-label",t("Amount"));a.className="amt";
      const dd=selOf(Array.from({length:31},(_,i)=>[String(i+1),ord(i+1)]),String(o.day||1));dd.setAttribute("aria-label",t("Day of the month"));
      const k=selOf(OTHER_INCOME_KINDS.map(([v,l])=>[v,t(l)]),o.kind||"other");k.setAttribute("aria-label",t("Type"));const x=el("button","x","×");x.type="button";x.setAttribute("aria-label",t("Remove"));
      x.addEventListener("click",()=>{o._del=true;d.otherIncome=d.otherIncome.filter(z=>z!==o);if(o.id)(d.removed=d.removed||[]).push(o.id);drawOI()});
      r._get=()=>Object.assign(o,{name:n.value.trim(),amount:parseNum(a.value)||"",day:+dd.value,kind:k.value});r.append(n,a,dd,k,x);oi.appendChild(r)})};drawOI();
    const add=el("button","link",t("+ Add other regular income"));add.type="button";add.addEventListener("click",()=>{[...oi.children].forEach(r=>r._get());d.otherIncome.push({name:"",amount:"",day:1,kind:"maintenance"});drawOI()});
    b.append(kind,payFields,el("h3","",t("Other regular income")),el("p","small muted",t("Maintenance, benefits, rent you receive, and so on.")),oi,add);
    wzCollect=()=>{d.pay={...d.pay,kind:kind.value(),amount:parseNum(amt.value)||"",day:+day.value,wd:+wd.value,time:tm.value||"09:00",words:words.value.trim(),auto:auto.input.checked};[...oi.children].forEach(r=>r._get())}}
  else if(step==="period"){const b=wzSection(t("Your budget month"),t("Should each month's budget follow the calendar, or run from one payday to the next?"));
    const pd=+d.pay.day||1;const ex=new Date(now.getFullYear(),now.getMonth(),Math.min(pd,28));const ex2=new Date(ex);ex2.setMonth(ex2.getMonth()+1);ex2.setDate(ex2.getDate()-1);
    const rc=radioCards("period",[["calendar",t("Calendar month"),t("1st to the last day of each month.")],["payday",t("Payday to payday"),t("From your payday on the {d} to the day before the next one, e.g. {a} – {b}.",{d:ord(pd),a:dShort(iso(ex)),b:dShort(iso(ex2))})]],d.period);
    b.appendChild(rc);wzCollect=()=>{d.period=rc.value()}}
  else if(step==="spending"){const b=wzSection(t("Your spending"),t("Pick the categories you use and set a monthly budget for each. Leave an amount blank if you'd rather not budget it."));
    const list=el("div","wz-rows");const tot=el("p","wz-total amt");
    const sum=()=>{const s=[...list.children].reduce((a,r)=>{const g=r._get();return a+(g.on?(+g.amount||0):0)},0);const inc=+d.pay.amount||0;const per=d.pay.kind==="weekly"?inc*52/12:d.pay.kind==="fortnightly"?inc*26/12:inc;
      tot.textContent=t("Total budget: {x}",{x:money(s,d.currency)})+(per?" · "+t("Income: {x} a month",{x:money(per,d.currency)})+" · "+(per-s>=0?t("{x} left for saving",{x:money(per-s,d.currency)}):t("{x} more than you earn",{x:money(s-per,d.currency)})):"")};
    const draw=()=>{list.replaceChildren();d.cats.forEach(c=>{const r=el("div","wz-row cat");const cb=el("input");cb.type="checkbox";cb.checked=c.on;cb.setAttribute("aria-label",t("Use this category"));
      const n=inp(c.n);n.setAttribute("aria-label",t("Category name"));n.maxLength=40;const a=inp(c.amount!==""&&c.amount!=null?String(c.amount):"","","decimal");a.placeholder="0";a.className="amt";a.setAttribute("aria-label",t("Monthly budget"));
      const sync=()=>{r.classList.toggle("off",!cb.checked);a.disabled=!cb.checked};cb.addEventListener("change",()=>{sync();sum()});a.addEventListener("input",sum);sync();
      r._get=()=>Object.assign(c,{on:cb.checked,n:n.value.trim()||c.n,amount:parseNum(a.value)||""});r.append(cb,n,a);list.appendChild(r)});sum()};draw();
    const add=el("button","link",t("+ Add a category"));add.type="button";add.addEventListener("click",()=>{[...list.children].forEach(r=>r._get());d.cats.push({k:"other",n:"",on:true,amount:"",custom:true});draw();list.lastChild.querySelector("input:not([type=checkbox])").focus()});
    b.append(list,add,tot);wzCollect=()=>{[...list.children].forEach(r=>r._get());d.cats=d.cats.filter(c=>c.n||!c.custom);if(!d.cats.some(c=>c.on))return t("Keep at least one category.")}}
  else if(step==="bills"){const b=wzSection(t("Regular bills"),t("Tick the bills you pay and when. They appear on your schedule, count towards the budget on their due dates, and can be added to the ledger automatically."));
    const onCats=d.cats.filter(c=>c.on);const list=el("div","wz-rows");
    const draw=()=>{list.replaceChildren();d.bills.forEach(bl=>{const r=el("div","wz-bill");const cb=el("input");cb.type="checkbox";cb.checked=bl.on;cb.setAttribute("aria-label",t("I pay this"));
      const n=inp(bl.name);n.setAttribute("aria-label",t("Name"));n.maxLength=40;const a=inp(bl.amount!==""&&bl.amount!=null?String(bl.amount):"","","decimal");a.placeholder=t("Amount");a.className="amt";a.setAttribute("aria-label",t("Amount"));
      const dd=selOf(Array.from({length:31},(_,i)=>[String(i+1),i===30?t("31st (or last day)"):ord(i+1)]),String(bl.day||1));dd.setAttribute("aria-label",t("Day of the month"));const tm=inp(bl.time||"09:00","time");tm.setAttribute("aria-label",t("Time"));
      const cs=selOf(onCats.map(c=>c.n),bl.cat&&onCats.some(c=>c.n===bl.cat)?bl.cat:(onCats.find(c=>c.k===bl.kind)||onCats.find(c=>c.k==="other")||onCats[0]||{}).n);cs.setAttribute("aria-label",t("Category"));
      const det=el("div","wz-bill-detail");det.append(a,dd,tm,cs);const sync=()=>{det.hidden=!cb.checked;r.classList.toggle("off",!cb.checked)};cb.addEventListener("change",sync);sync();
      const top=el("div","wz-bill-top");top.append(cb,n);r.append(top,det);r._get=()=>Object.assign(bl,{on:cb.checked,name:n.value.trim()||bl.name,amount:parseNum(a.value)||"",day:+dd.value,time:tm.value||"09:00",cat:cs.value});list.appendChild(r)})};draw();
    const add=el("button","link",t("+ Add another bill"));add.type="button";add.addEventListener("click",()=>{[...list.children].forEach(r=>r._get());d.bills.push({name:"",amount:"",day:1,time:"09:00",kind:"other",on:true,remind:true});draw()});
    const rem=chk(t("Remind me a day before each bill (through your phone's calendar)"),d.remind);
    b.append(list,add,rem);wzCollect=()=>{[...list.children].forEach(r=>r._get());d.remind=rem.input.checked;const bad=d.bills.find(x=>x.on&&!(x.amount>0));if(bad)return t("Add an amount for {n}, or untick it.",{n:bad.name||t("the new bill")})}}
  else if(step==="saving"){const b=wzSection(t("Saving"),t("How much do you want to put aside each month? Leave anything blank that doesn't apply."));
    const em=inp(d.save.emergency!==""?String(d.save.emergency):"","","decimal");em.placeholder="0";const months=selOf([["0",t("No target")],["3",t("3 months of spending")],["6",t("6 months of spending")]],String(d.save.months||3));
    const iv=inp(d.save.invest!==""?String(d.save.invest):"","","decimal");iv.placeholder="0";const split=chk(t("Split my investing into short term (around 2 years) and long term (5+ years)"),d.save.split);
    const sh=inp(d.save.short!==""?String(d.save.short):"","","decimal"),lo=inp(d.save.long!==""?String(d.save.long):"","","decimal");sh.placeholder="0";lo.placeholder="0";
    const sf=el("div","inline2");sf.append(fld(t("Short term"),sh),fld(t("Long term"),lo));sf.hidden=!split.input.checked;split.input.addEventListener("change",()=>{sf.hidden=!split.input.checked;ivF.hidden=split.input.checked});
    const ivF=fld(t("Investing per month"),iv);ivF.hidden=split.input.checked;
    const gl=el("div","wz-rows");const drawG=()=>{gl.replaceChildren();d.save.goals.forEach(g=>{const r=el("div","wz-row");const n=inp(g.name);n.placeholder=t("Goal, e.g. holiday");n.setAttribute("aria-label",t("Goal name"));
      const a=inp(g.target||"","","decimal");a.placeholder=t("Target");a.className="amt";a.setAttribute("aria-label",t("Target"));const dt=inp(g.date||"","month");dt.setAttribute("aria-label",t("Target date (optional)"));
      const x=el("button","x","×");x.type="button";x.addEventListener("click",()=>{d.save.goals=d.save.goals.filter(z=>z!==g);drawG()});r._get=()=>Object.assign(g,{name:n.value.trim(),target:parseNum(a.value)||0,date:dt.value});r.append(n,a,dt,x);gl.appendChild(r)})};drawG();
    const addG=el("button","link",t("+ Add a savings goal"));addG.type="button";addG.addEventListener("click",()=>{[...gl.children].forEach(r=>r._get());d.save.goals.push({name:"",target:"",date:""});drawG()});
    const tl=el("div","wz-rows");const drawT=()=>{tl.replaceChildren();d.save.transfers.forEach(tr=>{const r=el("div","wz-row");const n=inp(tr.name);n.placeholder=t("Name");n.setAttribute("aria-label",t("Name"));
      const a=inp(tr.amount||"","","decimal");a.placeholder=t("Amount");a.className="amt";a.setAttribute("aria-label",t("Amount"));const dd=selOf(Array.from({length:31},(_,i)=>[String(i+1),ord(i+1)]),String(tr.day||1));dd.setAttribute("aria-label",t("Day of the month"));
      const x=el("button","x","×");x.type="button";x.addEventListener("click",()=>{d.save.transfers=d.save.transfers.filter(z=>z!==tr);if(tr.id)(d.removed=d.removed||[]).push(tr.id);drawT()});
      r._get=()=>Object.assign(tr,{name:n.value.trim(),amount:parseNum(a.value)||"",day:+dd.value});r.append(n,a,dd,x);tl.appendChild(r)})};drawT();
    const addT=el("button","link",t("+ Add a regular transfer to savings"));addT.type="button";addT.addEventListener("click",()=>{[...tl.children].forEach(r=>r._get());d.save.transfers.push({name:t("Transfer to savings"),amount:"",day:Math.min(28,(+d.pay.day||1)+1),time:"09:00",on:true});drawT()});
    b.append(fld(t("Emergency savings per month"),em),fld(t("Emergency fund target"),months),el("h3","",t("Investing")),ivF,split,sf,el("h3","",t("Other goals")),gl,addG,el("h3","",t("Standing orders to savings (optional)")),el("p","small muted",t("If you move money to savings on a fixed day, add it here so it's expected and added automatically.")),tl,addT);
    wzCollect=()=>{[...gl.children].forEach(r=>r._get());[...tl.children].forEach(r=>r._get());d.save={...d.save,emergency:parseNum(em.value)||"",months:+months.value,split:split.input.checked,short:parseNum(sh.value)||"",long:parseNum(lo.value)||"",
      invest:split.input.checked?((parseNum(sh.value)||0)+(parseNum(lo.value)||0))||"":parseNum(iv.value)||""}}}
  else if(step==="import"){const b=wzSection(t("Getting your transactions in"),t("Where does your money live? Pick your main bank; you can import from others too."));
    const how=el("p","wz-how small");const rc=radioCards("bank",IMPORT_METHODS.map(([v,n])=>[v,v==="csv"||v==="manual"?t(n):n]),d.method,v=>{how.textContent=importHowTo(v)});how.textContent=importHowTo(d.method);
    const own=el("textarea");own.rows=2;own.value=d.own;own.placeholder=t("One per line, e.g. 123456789/0800");
    b.append(rc,how,fld(t("Your own account numbers (optional)"),own,t("Transfers between your own accounts are then left out of spending and income. They stay encrypted on this device.")));
    wzCollect=()=>{d.method=rc.value();d.own=own.value}}
  else if(step==="security"){const b=wzSection(t("Keeping it private"),t("Your data is already encrypted with your passcode and never leaves this device unless you turn on sync. A few more choices:"));
    if(window.PublicKeyCredential){const bio=el("div","wz-bio");const info=el("p","small muted",keys&&keys.prf?t("Face ID unlock is on."):t("Unlock with Face ID instead of typing your passcode. Your passcode keeps working too."));
      const btn=el("button","icon-btn",keys&&keys.prf?t("Face ID is on"):t("Set up Face ID"));btn.type="button";btn.disabled=!!(keys&&keys.prf);btn.addEventListener("click",async()=>{if(await enrolBio(info)){btn.textContent=t("Face ID is on");btn.disabled=true}});bio.append(el("b","",t("Face ID")),info,btn);b.appendChild(bio)}
    const al=selOf([["1",t("1 minute away")],["5",t("5 minutes away")],["15",t("15 minutes away")]],String(d.autoLock));const hide=chk(t("Hide amounts each time I open the app"),d.hide);
    const be=selOf([["7",t("Every week")],["30",t("Every month")],["0",t("Never")]],String(d.backupEvery));
    b.append(fld(t("Lock automatically after"),al),hide,fld(t("Remind me to save an encrypted backup"),be),el("p","fine",t("Sync between your phone and computer can be turned on later in Settings, using a private GitHub repository. Everything is encrypted before it leaves the device.")));
    wzCollect=()=>{d.autoLock=+al.value;d.hide=hide.input.checked;d.backupEvery=+be.value}}
  else if(step==="extras"){const b=wzSection(t("Extras"),t("Optional features. Leave them off if they're not for you."));
    const on=chk(t("Track child expenses to share with the other parent"),d.child.on);const box=el("div","fields kid-setup");
    const ch=inp(d.child.child);ch.placeholder=t("e.g. Eli");ch.maxLength=30;const nm=inp(d.child.name);nm.placeholder=t("e.g. Eli expenses");nm.maxLength=40;const ot=inp(d.child.other);ot.placeholder=t("e.g. Tom");ot.maxLength=30;
    ch.addEventListener("input",()=>{if(!nm.dataset.touched)nm.value=ch.value.trim()?t("{c} expenses",{c:ch.value.trim()}):""});nm.addEventListener("input",()=>nm.dataset.touched="1");if(d.child.name)nm.dataset.touched="1";
    const sh=selOf(Array.from({length:21},(_,n)=>[String(n*5),t("You {a} % · them {b} %",{a:100-n*5,b:n*5})]),String(d.child.share));const bal=chk(t("Keep a running balance of who owes whom"),d.child.balance);
    box.append(fld(t("Child's name"),ch),fld(t("Name for the tab"),nm),fld(t("Other parent's name"),ot),fld(t("Usual split"),sh,t("You can change the split on any single expense.")),bal,
      el("p","fine",t("Mark expenses as being for your child, record what the other parent paid and repayments, and send a monthly PDF statement or text summary. Suggestions learn from your choices on this device.")));
    box.hidden=!on.input.checked;on.input.addEventListener("change",()=>box.hidden=!on.input.checked);
    const th=selOf([["system",t("Match my phone")],["light",t("Light")],["dark",t("Dark")]],d.theme);th.addEventListener("change",()=>applyTheme(th.value));
    b.append(on,box,el("h3","",t("Appearance")),fld(t("Theme"),th));
    wzCollect=()=>{d.child={on:on.input.checked,child:ch.value.trim(),name:nm.value.trim(),other:ot.value.trim(),share:+sh.value,balance:bal.input.checked};d.theme=th.value;
      if(d.child.on&&!d.child.child&&!d.child.name)return t("Give the tracker a name, or switch it off.")}}
  else if(step==="done"){const b=wzSection(d.rerun?t("Ready to save"):t("All set"),d.rerun?t("Here's what will change. Your entries stay as they are."):t("Here's your setup. Everything can be changed later in Settings."));
    const ul=el("ul","wz-summary");const add=(k,v)=>{const li=el("li");li.append(el("span","",k),el("b","amt",v));ul.appendChild(li)};
    const bud=d.cats.filter(c=>c.on).reduce((a,c)=>a+(+c.amount||0),0);
    add(t("Currency"),d.currency+(d.currency2?" + "+d.currency2:""));if(d.pay.kind!=="none")add(t("Pay"),money(+d.pay.amount||0,d.currency)+" · "+(d.pay.kind==="monthly"?t("monthly on the {d}",{d:ord(d.pay.day)}):d.pay.kind==="weekly"?t("weekly on {w}",{w:WEEKDAYS()[d.pay.wd]}):t("every two weeks on {w}",{w:WEEKDAYS()[d.pay.wd]})));
    add(t("Budget month"),d.pay.kind==="monthly"&&d.period==="payday"?t("Payday to payday"):t("Calendar month"));add(t("Spending budget"),money(bud,d.currency)+" · "+d.cats.filter(c=>c.on).length+" "+pl(d.cats.filter(c=>c.on).length,"category"));
    add(t("Regular bills"),String(d.bills.filter(x=>x.on).length));const sv=(+d.save.emergency||0)+(+d.save.invest||0);if(sv)add(t("Saving per month"),money(sv,d.currency));
    add(t("Import"),(IMPORT_METHODS.find(m=>m[0]===d.method)||["",""])[1]);if(d.child.on)add(t("Child expenses"),d.child.name||t("{c} expenses",{c:d.child.child}));
    b.appendChild(ul);if(!d.rerun)b.appendChild(el("p","small muted",t("Next: import a bank export or a screenshot from the Entries tab, or just start adding entries.")))}
  translateDom($("wzBody"));$("wzBody").scrollTop=0;scrollTo(0,0);
}
async function skipWizard(){const st=ensureSettings();st.cats={expense:KINDS.expense.filter(k=>!["kids","insurance","subscriptions"].includes(k)).map(k=>({n:defName(k,"expense"),k})),saving:KINDS.saving.slice(0,2).map(k=>({n:defName(k,"saving"),k})),income:["salary","other","interest"].map(k=>({n:defName(k,"income"),k}))};
  st.onboarded=true;st.lang=LANG;await persist();wz=null;applyPrefs();await showApp();showTab("settings");["secSync","secBackup"].forEach(id=>$(id).open=true);setTimeout(()=>$("secSync").scrollIntoView({behavior:"smooth"}),80);toast(t("Join your synced ledger or restore a backup below."))}
async function finishWizard(){
  const d=wz.d;const st=ensureSettings();const L=d.lang||LANG;
  Object.assign(st,{name:d.name,lang:L,theme:d.theme,currency:d.currency,currency2:d.currency2,autoLock:d.autoLock,hideOnOpen:d.hide,backupEvery:d.backupEvery,
    period:{type:d.pay.kind==="monthly"&&d.period==="payday"?"payday":"calendar",day:+d.pay.day||1},importPref:{method:d.method},
    ownAccounts:[...new Set(String(d.own||"").split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean))]});
  if(st.dispCur&&st.dispCur!==st.currency&&st.dispCur!==st.currency2)st.dispCur=st.currency;
  // categories: chosen ones, plus any that already hold entries
  const used=ty=>new Set(allItems().filter(x=>x.i.type===ty).map(x=>x.i.cat));
  const prevCats=st.cats&&st.cats.expense&&st.cats.expense.length?st.cats:{expense:[],saving:[],income:[]};
  d.cats.forEach(c=>{const prev=prevCats.expense.find(p=>p.k===c.k&&p.n!==c.n&&!d.cats.some(z=>z.n===p.n));if(prev&&c.on&&!c.custom)renameCat(prev.n,c.n,"expense")});
  const exp=d.cats.filter(c=>c.on).map(c=>({n:c.n,k:c.k==="other"&&c.custom?guessKind(c.n,"expense"):c.k}));used("expense").forEach(n=>{if(!exp.some(c=>c.n===n))exp.push({n,k:kindOf(n,"expense")})});
  const sav=[...prevCats.saving];const ensureCat=(list,k,ty)=>{let c=list.find(x=>x.k===k);if(!c){c={n:defName(k,ty,L),k};list.push(c)}return c.n};
  const emN=+d.save.emergency||d.save.months?ensureCat(sav,"emergency","saving"):null;const ivN=+d.save.invest?ensureCat(sav,"investing","saving"):null;if(d.save.goals.some(g=>g.name))ensureCat(sav,"goal","saving");if(!sav.length)ensureCat(sav,"emergency","saving");
  const inc=[...prevCats.income];const salN=d.pay.kind!=="none"?ensureCat(inc,"salary","income"):null;d.otherIncome.forEach(o=>{if(o.name&&o.amount)o.cat=o.cat&&inc.some(c=>c.n===o.cat)?o.cat:ensureCat(inc,o.kind||"other","income")});
  ensureCat(inc,"other","income");if(d.currency2)ensureCat(inc,"transfer","income");used("income").forEach(n=>{if(!inc.some(c=>c.n===n))inc.push({n,k:"other"})});used("saving").forEach(n=>{if(!sav.some(c=>c.n===n))sav.push({n,k:"goal"})});
  st.cats={expense:exp,saving:sav,income:inc};applyCats();
  st.budget={};d.cats.filter(c=>c.on).forEach(c=>st.budget[c.n]=+c.amount||0);
  st.targets=st.targets||{};if(emN)st.targets[emN]=+d.save.emergency||0;if(ivN)st.targets[ivN]=+d.save.invest||0;
  st.features=st.features||{};st.features.investSplit=!!(d.save.split&&ivN);if(d.save.split)st.invest={short:+d.save.short||0,long:+d.save.long||0};
  if(d.pay.words)st.salaryWords=[...new Set([...(st.salaryWords||[]),...d.pay.words.split(/[,|]/).map(w=>w.trim().toLowerCase()).filter(w=>w.length>=3)])];
  const oldCh=st.features.child||{};st.features.child=d.child.on||oldCh.on?{...oldCh,on:d.child.on,child:d.child.child,name:d.child.name||t("{c} expenses",{c:d.child.child||t("Child")}),other:d.child.other,share:d.child.share,balance:d.child.balance,start:oldCh.start||todayIso()}:oldCh;
  // recurring items
  docs.recurring=docs.recurring||{list:[]};let list=recList().filter(r=>!(d.removed||[]).includes(r.id));const t0=todayIso();
  // existing items only get the fields the questionnaire shows; their reminders, repeats and words stay as they were
  const upsert=(id,obj,fresh)=>{const ix=id?list.findIndex(r=>r.id===id):-1;const o=ix>=0?obj:{...obj,...(fresh||{})};Object.keys(o).forEach(k=>o[k]===undefined&&delete o[k]);
    if(ix>=0){list[ix]={...list[ix],...o};delete list[ix].seeded}else list.push({id:uid("r"),start:t0,wd:0,cur:st.currency,auto:true,remind:false,before:0,match:"",freq:"monthly",time:"09:00",...o})};
  if(d.pay.kind!=="none"&&d.pay.amount>0)upsert(d.pay.id,{name:d.pay.name||t("Salary"),cat:salN,amount:+d.pay.amount,freq:d.pay.kind,day:+d.pay.day||1,wd:+d.pay.wd||0,time:d.pay.time||"09:00",auto:d.pay.auto,match:d.pay.words||""});
  else if(d.pay.id)list=list.filter(r=>r.id!==d.pay.id);
  d.otherIncome.forEach(o=>{if(o.name&&o.amount>0)upsert(o.id,{name:o.name,cat:o.cat,amount:+o.amount,day:o.day||1})});
  d.bills.forEach(b=>{if(b.on&&b.amount>0)upsert(b.id,{name:b.name,cat:b.cat,amount:+b.amount,day:b.day||1,time:b.time||"09:00",child:d.child.on&&kindOf(b.cat,"expense")==="kids"&&!b.id?{share:d.child.share}:undefined},
      {remind:d.remind,before:d.remind?1:0,match:b.name.toLowerCase()});else if(b.id&&!b.on)list=list.filter(r=>r.id!==b.id)});
  d.save.transfers.forEach(tr=>{if(tr.name&&tr.amount>0)upsert(tr.id,{name:tr.name,cat:tr.cat||emN||ivN||sav[0].n,amount:+tr.amount,day:tr.day||1},{remind:true})});
  list.forEach(r=>{if(r.match===undefined)r.match=""});docs.recurring.list=list;
  // goals
  docs.goals=docs.goals||{list:[]};const bt=Object.values(st.budget).reduce((a,b)=>a+b,0);
  if(emN&&d.save.months){const g=goalList().find(x=>x.src==="cat:"+emN);if(g){if(d.save.months!==d.save.months0||!g.target){g.target=bt*d.save.months;delete g.seeded}}else docs.goals.list.push({id:uid("g"),name:t("Emergency fund"),target:bt*d.save.months,date:"",start:0,src:"cat:"+emN,created:t0})}
  if(st.features.investSplit&&!goalList().some(g=>g.src==="inv:long"))docs.goals.list.push({id:uid("g"),name:t("Long-term investing"),target:0,date:"",start:0,src:"inv:long",created:t0});
  d.save.goals.forEach(g=>{if(g.name&&!goalList().some(x=>x.name===g.name))docs.goals.list.push({id:uid("g"),name:g.name,target:+g.target||0,date:g.date||"",start:0,src:"manual",created:t0})});
  st.onboarded=true;wz=null;applyPrefs();cur=periodOfDate(new Date());await runAuto();await persist();await updateRates(true);
  await showApp();toast(d.rerun?t("Your setup is saved."):t("All set. Welcome to Kč Ledger."));
}

/* ---------- child expenses tracker (opt-in) ----------
   Expenses in the ledger can be marked as being for the child (i.child={share}), where share is the % the other parent covers.
   docs.child.items holds what happens outside your own spending:
     theyPaid  – the other parent paid for something (share = % they cover, the rest is yours to pay back)
     repayIn   – they paid you back in cash (bank repayments are income entries marked childRepay)
     repayOut  – you paid them back
     adjust    – a starting balance (dir "owesMe" or "iOwe")
   A positive balance means the other parent owes you. */
const kidExtra=()=>((docs.child||{}).items)||[];
const kidOther=()=>{const c=childCfg()||{};return c.other||t("The other parent")};
const kidMe=()=>(docs.settings||{}).name||t("Me");
const kidChild=()=>{const c=childCfg()||{};return c.child||t("your child")};
const NODEC=new Set(["CZK","HUF","JPY"]);
function money2(v,c){c=c||baseCur();const d=NODEC.has(c)?0:2;const n=new Intl.NumberFormat(LOC(),{minimumFractionDigits:d,maximumFractionDigits:d}).format(Math.abs(v));
  const s=SYM[c]||c;const pre=LANG!=="cs"&&PREFIX.has(c);return (v<-.004?"−":"")+(pre?s+n:n+" "+s)}
function kidMoves(){
  const out=[];
  allItems().forEach(({k,i})=>{const a=+i.czk||0;
    if(i.type==="expense"&&i.child){const sh=clamp(+i.child.share||0,0,100);out.push({src:"ledger",k,i,kind:"mine",date:i.date,amount:a,share:sh,part:a*sh/100,v:a*sh/100,note:i.note||i.cat,att:i.att||[]})}
    else if(i.type==="income"&&i.childRepay)out.push({src:"ledger",k,i,kind:"repayIn",date:i.date,amount:a,v:-a,note:i.note||"",att:i.att||[]})});
  kidExtra().forEach(x=>{const a=+x.czk||0;let v=0,part=0;
    if(x.kind==="theyPaid"){const sh=clamp(+x.share||0,0,100);part=a*(100-sh)/100;v=-part}
    else if(x.kind==="repayIn")v=-a;else if(x.kind==="repayOut")v=a;else if(x.kind==="adjust")v=x.dir==="iOwe"?-a:a;
    out.push({src:"kid",i:x,kind:x.kind,date:x.date,amount:a,share:+x.share||0,part,v,note:x.note||"",att:x.att||[]})});
  return out.sort((a,b)=>a.date.localeCompare(b.date)||(a.i.ts||0)-(b.i.ts||0));
}
function kidBalanceTo(dIso){return Math.round(kidMoves().filter(m=>m.date<=dIso).reduce((s,m)=>s+m.v,0)*100)/100}
function kidMonthData(y,m){
  const mk=y+"-"+pad(m+1),e=iso(new Date(y,m+1,0));const mv=kidMoves().filter(x=>x.date.slice(0,7)===mk);
  const sum=(kind,f)=>mv.filter(x=>x.kind===kind).reduce((a,x)=>a+f(x),0);
  const r={y,m,mk,s:mk+"-01",e,mv,mine:sum("mine",x=>x.amount),theirShare:sum("mine",x=>x.part),theirs:sum("theyPaid",x=>x.amount),myShare:sum("theyPaid",x=>x.part),
    repIn:sum("repayIn",x=>x.amount),repOut:sum("repayOut",x=>x.amount),adj:sum("adjust",x=>x.v),open:kidBalanceTo(iso(new Date(y,m,0))),close:kidBalanceTo(e)};
  r.net=r.theirShare-r.myShare;return r;
}
// who owes whom, in words. who: "you" for your own screens, "names" for statements you send
function kidOwes(v,who,f){f=f||fmt;const o=kidOther();if(Math.abs(v)<1)return t("All square");
  if(who==="names")return v>0?t("{a} owes {b} {x}",{a:o,b:kidMe(),x:f(v)}):t("{a} owes {b} {x}",{a:kidMe(),b:o,x:f(-v)});
  return v>0?t("{o} owes you {x}",{o,x:f(v)}):t("You owe {o} {x}",{o,x:f(-v)})}

/* ---------- on-device suggestions ----------
   A small naive Bayes model, rebuilt from your own yes/no choices every time the tab is drawn.
   Nothing is sent anywhere, and nothing is stored except the choices themselves. */
const KID_WORDS=["kid","kids","kidz","child*","children","baby*","toddler*","school*","nursery","daycare","kindergarten","creche","preschool","toy","toys","lego*","nappy","nappies","diaper*","pampers",
  "pediatr*","paediatr*","pushchair","stroller","pram","tutor*","tuition","babysit*","playgroup","uniform","skol*","druzin*","krouz*","hrack*","plenk*","pleny","detsk*","deti","dite","detem",
  "miminko","kojen*","kocar*","tabor","tabory","doucov*","jesle","junior"];
function kidKeyword(note){const ws=norm(note).split(/[^a-z0-9&]+/).filter(Boolean);
  for(const w of ws)for(const k of KID_WORDS){if(k.endsWith("*")?w.startsWith(k.slice(0,-1)):w===k)return w}return null}
function kidFeats(i){const f=new Set();f.add("k:"+kindOf(i.cat,"expense"));f.add("c:"+norm(i.cat));
  const ws=norm(i.note).split(/[^a-z0-9]+/).filter(w=>w.length>=3&&!/^\d+$/.test(w)).slice(0,12);ws.forEach(w=>f.add("w:"+w));if(ws.length)f.add("n:"+ws.slice(0,2).join(" "));
  f.add("a:"+Math.round(Math.log2((+i.czk||0)+1)));return f}
let kidModel=null;
function kidLearn(){kidModel=null}
function kidTrain(){const pos={},neg={};let P=0,N=0;
  allItems().forEach(({i})=>{if(i.type!=="expense"||!(i.child||i.childNo))return;const y=!!i.child;kidFeats(i).forEach(f=>{const m=y?pos:neg;m[f]=(m[f]||0)+1});y?P++:N++});return {pos,neg,P,N}}
function kidScore(i){const m=kidModel||(kidModel=kidTrain());let lo=Math.log((m.P+1)/(m.N+8));let best=null,bestV=0;
  kidFeats(i).forEach(f=>{if(f.startsWith("a:")&&m.P+m.N<6)return;const a=m.pos[f]||0,b=m.neg[f]||0;if(!a&&!b)return;const v=Math.log((a+.5)/(m.P+1))-Math.log((b+.5)/(m.N+1));lo+=v;if(v>bestV&&!f.startsWith("a:")){bestV=v;best=f}});
  const kw=kidKeyword(i.note);if(kw)lo+=2.6;const kd=kindOf(i.cat,"expense")==="kids";if(kd)lo+=3;
  let why;if(kw)why=t("mentions “{w}”",{w:kw});else if(kd)why=t("in {c}",{c:i.cat});else if(best&&best.startsWith("c:"))why=t("{c}, like ones you marked before",{c:i.cat});else why=t("similar to ones you marked before");
  return {p:1/(1+Math.exp(-clamp(lo,-12,12))),why}}
function renderKidSugg(){
  const ul=$("kidSugg");if(!ul)return;ul.replaceChildren();kidModel=null;const cc=childCfg();
  const from=iso(new Date(Date.now()-75*DAY)),mk=cur.y+"-"+pad(cur.m+1),tI=todayIso();
  const cand=allItems().filter(({i})=>i.type==="expense"&&!i.child&&!i.childNo&&i.date<=tI&&(i.date>=from||i.date.slice(0,7)===mk))
    .map(x=>({...x,sc:kidScore(x.i)})).filter(x=>x.sc.p>=.5).sort((a,b)=>b.sc.p-a.sc.p||b.i.date.localeCompare(a.i.date)).slice(0,6);
  $("kidSuggTitle").textContent=t("Could these be for {c}?",{c:kidChild()});const m=kidModel||kidTrain();
  $("kidSuggNote").textContent=(m.P+m.N?t("Learned from {n} of your choices.",{n:m.P+m.N})+" ":"")+t("Worked out on this device from your own choices. Nothing is sent anywhere.");
  if(!cand.length){ul.appendChild(el("li","empty",t("No suggestions right now.")));return}
  cand.forEach(({k,i,sc})=>{const li=el("li","sugg");const tx=el("div","sg-t");tx.append(el("b","",i.note||i.cat),el("small","",dShort(i.date)+" · "+i.cat+" · "+sc.why));
    const a=el("span","amt",fmt(i.czk));const yes=el("button","yes",t("Yes"));yes.type="button";yes.setAttribute("aria-label",t("Yes, {n} is for {c}",{n:i.note||i.cat,c:kidChild()}));
    const no=el("button","no",t("No"));no.type="button";no.setAttribute("aria-label",t("No, {n} isn't for {c}",{n:i.note||i.cat,c:kidChild()}));
    const act=async ok=>{docs[k].items=items(k).map(x=>{if(x.id!==i.id)return x;const n={...x};if(ok){n.child={share:+cc.share||0};delete n.childNo}else{n.childNo=true;delete n.child}return n});
      kidLearn();await persist();render();toast(ok?t("Added to {n}",{n:cc.name}):t("Got it. Suggestions will learn from that."))};
    yes.addEventListener("click",()=>act(true));no.addEventListener("click",()=>act(false));const bt=el("div","sg-b");bt.append(yes,no);li.append(tx,a,bt);ul.appendChild(li)});
}

/* ---------- the tab ---------- */
function kidRow(x){const o=kidOther();const li=el("li");const d=el("span","d",dDay(x.date));const w=el("div");let sub,amt,cls="";
  if(x.kind==="mine"){sub=t("You paid")+" · "+t("{o} pays {p} %",{o,p:x.share})+" = "+fmt(x.part);amt=fmt(x.amount)}
  else if(x.kind==="theyPaid"){sub=t("{o} paid",{o})+" · "+t("your part {x}",{x:fmt(x.part)});amt=fmt(x.amount);cls="them"}
  else if(x.kind==="repayIn"){sub=t("{o} paid you back",{o});amt="−"+fmt(x.amount);cls="rep"}
  else if(x.kind==="repayOut"){sub=t("You paid {o} back",{o});amt="+"+fmt(x.amount);cls="rep"}
  else{sub=t("Starting balance")+" · "+(x.v>0?t("{o} owes you",{o}):t("You owe {o}",{o}));amt=fmt(x.amount);cls="rep"}
  w.append(el("div","c",x.note||(x.kind==="mine"?x.i.cat:sub)),el("div","n",sub));if(x.att.length){const bd=el("div","badges");bd.appendChild(el("span","badge",x.att.length>1?x.att.length+" "+pl(x.att.length,"image"):t("image")));w.appendChild(bd)}
  li.className=cls;li.append(d,w,el("div","a amt",amt));li.tabIndex=0;li.setAttribute("role","button");
  const open=()=>x.src==="ledger"?openEditor(x.k,x.i.id):openKidItem(x.i);li.addEventListener("click",open);li.addEventListener("keydown",e=>{if(e.key==="Enter")open()});return li}
function renderKids(){
  const cc=childCfg();if(!cc||!$("kidTitle"))return;
  $("kidTitle").textContent=cc.name;$("kidSub").textContent=cc.other?t("Shared with {o} · usual split: {o} pays {p} %",{o:cc.other,p:+cc.share||0}):t("Usual split: the other parent pays {p} %",{p:+cc.share||0});
  $("kidAdd").textContent=t("{o} paid for something",{o:kidOther()});
  const bx=$("kidBalance");bx.replaceChildren();
  if(cc.balance!==false){const v=kidBalanceTo(todayIso());const sq=Math.abs(v)<1;
    bx.append(el("div","kb-l",t("Balance today")),el("div","kb-v amt "+(sq?"":v>0?"pos":"neg"),sq?t("All square"):fmt(Math.abs(v))),el("div","kb-w",sq?t("Nobody owes anything right now."):v>0?t("{o} owes you",{o:kidOther()}):t("You owe {o}",{o:kidOther()})))}
  else bx.appendChild(el("p","small muted",t("The running balance is off, so statements show each month on its own.")));
  const md=kidMonthData(cur.y,cur.m);$("kidMonthTitle").textContent=mName(cur.y,cur.m);
  const box=$("kidMonth");box.replaceChildren();const kv=(a,b,cls)=>{const r=el("div","kv"+(cls?" "+cls:""));r.append(el("span","",a),el("b","amt",b));box.appendChild(r)};const o=kidOther();
  kv(t("Spent on {c}",{c:kidChild()}),fmt(md.mine+md.theirs),"big");kv(t("Paid by you"),fmt(md.mine));if(md.mine)kv(t("{o}'s share of that",{o}),fmt(md.theirShare),"sub");
  if(md.theirs){kv(t("Paid by {o}",{o}),fmt(md.theirs));kv(t("Your share of that"),fmt(md.myShare),"sub")}
  if(md.repIn)kv(t("{o} paid you back",{o}),fmt(md.repIn));if(md.repOut)kv(t("You paid {o} back",{o}),fmt(md.repOut));
  kv(t("This month on its own"),kidOwes(md.net),"total");
  const ul=$("kidList");ul.replaceChildren();
  if(!md.mv.length)ul.appendChild(el("li","empty",t("Nothing for {c} in this month yet. Tick “For {c}” when you add or edit an expense, or answer the suggestions below.",{c:kidChild()})));
  md.mv.slice().reverse().forEach(x=>ul.appendChild(kidRow(x)));
  renderKidSugg();
}
function renderKidChart(){const cc=childCfg();const box=$("kidChart");if(!cc||!box)return;const labs=[],vals=[];
  for(let i=5;i>=0;i--){const d=new Date(cur.y,cur.m-i,1);const md=kidMonthData(d.getFullYear(),d.getMonth());labs.push(mName(d.getFullYear(),d.getMonth(),true));vals.push(md.mine+md.theirs)}
  barsChart(box,vals,labs,0,t("Spent on {c}, last six months",{c:kidChild()}),"var(--kid)")}
$("kidAdd").addEventListener("click",()=>openKidItem(null,"theyPaid"));
$("kidRepay").addEventListener("click",()=>openKidItem(null,"repayIn"));
$("kidSend").addEventListener("click",openKidStatement);
$("kidMark").addEventListener("click",()=>{const cc=childCfg();if(!cc)return;filterTo("");$("fltCat").value="";toast(t("Tap an expense, then tick “For {c}”.",{c:kidChild()}))});

/* ---------- add or edit something outside your own spending ---------- */
function openKidItem(x,preset){
  const cc=childCfg();if(!cc)return;const o=kidOther();const isNew=!x;
  const p=curP();x=x||{id:uid("k"),kind:preset||"theyPaid",amount:"",cur:baseCur(),date:isCurP(p)?todayIso():iso(new Date(cur.y,cur.m+1,0)),note:"",share:+cc.share||0,att:[]};
  const att=(x.att||[]).slice();const added=[];let saved=false;
  const kind=selOf([["theyPaid",t("{o} paid for something",{o})],["repayIn",t("{o} paid me back",{o})],["repayOut",t("I paid {o} back",{o})],["adjust",t("Starting balance")]],x.kind);
  const amt=inp(x.amount!==""?String(x.amount).replace(".",","):"","","decimal");amt.placeholder="0";const cu=selOf(curOptions([x.cur]),x.cur||baseCur());const date=inp(x.date,"date");
  const note=inp(x.note||"");note.maxLength=80;note.placeholder=t("e.g. school trip, new shoes");
  const share=selOf(Array.from({length:21},(_,n)=>[String(n*5),t("{o} pays {p} %",{o,p:n*5})]),String(x.kind==="theyPaid"?x.share:+cc.share||0));
  const dir=selOf([["owesMe",t("{o} owes me",{o})],["iOwe",t("I owe {o}",{o})]],x.dir||"owesMe");
  const shareF=fld(t("Split"),share,t("The rest is your part, which you owe {o}.",{o}));const dirF=fld(t("Who owes whom"),dir,t("What was owed before you started using this tracker."));
  const r1=el("div","row2");r1.append(fld(t("Amount"),amt),fld(t("Currency"),cu));const r2=el("div","row2 row2-date");r2.append(fld(t("Note"),note),fld(t("Date"),date));
  const pick=el("div","kid-pick");
  const drawPick=()=>{pick.replaceChildren();if(!isNew||kind.value!=="repayIn")return;const from=iso(new Date(Date.now()-75*DAY));
    const c=allItems().filter(({i})=>i.type==="income"&&!i.childRepay&&i.date>=from).sort((a,b)=>b.i.date.localeCompare(a.i.date)).slice(0,5);if(!c.length)return;
    pick.appendChild(el("p","small",t("Did it reach your bank account? Pick it here instead, so it isn't counted twice:")));
    c.forEach(({k,i})=>{const b=el("button","pick-row");b.type="button";b.append(el("span","",dShort(i.date)+" · "+(i.note||i.cat)),el("b","amt",fmt(i.czk)));
      b.addEventListener("click",async()=>{docs[k].items=items(k).map(z=>z.id===i.id?{...z,childRepay:true}:z);saved=true;await persist();closeSheet();toast(t("Marked as a repayment from {o}",{o}));render()});pick.appendChild(b)})};
  const sync=()=>{shareF.hidden=kind.value!=="theyPaid";dirF.hidden=kind.value!=="adjust";drawPick()};kind.addEventListener("change",sync);
  const imgs=el("div","sub-sec");const ih=el("div","panel-head");ih.appendChild(el("b","",t("Receipts and images")));const addI=el("button","link",t("+ Add image"));addI.type="button";ih.appendChild(addI);const th=el("div","thumbs");imgs.append(ih,th);
  const drawThumbs=()=>{th.replaceChildren();if(!att.length){th.appendChild(el("span","small muted",t("None attached.")));return}
    att.forEach((aid,ix)=>{const b=el("button");b.type="button";b.setAttribute("aria-label",t("Open image {n}",{n:ix+1}));th.appendChild(b);b.addEventListener("click",()=>openViewer(null,{...x,att,czk:parseNum(amt.value)*rateOf(cu.value)||x.czk||0},ix));
      fileGet(aid).then(async rec=>{if(!rec||!key)return;const bytes=await decBytes(key,rec);const u=URL.createObjectURL(new Blob([bytes],{type:rec.type||"image/jpeg"}));sheetUrls.push(u);const im=el("img");im.src=u;im.alt="";b.appendChild(im)}).catch(()=>{})})};
  addI.addEventListener("click",()=>{attachTarget={cb:id=>{att.push(id);added.push(id);drawThumbs()}};$("attachFile").click()});drawThumbs();
  const hint=el("p","hint err");const save=el("button","primary",t("Save"));save.type="button";const del=el("button","danger",isNew?t("Cancel"):t("Delete"));del.type="button";const row=el("div","btnrow");row.append(save,del);
  save.addEventListener("click",async()=>{const a=parseNum(amt.value),c=cu.value;
    if(!(a>0)){hint.textContent=t("Enter an amount above zero.");return}if(!/^\d{4}-\d{2}-\d{2}$/.test(date.value)){hint.textContent=t("Choose a date.");return}if(!rateOf(c)){hint.textContent=t("Set the {c} exchange rate in Settings first.",{c});return}
    const n={id:x.id,kind:kind.value,amount:a,cur:c,czk:Math.round((c===x.cur&&a===x.amount&&x.czk!=null?x.czk:a*rateOf(c))*100)/100,date:date.value,note:note.value.trim().slice(0,80),ts:x.ts||Date.now()};
    if(n.kind==="theyPaid")n.share=+share.value;if(n.kind==="adjust")n.dir=dir.value;if(att.length)n.att=att;if(c!==baseCur())n.orig=a+" "+c;
    docs.child=docs.child||{items:[]};const l=kidExtra().filter(z=>z.id!==x.id);l.push(n);docs.child.items=l;saved=true;
    await persist();await dropUnused((x.att||[]).filter(z=>!att.includes(z)));closeSheet();toast(t("Saved."));render()});
  del.addEventListener("click",async()=>{if(isNew){closeSheet();return}if(!del.classList.contains("confirm")){del.classList.add("confirm");del.textContent=t("Tap again to delete");return}
    docs.child.items=kidExtra().filter(z=>z.id!==x.id);saved=true;await persist();await dropUnused(att);closeSheet();toast(t("Deleted"));render()});
  sheetClosed=()=>{if(!saved)dropUnused(added)};
  openSheet(isNew?t("Add to {n}",{n:cc.name}):t("Edit"),[fld(t("What happened?"),kind),pick,r1,r2,shareF,dirF,imgs,row,hint]);sync();
}

/* ---------- statements: PDF and text ---------- */
function kidText(md,opts){
  const cc=childCfg();const o=kidOther(),me=kidMe(),f=v=>money2(v);const L=[];
  L.push(cc.name+" · "+mName(md.y,md.m));if(opts.from)L.push(t("From {n}",{n:me}));L.push("");
  if(cc.balance!==false&&Math.abs(md.open)>=1)L.push(t("Balance on {d}: {x}",{d:dLong(iso(new Date(md.y,md.m,0))),x:kidOwes(md.open,"names",f)}),"");
  L.push(t("Paid by {n}: {x}",{n:me,x:f(md.mine)}));if(md.mine)L.push("  "+t("{n}'s share: {x}",{n:o,x:f(md.theirShare)}));
  L.push(t("Paid by {n}: {x}",{n:o,x:f(md.theirs)}));if(md.theirs)L.push("  "+t("{n}'s share: {x}",{n:me,x:f(md.myShare)}));
  if(md.repIn)L.push(t("Repaid by {a} to {b}: {x}",{a:o,b:me,x:f(md.repIn)}));if(md.repOut)L.push(t("Repaid by {a} to {b}: {x}",{a:me,b:o,x:f(md.repOut)}));
  L.push(t("For this month: {x}",{x:kidOwes(md.net,"names",f)}));
  if(cc.balance!==false)L.push(t("Balance on {d}: {x}",{d:dLong(md.e),x:kidOwes(md.close,"names",f)}));
  L.push("",t("Details"));
  if(!md.mv.length)L.push(t("Nothing recorded this month."));
  md.mv.forEach(x=>{const d=dShort(x.date);
    if(x.kind==="mine")L.push(d+" · "+(x.note||x.i.cat)+" · "+f(x.amount)+" · "+t("{n} {p} %",{n:o,p:x.share})+" = "+f(x.part));
    else if(x.kind==="theyPaid")L.push(d+" · "+t("paid by {n}",{n:o})+" · "+(x.note||"—")+" · "+f(x.amount)+" · "+t("{n} {p} %",{n:me,p:100-x.share})+" = "+f(x.part));
    else if(x.kind==="repayIn")L.push(d+" · "+t("repayment from {n}",{n:o})+" · "+f(x.amount)+(x.note?" · "+x.note:""));
    else if(x.kind==="repayOut")L.push(d+" · "+t("repayment to {n}",{n:o})+" · "+f(x.amount)+(x.note?" · "+x.note:""));
    else L.push(d+" · "+t("starting balance")+" · "+kidOwes(x.v,"names",f))});
  return L.join("\n");
}
async function kidPdf(md,withImages,progress){
  const cc=childCfg();const o=kidOther(),me=kidMe(),f=v=>money2(v);
  const sum=[[t("Spent on {c}",{c:kidChild()}),f(md.mine+md.theirs)],[t("Paid by {n}",{n:me}),f(md.mine)],[t("{n}'s share of that",{n:o}),f(md.theirShare)],[t("Paid by {n}",{n:o}),f(md.theirs)],[t("{n}'s share of that",{n:me}),f(md.myShare)]];
  if(md.repIn)sum.push([t("Repaid by {a} to {b}",{a:o,b:me}),f(md.repIn)]);if(md.repOut)sum.push([t("Repaid by {a} to {b}",{a:me,b:o}),f(md.repOut)]);
  sum.push([t("This month on its own"),kidOwes(md.net,"names",f),true]);
  if(cc.balance!==false){sum.unshift([t("Balance on {d}",{d:dLong(iso(new Date(md.y,md.m,0)))}),kidOwes(md.open,"names",f)]);sum.push([t("Balance on {d}",{d:dLong(md.e)}),kidOwes(md.close,"names",f),true])}
  const mine=md.mv.filter(x=>x.kind==="mine"),theirs=md.mv.filter(x=>x.kind==="theyPaid"),reps=md.mv.filter(x=>x.kind==="repayIn"||x.kind==="repayOut"||x.kind==="adjust");
  const cols=[{h:t("Date"),w:.12},{h:t("What"),w:.40},{h:t("Amount"),w:.17,align:"right"},{h:t("Split"),w:.12,align:"right"},{h:t("Share"),w:.19,align:"right"}];
  const tables=[
    {title:t("Paid by {n}",{n:me}),cols:cols.map((c,ix)=>ix===4?{...c,h:t("{n}'s share",{n:o})}:c),rows:mine.map(x=>[dShort(x.date),(x.note||x.i.cat)+(x.note&&x.i.cat?" ("+x.i.cat+")":""),f(x.amount),x.share+" %",f(x.part)]),
      total:mine.length?["",t("Total"),f(md.mine),"",f(md.theirShare)]:null,empty:t("Nothing this month.")},
    {title:t("Paid by {n}",{n:o}),cols:cols.map((c,ix)=>ix===4?{...c,h:t("{n}'s share",{n:me})}:c),rows:theirs.map(x=>[dShort(x.date),x.note||"—",f(x.amount),(100-x.share)+" %",f(x.part)]),
      total:theirs.length?["",t("Total"),f(md.theirs),"",f(md.myShare)]:null,empty:t("Nothing this month.")}];
  if(reps.length)tables.push({title:t("Repayments"),cols:[{h:t("Date"),w:.12},{h:t("What"),w:.64},{h:t("Amount"),w:.24,align:"right"}],
    rows:reps.map(x=>[dShort(x.date),(x.kind==="repayIn"?t("{a} to {b}",{a:o,b:me}):x.kind==="repayOut"?t("{a} to {b}",{a:me,b:o}):t("starting balance")+" · "+kidOwes(x.v,"names",f))+(x.note?" · "+x.note:""),f(x.amount)])});
  const images=[];
  if(withImages){const list=md.mv.filter(x=>x.att.length&&(x.kind==="mine"||x.kind==="theyPaid"));let n=0;const tot=list.reduce((a,x)=>a+x.att.length,0);
    for(const x of list)for(const id of x.att){progress&&progress(t("Adding receipts… {a} of {b}",{a:++n,b:tot}));try{const url=await imageDataUrl(id);if(url)images.push({url,cap:dShort(x.date)+" · "+(x.note||x.i.cat||"")+" · "+f(x.amount)})}catch(_){}}}
  return KCReport.pdf({title:cc.name,subtitle:mName(md.y,md.m)+(cc.child?" · "+cc.child:""),meta:[t("Between {a} and {b}",{a:me,b:o}),t("All amounts in {c}. Shares are worked out per expense.",{c:baseCur()})],
    summary:sum,tables,notes:[t("Prepared with Kč Ledger on {d}.",{d:dLong(todayIso())})],images,imagesTitle:t("Receipts"),footer:cc.name+" · "+mName(md.y,md.m),pageLabel:t("Page {a} of {b}")});
}
function openKidStatement(){
  const cc=childCfg();if(!cc)return;const st=ensureSettings();
  const opts=[];const nowD=new Date();for(let i=0;i<18;i++){const d=new Date(nowD.getFullYear(),nowD.getMonth()-i,1);opts.push([d.getFullYear()+"-"+d.getMonth(),mName(d.getFullYear(),d.getMonth())])}
  const ms=selOf(opts,cur.y+"-"+cur.m);if(ms.value!==cur.y+"-"+cur.m)ms.value=opts[0][0];
  const nm=inp(st.name||"");nm.maxLength=40;nm.placeholder=t("Your name");
  const imgC=chk(t("Include receipts and images"),true);const pre=el("pre","kid-pre");const info=el("p","hint");
  const md=()=>{const [y,m]=ms.value.split("-").map(Number);return kidMonthData(y,m)};
  const upd=()=>{const d=md();pre.textContent=kidText(d,{from:!!nm.value.trim()});const n=d.mv.filter(x=>x.kind==="mine"||x.kind==="theyPaid").reduce((a,x)=>a+x.att.length,0);imgC.hidden=!n;
    imgC.lastChild.textContent=" "+t("Include receipts and images")+(n?" ("+n+")":"")};
  const saveName=async()=>{const v=nm.value.trim().slice(0,40);if(v!==(st.name||"")){st.name=v;await persist()}upd()};
  ms.addEventListener("change",upd);nm.addEventListener("change",saveName);nm.addEventListener("input",upd);upd();
  const fname=d=>(cc.name+" "+d.mk).replace(/[\\/:*?"<>|]+/g,"").trim()+".pdf";
  const bPdf=el("button","primary",t("Share PDF statement"));bPdf.type="button";const bTxt=el("button","icon-btn",t("Share as text"));bTxt.type="button";const bCopy=el("button","icon-btn",t("Copy text"));bCopy.type="button";
  bPdf.addEventListener("click",async()=>{await saveName();bPdf.disabled=true;info.className="hint";info.textContent=t("Making the PDF…");
    try{const d=md();const blob=await kidPdf(d,!imgC.hidden&&imgC.input.checked,s=>info.textContent=s);info.textContent="";await offerFile(fname(d),blob)}
    catch(e){info.className="hint err";info.textContent=t("Couldn't make the PDF. Check your connection the first time, so the PDF tools can download.")}bPdf.disabled=false});
  bTxt.addEventListener("click",async()=>{await saveName();const tx=pre.textContent;if(navigator.share){try{await navigator.share({text:tx});return}catch(e){if(e&&e.name==="AbortError")return}}copyText(tx)});
  bCopy.addEventListener("click",async()=>{await saveName();copyText(pre.textContent)});
  const row=el("div","btnrow wrap");row.append(bPdf,bTxt,bCopy);
  openSheet(t("Send a statement"),[fld(t("Month"),ms),fld(t("Your name on the statement"),nm),imgC,el("h3","",t("Preview")),pre,row,info,
    el("p","fine",t("The statement is made on this device. Only what you choose to share leaves it."))]);
}
async function copyText(tx){try{await navigator.clipboard.writeText(tx);toast(t("Copied. Paste it into a message or email."))}catch(_){toast(t("Couldn't copy. Select the text in the preview instead."))}}

/* ---------- start ---------- */
let rz;addEventListener("resize",()=>{clearTimeout(rz);rz=setTimeout(renderCharts,150)});
if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="localhost"))navigator.serviceWorker.register("sw.js",{updateViaCache:"none"}).catch(()=>{});
{let l=null;try{l=localStorage.getItem("kc-lang")}catch(_){}if(!l)l=/^cs|^sk/i.test(navigator.language||"")?"cs":"en";setLang(l)}
boot();
})();
