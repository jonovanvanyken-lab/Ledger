/* Kč Ledger import: bank CSV exports → ledger items. Runs entirely on the device.
   Items carry a "kind" (groceries, salary, …) that the app maps to your own category names. */
(function(){
"use strict";
const N=s=>String(s==null?"":s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ").trim();
const pad=n=>String(n).padStart(2,"0");

/* ---------- CSV ---------- */
function parseCSV(text,delim){
  text=String(text).replace(/^﻿/,"");if(!delim){const head=text.split(/\r?\n/).slice(0,25).join("\n");const c={";":0,",":0,"\t":0};let q=false;
    for(const ch of head){if(ch==='"')q=!q;else if(!q&&ch in c)c[ch]++}delim=Object.keys(c).sort((a,b)=>c[b]-c[a])[0]}
  const rows=[];let row=[],f="",q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(q){if(ch==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=ch}
    else if(ch==='"')q=true;else if(ch===delim){row.push(f);f=""}
    else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(f);f="";if(row.length>1||row[0])rows.push(row);row=[]}
    else f+=ch}
  if(f||row.length){row.push(f);rows.push(row)}
  return {rows,delim};
}
const rbParseCSV=t=>parseCSV(t,";").rows;

/* ---------- categorising by keywords ---------- */
const KIND_RULES=[
  ["kids",/skolk|skolne|krouzek|detsk|hrack|plenk|pleny|babyshop|kojen|\bkids?\b|\btoys?\b|nursery|daycare|\bschool\b|\blego\b|pediatr/],
  ["groceries",/tesco|lidl|albert|globus|billa|kaufland|penny|rohlik|\bcoop\b|norma|hruska|zabka|\bspar\b|aldi|potravin|supermarket|grocer|sainsbury|asda|woolworths|coles/],
  ["household",/ikea|hornbach|\bobi\b|bauhaus|jysk|rossmann|\bdm\b|drogerie|tescoma|mountfield|\bteta\b|\baction\b/],
  ["dining",/restaura|bistro|\bcafe|kavarn|coffee|cajovn|pizz|burger|mcdonald|\bkfc\b|starbucks|\bwolt\b|foodora|bolt food|damejidlo|\bpub\b|\bbar\b|pivnic|hospod|pickle|sklep|costa/],
  ["transport",/autobus|odis|\bdpo\b|regiojet|rjcz|idsjmk|ids jmk|ceske drahy|\bcd\.cz|leo express|aircoach|\bbus\b|\btram|metro|\buber\b|\bbolt\b|liftago|benzin|\bshell\b|\bomv\b|\bmol\b|orlen|eurooil|parking/],
  ["phone",/vodafone|t-mobile|\bo2\b|kaktus|\bmobil/],
  ["utilities",/\bcez\b|innogy|e\.on|\beon\b|ppas|bohemia energy|\bplyn|elektr|veolia|vodarn|smvak/],
  ["health",/lekarn|pharm|dr\.?\s?max|benu|nemocnic|klinik|zubar|ordinac|doctor/],
  ["hobbies",/\bgym\b|fitness|sport|bouldr|climb|plaveck|bazen|cinema|\bkino\b|steam|decathlon/],
  ["subscriptions",/spotify|netflix|apple\.com|youtube|disney|\bhbo\b|voyo|icloud|microsoft/],
  ["insurance",/pojist|insurance|allianz|kooperativa|generali|uniqa/],
  ["travel",/hotel|booking\.com|airbnb|ryanair|wizz|easyjet|letiste|airport/]];
function kindFromText(text){const h=N(text);const hit=KIND_RULES.find(([k,re])=>re.test(h));return hit?hit[0]:null}
const isSalaryText=(h,words)=>/\b(mzda|vyplata|salary|payroll|wage)\b/.test(h)||(words||[]).some(w=>w&&h.includes(N(w)));
function incomeKind(text,words){const h=N(text);if(isSalaryText(h,words))return "salary";if(/\burok|interest/.test(h))return "interest";if(/vyzivn|maintenance|child support/.test(h))return "maintenance";
  if(/davk|prispev|\bbenefit|socialni|rodicovsk/.test(h))return "benefits";if(/\bwise\b|transferwise/.test(h))return "transfer";return "other"}
function rbKey(merchant,message){return (merchant||message||"").toLowerCase().split(";")[0].replace(/\*.*$/,"").replace(/[0-9]+/g,"").trim().slice(0,40)}

/* ---------- Raiffeisenbank "Movements" export (English) ---------- */
function rbToItems(text,opts){
  opts=opts||{};const rows=rbParseCSV(text);if(!rows.length)return {items:[],skipped:0,error:"empty"};
  const H=rows[0].map(h=>h.trim());const ix=name=>H.indexOf(name);
  if(["Transaction Date","Account number","Transaction type","Booked amount","Transaction ID"].some(n=>ix(n)<0))return {items:[],skipped:0,error:"format"};
  const iCnt=5,iCntName=6,iMsg=ix("Message"),iNote=H.indexOf("Note"),iMer=ix("Merchant"),iOrig=ix("Original Amount and Currency");
  const own=new Set(opts.ownAccounts||[]);const items=[];let skipped=0;
  rows.slice(1).forEach(r=>{if(r.length>=H.length-2)own.add(r[ix("Account number")])});
  rows.slice(1).forEach(r=>{
    if(r.length<H.length-2)return;const [d,m,y]=(r[ix("Transaction Date")]||"").split(".");if(!y)return;
    const date=y+"-"+m.padStart(2,"0")+"-"+d.padStart(2,"0");const tm=((r[ix("Booking Date")]||"").match(/\d{1,2}:\d{2}/)||[""])[0];
    const amt=parseFloat(String(r[ix("Booked amount")]).replace(/\s/g,"").replace(",","."));if(!isFinite(amt)||amt===0)return;
    const ttype=r[ix("Transaction type")]||"";const cnt=r[iCnt]||"";const cntName=r[iCntName]||"";const msg=r[iMsg]||"",note=r[iNote]||"",mer=(iMer>=0?r[iMer]:"")||"";
    const hay=mer+" "+msg+" "+note+" "+cntName;const id="rb-"+r[ix("Transaction ID")];
    const segs=msg.split(";").map(s=>s.trim()).filter(Boolean);if(segs[0]&&/^[\d.,]+\s[A-Z]{3}$/.test(segs[0]))segs.shift();
    let type,kind,cat,label=mer||segs[0]||note||cntName||ttype;if(/atm/i.test(ttype))label="Cash withdrawal"+(segs[0]?" · "+segs[0]:"");
    const origAmt=iOrig>=0?parseFloat(String(r[iOrig]).replace(",",".")):NaN;const origCur=iOrig>=0?r[iOrig+1]:"";const foreign=(origCur&&origCur!=="CZK")||/abroad/i.test(ttype);
    if(/investment/i.test(note)||/investment/i.test(msg)){if(amt<0){type="saving";kind="investing";label="Transfer to investment account"}else{skipped++;return}}
    else if(own.has(cnt)){if(amt<0&&/micro savings/i.test(ttype)&&opts.emergencyTarget&&Math.abs(amt)===opts.emergencyTarget){type="saving";kind="emergency";label="Micro Savings"}else{skipped++;return}}
    else if(/accrued interest/i.test(ttype)){type="income";kind="interest";label=note||"Interest"}
    else if(/interest tax/i.test(ttype)){type="income";kind="interest";label="Withholding tax on interest"}
    else if(amt>0){type="income";kind=incomeKind(hay,opts.salaryWords);label=cntName||note||ttype;if(/reward/i.test(ttype))label="RB reward"}
    else{type="expense";const k=rbKey(mer,msg);if(opts.rules&&opts.rules[k])cat=opts.rules[k];else if(/\brent\b|najem/i.test(N(msg+" "+note)))kind="rent";else if(foreign)kind="travel";else kind=kindFromText(hay)||"misc"}
    const it={id,type,kind,cat,amount:Math.abs(amt),cur:"CZK",czk:type==="income"?amt:Math.abs(amt),note:label.slice(0,80),date,ts:0,src:"rb",key:rbKey(mer,msg)};
    if(tm)it.time=tm;if(foreign&&isFinite(origAmt))it.orig=Math.abs(origAmt)+" "+origCur;items.push(it);
  });
  return {items,skipped};
}

/* ---------- any bank: column matching ---------- */
const SYN={
  date:["transaction date","datum transakce","datum provedeni","datum pohybu","datum","date","booking date","datum zauctovani","datum zuctovani","completed date","started date","posting date","value date","valuta"],
  amount:["amount","castka","objem","booked amount","zauctovana castka","castka v mene uctu","castka transakce","suma","hodnota"],
  out:["debit","vydaj","vydej","odchozi","withdrawal","paid out","money out","debet","out"],
  inn:["credit","prijem","prichozi","deposit","paid in","money in","kredit","in"],
  currency:["currency","mena","mena uctu","mena transakce"],
  name:["merchant","obchodnik","nazev obchodnika","nazev protiuctu","protistrana","counterparty","counterparty name","payee name","payer name","nazev","popis","description","prijemce","odesilatel","partner","name"],
  message:["message","zprava","zprava pro prijemce","poznamka","note","reference","payment reference","detail","upresneni","komentar","vlastni poznamka","popis transakce","informace"],
  counter:["counterparty account","protiucet","cislo protiuctu","ucet protistrany","payee account number","payee account"],
  own:["account number","cislo uctu","vas ucet","your account","muj ucet"],
  id:["transaction id","id transakce","id pohybu","transferwise id","id","reference number","cislo transakce","identifikace transakce"],
  type:["type","typ","typ transakce","transaction type","druh transakce","typ pohybu"],
  state:["state","stav"],fee:["fee","poplatek","total fees"],time:["time","cas"]};
const FIELDS=["date","amount","out","inn","currency","name","message","counter","own","id","type","state","fee","time"];
function scoreHeader(cells){let s=0;cells.forEach(c=>{const h=N(c);if(!h)return;for(const f of FIELDS)if(SYN[f].includes(h)){s+=2;return}for(const f of FIELDS)if(SYN[f].some(x=>x.length>3&&h.includes(x))){s+=1;return}});return s}
function sniff(text){
  const {rows,delim}=parseCSV(text);let hIdx=0,best=-1;rows.slice(0,25).forEach((r,i)=>{const sc=scoreHeader(r);if(sc>best){best=sc;hIdx=i}});
  const header=(rows[hIdx]||[]).map(h=>String(h).trim());const nh=header.map(N);const has=x=>nh.includes(x);
  let format="generic";
  if(has("transaction date")&&has("booked amount")&&has("transaction id"))format="rb";
  else if(has("started date")&&has("completed date")&&has("state"))format="revolut";
  else if(has("transferwise id")||(has("running balance")&&has("payee name")))format="wise";
  const sig=nh.join("|").slice(0,400);
  return {rows,delim,hIdx,header,sig,format,guess:autoMap(header,format)};
}
function autoMap(header,format){
  const nh=header.map(N);const map={};const used=new Set();
  const pick=(f,list)=>{list=list||SYN[f];for(const syn of list){const i=nh.findIndex((h,j)=>!used.has(j)&&h===syn);if(i>=0){map[f]=i;used.add(i);return}}
    for(const syn of list){if(syn.length<4)continue;const i=nh.findIndex((h,j)=>!used.has(j)&&h.includes(syn));if(i>=0){map[f]=i;used.add(i);return}}};
  if(format==="revolut"){pick("date",["completed date","started date"]);pick("amount",["amount"]);pick("fee",["fee"]);pick("currency",["currency"]);pick("name",["description"]);pick("type",["type"]);pick("state",["state"]);return map}
  if(format==="wise"){pick("id",["transferwise id","id"]);pick("date",["date"]);pick("amount",["amount"]);pick("currency",["currency"]);pick("name",["merchant","payee name","payer name"]);pick("message",["description","payment reference"]);pick("fee",["total fees"]);return map}
  ["id","date","time","amount","currency","counter","own","name","message","type","state","fee"].forEach(f=>pick(f));
  if(map.amount==null){pick("out");pick("inn")}
  return map;
}
function parseDate(s){s=String(s||"").trim();let m;
  if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)))return {d:m[1]+"-"+pad(m[2])+"-"+pad(m[3]),t:m[4]?pad(m[4])+":"+m[5]:""};
  if((m=s.match(/^(\d{1,2})[.\/-]\s?(\d{1,2})[.\/-]\s?(\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/))){let y=+m[3];if(y<100)y+=2000;let d=+m[1],mo=+m[2];if(mo>12&&d<=12){const x=d;d=mo;mo=x}
    if(mo<1||mo>12||d<1||d>31)return null;return {d:y+"-"+pad(mo)+"-"+pad(d),t:m[4]?pad(m[4])+":"+m[5]:""}}
  return null}
