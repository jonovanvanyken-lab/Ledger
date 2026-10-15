// Raiffeisenbank CZ "Movements" CSV -> ledger items. Shared by the page and the one-off import.
function rbParseCSV(text){
  text=text.replace(/^﻿/,"");
  const rows=[];let row=[],f="",q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"')q=true;
    else if(c===';'){row.push(f);f=""}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(f);f="";if(row.length>1||row[0])rows.push(row);row=[]}
    else f+=c}
  if(f||row.length){row.push(f);rows.push(row)}
  return rows;
}
const RB_RULES=[
  ["Groceries",/tesco|lidl|albert|globus|billa|kaufland|penny|rohlik|coop|norma|hruska|žabka|zabka/],
  ["Household & cleaning",/ikea|hornbach|\bobi\b|bauhaus|jysk|rossmann|\bdm\b|drogerie|tescoma|mountfield/],
  ["Eating out & cafés",/restaura|bistro|cafe|caf[eé]|kavarn|kavárn|coffee|cajovn|čajovn|pizz|burger|mcdonald|kfc|starbucks|wolt|foodora|bolt food|damejidlo|pub|\bbar\b|pivnic|hospod|pickle|sklep/],
  ["Public transport",/autobus|odis|\bdpo\b|regiojet|rjcz|idsjmk|ids jmk|ceske drahy|české dráhy|\bcd\.cz|leo express|aircoach|\bbus\b|tram|metro/],
  ["Phone",/vodafone|t-mobile|\bo2\b|kaktus|mobil/],
  ["Gas & electricity",/čez|\bcez\b|innogy|e\.on|ppas|bohemia energy|plyn|elektr/],
  ["Health & pharmacy",/lekarn|lékárn|pharm|dr\.?\s?max|benu|nemocnic|klinik|zubar/],
  ["Gym & hobbies",/gym|fitness|sport|bouldr|climb|plaveck|bazen|bazén|cinema|kino|steam|spotify|netflix/],
];
function rbKey(merchant,message){return (merchant||message||"").toLowerCase().split(";")[0].replace(/\*.*$/,"").replace(/[0-9]+/g,"").trim().slice(0,40)}
// opts: {rules:{merchantKey:cat}, ownAccounts:[...], emergencyTarget:number}
function rbToItems(text,opts){
  opts=opts||{};const rows=rbParseCSV(text);if(!rows.length)return {items:[],skipped:0,error:"empty"};
  const H=rows[0].map(h=>h.trim());
  const ix=name=>H.indexOf(name);
  const need=["Transaction Date","Account number","Transaction type","Booked amount","Transaction ID"];
  if(need.some(n=>ix(n)<0))return {items:[],skipped:0,error:"This doesn't look like a Raiffeisenbank Movements export."};
  const iCnt=5,iCntName=6;// counterparty account + name (header has a typo'd duplicate "Accocunt Number")
  const iMsg=ix("Message"),iNote=H.indexOf("Note"),iMer=ix("Merchant"),iOrig=ix("Original Amount and Currency");
  const own=new Set(opts.ownAccounts||[]);
  const items=[];let skipped=0;
  rows.slice(1).forEach(r=>{
    if(r.length<H.length-2)return;
    own.add(r[ix("Account number")]);
  });
  rows.slice(1).forEach(r=>{
    if(r.length<H.length-2)return;
    const [d,m,y]=(r[ix("Transaction Date")]||"").split(".");if(!y)return;
    const date=y+"-"+m.padStart(2,"0")+"-"+d.padStart(2,"0");
    const amt=parseFloat(String(r[ix("Booked amount")]).replace(/\s/g,"").replace(",","."));if(!isFinite(amt)||amt===0)return;
    const ttype=(r[ix("Transaction type")]||"");const cnt=r[iCnt]||"";const cntName=r[iCntName]||"";
    const msg=r[iMsg]||"",note=r[iNote]||"",mer=(iMer>=0?r[iMer]:"")||"";
    const hay=(mer+" "+msg+" "+note+" "+cntName).toLowerCase();
    const id="rb-"+r[ix("Transaction ID")];
    const segs=msg.split(";").map(s=>s.trim()).filter(Boolean);if(segs[0]&&/^[\d.,]+\s[A-Z]{3}$/.test(segs[0]))segs.shift();
    let type,cat,label=mer||segs[0]||note||cntName||ttype;
    if(/atm/i.test(ttype))label="Cash withdrawal"+(segs[0]?" · "+segs[0]:"");
    const origAmt=iOrig>=0?parseFloat(String(r[iOrig]).replace(",",".")):NaN;const origCur=iOrig>=0?r[iOrig+1]:"";
    const foreign=(origCur&&origCur!=="CZK")||/abroad/i.test(ttype);
    if(/investment/i.test(note)||/investment/i.test(msg)){ if(amt<0){type="saving";cat="Investing";label="Transfer to investment account"} else {skipped++;return} }
    else if(own.has(cnt)){
      if(amt<0&&/micro savings/i.test(ttype)&&opts.emergencyTarget&&Math.abs(amt)===opts.emergencyTarget){type="saving";cat="Emergency savings";label="Micro Savings"}
      else{skipped++;return}
    }
    else if(/accrued interest/i.test(ttype)){type="income";cat="Interest";label=note||"Interest"}
    else if(/interest tax/i.test(ttype)){type="income";cat="Interest";label="Withholding tax on interest"}
    else if(amt>0){type="income";cat=/vsb|všb/i.test(hay)?"Salary":/\bwise\b|transferwise/i.test(hay)?"Transfer from Australia":"Other income";label=cntName||note||ttype;if(/reward/i.test(ttype))label="RB reward"}
    else{
      type="expense";const k=rbKey(mer,msg);
      if(opts.rules&&opts.rules[k])cat=opts.rules[k];
      else if(/\brent\b|nájem|najem/i.test(msg+" "+note))cat="Rent";
      else if(foreign)cat="Travel";
      else{const hit=RB_RULES.find(([c,re])=>re.test(hay));cat=hit?hit[0]:"Clothing & misc"}
    }
    const it={id,type,cat,amount:Math.abs(amt),cur:"CZK",czk:type==="income"?amt:Math.abs(amt),note:label.slice(0,80),date,ts:0,src:"rb",key:rbKey(mer,msg)};
    if(foreign&&isFinite(origAmt)){it.orig=Math.abs(origAmt)+" "+origCur}
    items.push(it);
  });
  return {items,skipped};
}
if(typeof module!=="undefined")module.exports={rbToItems,rbParseCSV};
