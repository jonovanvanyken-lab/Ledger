/* Kč Ledger — PDF statements, made on this device with jsPDF and a DejaVu Sans subset (for Czech and other accents). */
(function(){"use strict";
let ready=null;
function load(src,check){return new Promise((res,rej)=>{if(check())return res();const s=document.createElement("script");s.src=src;s.onload=()=>res();s.onerror=()=>rej(new Error("load "+src));document.head.appendChild(s)})}
function init(){return ready||(ready=Promise.all([load("vendor/jspdf.umd.min.js?v=9",()=>window.jspdf),load("vendor/pdf-fonts.js?v=9",()=>window.KC_FONTS)]).catch(e=>{ready=null;throw e}))}
// the font subset has no thin spaces or Cyrillic, so swap those for what it has
const clean=s=>String(s==null?"":s).replace(/[   ]/g," ").replace(/лв/g,"BGN").replace(/[^\u0000-ɏ‐-‧€→−]/g,"?");
async function pdf(spec){
  await init();const {jsPDF}=window.jspdf;const d=new jsPDF({unit:"mm",format:"a4",compress:true});
  d.addFileToVFS("dv.ttf",window.KC_FONTS.regular);d.addFont("dv.ttf","DV","normal");d.addFileToVFS("dvb.ttf",window.KC_FONTS.bold);d.addFont("dvb.ttf","DV","bold");
  d.setProperties({title:clean(spec.title+(spec.subtitle?" · "+spec.subtitle:"")),creator:"Kč Ledger"});
  const W=210,H=297,M=16,TW=W-2*M,BOTTOM=H-M-6;let y=M;
  const font=(st,sz,col)=>{d.setFont("DV",st);d.setFontSize(sz);d.setTextColor.apply(d,col||[28,32,36])};
  const need=h=>{if(y+h>BOTTOM){d.addPage();y=M}};
  // heading
  d.setFillColor(47,107,79);d.rect(M,y,3,15,"F");
  font("bold",18);d.text(clean(spec.title),M+7,y+6.5);font("normal",11,[70,76,82]);if(spec.subtitle)d.text(clean(spec.subtitle),M+7,y+13);y+=21;
  font("normal",9,[110,116,122]);(spec.meta||[]).forEach(l=>{const ls=d.splitTextToSize(clean(l),TW);d.text(ls,M,y);y+=ls.length*4.3});y+=4;
  // summary
  if(spec.summary&&spec.summary.length){const rowH=6.6;const h=spec.summary.length*rowH+5;need(h);d.setFillColor(243,246,244);d.roundedRect(M,y,TW,h,2.5,2.5,"F");let yy=y+7;
    spec.summary.forEach(([a,b,strong])=>{font(strong?"bold":"normal",10.5,strong?[28,32,36]:[55,60,66]);const left=d.splitTextToSize(clean(a),TW*.55)[0];d.text(left,M+5,yy);d.text(clean(b),W-M-5,yy,{align:"right"});yy+=rowH});y+=h+8}
  // tables
  (spec.tables||[]).forEach(tb=>{
    const cols=tb.cols,xs=[];let acc=M;cols.forEach(c=>{xs.push(acc);acc+=c.w*TW});
    const cell=(v,ix,yy)=>{const c=cols[ix];if(c.align==="right")d.text(v,xs[ix]+c.w*TW-1.5,yy,{align:"right"});else d.text(v,xs[ix]+1.5,yy)};
    const head=()=>{font("bold",8.3,[100,106,112]);cols.forEach((c,ix)=>cell(clean(c.h),ix,y+3.6));y+=5.4;d.setDrawColor(190,196,200);d.setLineWidth(.3);d.line(M,y,W-M,y);y+=.6};
    need(22);font("bold",12.5);d.text(clean(tb.title),M,y+4.5);y+=8.5;head();
    if(!tb.rows.length){font("normal",9.5,[120,126,132]);d.text(clean(tb.empty||"—"),M+1.5,y+5);y+=9}
    tb.rows.forEach((r,ri)=>{font("normal",9.5);const lines=r.map((v,ix)=>d.splitTextToSize(clean(v),cols[ix].w*TW-3));const h=Math.max.apply(null,lines.map(l=>l.length))*4.3+2.6;
      if(y+h>BOTTOM){d.addPage();y=M;head()}
      if(ri%2){d.setFillColor(249,250,250);d.rect(M,y,TW,h,"F")}
      lines.forEach((l,ix)=>cell(l,ix,y+4.4));y+=h});
    d.setDrawColor(190,196,200);d.line(M,y,W-M,y);
    if(tb.total){need(8);font("bold",9.8);tb.total.forEach((v,ix)=>{if(v)cell(clean(v),ix,y+5)});y+=8}
    y+=7});
  // notes
  (spec.notes||[]).forEach(n=>{font("normal",8.6,[120,126,132]);const l=d.splitTextToSize(clean(n),TW);need(l.length*4.2+2);d.text(l,M,y+3);y+=l.length*4.2+2});
  // receipts, two to a page
  const imgs=spec.images||[];
  if(imgs.length){const slotH=(H-2*M-14)/2-8;
    imgs.forEach((im,ix)=>{if(ix%2===0){d.addPage();y=M;font("bold",12.5);d.text(clean(spec.imagesTitle||"Receipts"),M,y+4.5);y+=10}
      let p;try{p=d.getImageProperties(im.url)}catch(_){return}
      const sc=Math.min(TW/p.width,(slotH-6)/p.height);const w=p.width*sc,h=p.height*sc;
      font("normal",9,[90,96,102]);d.text(d.splitTextToSize(clean(im.cap),TW)[0],M,y+3.5);
      try{d.addImage(im.url,"JPEG",M+(TW-w)/2,y+6,w,h,undefined,"FAST")}catch(_){}
      d.setDrawColor(220,224,226);d.rect(M+(TW-w)/2,y+6,w,h);y+=slotH+8})}
  // page numbers
  const n=d.getNumberOfPages();for(let p=1;p<=n;p++){d.setPage(p);font("normal",7.8,[150,156,160]);d.text(clean(spec.footer||""),M,H-9);
    d.text(clean(String(spec.pageLabel||"{a} / {b}").replace("{a}",p).replace("{b}",n)),W-M,H-9,{align:"right"})}
  return d.output("blob");
}
window.KCReport={pdf,init};
})();