function parseAmt(s){s=String(s==null?"":s).replace(/ /g," ").trim();if(!s)return NaN;const neg=/^[-−–]|^\(.*\)$|[-−]$/.test(s);
  s=s.replace(/[^\d,.]/g,"");const lc=s.lastIndexOf(","),ld=s.lastIndexOf(".");let dec=null;
  if(lc>-1&&ld>-1)dec=lc>ld?",":".";else if(lc>-1)dec=s.length-lc-1<=2?",":null;else if(ld>-1)dec=s.length-ld-1<=2?".":null;
  const x=dec===","?s.replace(/\./g,"").replace(",","."):dec==="."?s.replace(/,/g,""):s.replace(/[.,]/g,"");const v=parseFloat(x);return isFinite(v)?(neg?-v:v):NaN}
function hash(s){let h1=0x811c9dc5,h2=0x1b873593;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,16777619);h2=Math.imul(h2^c,2246822507)}return (h1>>>0).toString(36)+(h2>>>0).toString(36)}
function dirFromType(v){const h=N(v);if(/^(d|debit|vydaj|odchozi|platba|withdrawal)/.test(h))return -1;if(/^(c|k|credit|kredit|prijem|prichozi|deposit)/.test(h))return 1;return 0}
// opts: {format, base, ownAccounts, salaryWords, rules, sigTag}
function convert(pc,map,opts){
  opts=opts||{};const rows=pc.rows.slice(pc.hIdx+1);const get=(r,f)=>map[f]!=null?String(r[map[f]]==null?"":r[map[f]]).trim():"";
  const own=new Set((opts.ownAccounts||[]).map(N));const items=[];let skipped=0,bad=0;const seen={};const tag=opts.sigTag||hash(pc.sig).slice(0,6);
  rows.forEach(r=>{
    if(!r.some(c=>String(c).trim()))return;const dd=parseDate(get(r,"date"));if(!dd){bad++;return}
    let amt;if(map.amount!=null){amt=parseAmt(get(r,"amount"));if(map.type!=null&&amt>0){const dir=dirFromType(get(r,"type"));if(dir<0)amt=-amt}}
    else{const o=Math.abs(parseAmt(get(r,"out"))||0),i=Math.abs(parseAmt(get(r,"inn"))||0);amt=i-o}
    if(!isFinite(amt)||amt===0){bad++;return}
    if(map.fee!=null){const fee=Math.abs(parseAmt(get(r,"fee"))||0);if(fee&&opts.format==="revolut")amt-=fee}
    const state=N(get(r,"state"));if(map.state!=null&&state&&!/^(completed|dokonc|provede|zauctov)/.test(state)){skipped++;return}
    const ty=N(get(r,"type"));const idv=get(r,"id");
    if(opts.format==="revolut"&&/^(topup|exchange)/.test(ty)){skipped++;return}
    if(opts.format==="wise"&&/^balance-/.test(N(idv))){skipped++;return}
    const counter=N(get(r,"counter"));if(counter&&own.has(counter)){skipped++;return}
    const name=get(r,"name"),msg=get(r,"message");let label=name||msg||get(r,"type")||"";if(name&&msg&&opts.format!=="wise"&&!N(name).includes(N(msg))&&!N(msg).includes(N(name)))label=name+" · "+msg;label=label.replace(/\s+/g," ").slice(0,80);
    const cur=(get(r,"currency")||opts.base||"CZK").toUpperCase().slice(0,3);const tm=get(r,"time").match(/\d{1,2}:\d{2}/);
    const base=dd.d+"|"+amt+"|"+N(name)+"|"+N(msg)+"|"+counter;seen[base]=(seen[base]||0)+1;
    const id=idv?"csv-"+tag+"-"+N(idv).replace(/[^a-z0-9-]/g,"").slice(0,60):"csv-"+tag+"-"+hash(base+"|"+seen[base]);
    const key=rbKey(name,msg);let type,kind,cat;
    if(amt>0){type="income";kind=incomeKind(name+" "+msg,opts.salaryWords)}
    else{type="expense";if(opts.rules&&opts.rules[key])cat=opts.rules[key];else kind=/\brent\b|najem|najemne/.test(N(name+" "+msg))?"rent":(kindFromText(name+" "+msg)||"other")}
    const it={id,type,kind,cat,amount:Math.abs(amt),cur,note:label,date:dd.d,ts:0,src:"csv",key};if(dd.t||tm)it.time=dd.t||tm[0].padStart(5,"0");
    items.push(it)});
  return {items,skipped,bad};
}
function ownAccountsIn(pc,map){if(map.own==null)return [];return [...new Set(pc.rows.slice(pc.hIdx+1).map(r=>String(r[map.own]||"").trim()).filter(Boolean))]}
function previewRows(pc,map,n){return convert({...pc,rows:pc.rows.slice(0,pc.hIdx+1+(n||6))},map,{}).items}

window.KCImport={parseCSV,sniff,autoMap,convert,ownAccountsIn,previewRows,kindFromText,incomeKind,rbToItems,rbKey,parseDate,parseAmt,FIELDS};
window.rbParseCSV=rbParseCSV;window.rbToItems=rbToItems;window.rbKey=rbKey;window.kindFromText=kindFromText;
})();
