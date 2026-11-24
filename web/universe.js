// @ts-check
/** @typedef {{start:number,end:number,count:number}} Bin */
/** @typedef {{name:string,count:number,bins:Bin[]}} Group */
/** @typedef {{source:string,target:string,count:number}} Route */
/** @typedef {{memory:number,documents:number,indexed:number,links:number,groups:Group[],routes:Route[]}} Overview */
/** @typedef {{id:number,label:string,size?:number,indexed?:boolean}} Item */
/** @typedef {{group:string,items:Item[],links:{source:number,target:number}[],external:{id:number,group:string,count:number}[],next:number|null}} Page */
const svg=/** @type {SVGSVGElement} */(document.querySelector('#universe'));
const statusElement=document.querySelector('#status');
const detail=document.querySelector('#detail');
const back=/** @type {HTMLButtonElement} */(document.querySelector('#back'));
const prev=/** @type {HTMLButtonElement} */(document.querySelector('#prev'));
const next=/** @type {HTMLButtonElement} */(document.querySelector('#next'));
const palette=['#427ECC','#26C9E4','#FFBF42','#9875CB','#36B879'];
const names=['Знания','Навыки','Опыт','Личность','Документы'];
/** @type {Overview|null} */let data=null;
/** @type {Page|null} */let page=null;
/** @type {{name:string,start:number,end:number}|null} */let focus=null;
let mode='all',scale=1,x=0,y=0,request=0,after=0,selected=0;
/** @type {number[]} */let history=[];
const ns='http://www.w3.org/2000/svg';
/** @template {keyof SVGElementTagNameMap} K
 * @param {K} tag @param {Record<string,string|number>} attrs @param {SVGElement} parent
 * @returns {SVGElementTagNameMap[K]} */
function el(tag,attrs,parent){const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));parent.append(n);return n;}
const scene=el('g',{},svg);
const fmt=(/** @type {number} */ n)=>n.toLocaleString('ru-RU');
const polar=(/** @type {number} */ a,/** @type {number} */ r)=>({x:Math.cos(a)*r,y:Math.sin(a)*r});
const angle=(/** @type {string} */ name)=>-Math.PI/2+names.indexOf(name)*Math.PI*2/names.length;
const color=(/** @type {string} */ name)=>palette[names.indexOf(name)]||'#8CA2B1';
/** @param {SVGElement} parent @param {number} x @param {number} y @param {string} value @param {string} fill @param {number} size */
function text(parent,x,y,value,fill,size){const t=el('text',{x,y,fill,'font-size':size,'text-anchor':'middle',class:'universe-text'},parent);t.textContent=value;return t;}
/** @param {SVGElement} node @param {string} label @param {()=>void} action */
function interactive(node,label,action){node.setAttribute('class','universe-node');node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',label);el('title',{},node).textContent=label;node.addEventListener('click',action);node.addEventListener('keydown',e=>{const k=/** @type {KeyboardEvent} */(e);if(k.key==='Enter'||k.key===' '){k.preventDefault();action();}});}
function transform(){scene.setAttribute('transform','translate('+x+' '+y+') scale('+scale+')');}
function reset(){scale=1;x=0;y=0;transform();}
/** @param {number} a @param {number} b @param {number} ra @param {number} rb @param {number} track */
function route(a,b,ra,rb,track){const p=polar(a,ra),q=polar(b,rb),u=polar(a,track),v=polar(b,track);const delta=((b-a+Math.PI*4)%(2*Math.PI));return 'M '+p.x+' '+p.y+' L '+u.x+' '+u.y+(Math.abs(delta)<.0001?'':' A '+track+' '+track+' 0 0 '+(delta<=Math.PI?1:0)+' '+v.x+' '+v.y)+' L '+q.x+' '+q.y;}
/** @param {SVGElement} parent @param {number} a @param {number} b @param {number} ra @param {number} rb @param {number} track @param {string} stroke @param {number} count */
function drawRoute(parent,a,b,ra,rb,track,stroke,count){el('path',{d:route(a,b,ra,rb,track),stroke,'stroke-width':Math.min(6,1.2+Math.log2(count+1)*.55),opacity:.8,class:'universe-route'},parent);}
function grid(){for(const r of [65,100,155,210,265,320,375,430,465])el('circle',{r,fill:'none',stroke:'#263948','stroke-width':.7,opacity:.55},scene);for(let i=0;i<60;i++){const a=i*Math.PI/30,p=polar(a,65),q=polar(a,465);el('line',{x1:p.x,y1:p.y,x2:q.x,y2:q.y,stroke:'#263948','stroke-width':.4,opacity:.5},scene);}}
function core(){el('circle',{r:55,fill:'#101923',stroke:'#26C9E4','stroke-width':2},scene);el('circle',{r:48,fill:'none',stroke:'#26C9E4',opacity:.35},scene);text(scene,0,-9,focus?focus.name:'ЯДРО','#D4E2E9',12);text(scene,0,9,focus&&page?fmt(page.items.length):fmt((data?.memory||0)+(data?.documents||0)),'#FFBF42',16);text(scene,0,25,focus?'на странице':'записей и файлов','#8CA2B1',8);}
function overview(){if(!data)return;const edges=el('g',{},scene),nodes=el('g',{},scene);const max=Math.max(1,...data.groups.map(g=>g.count));
    if(mode==='all'||mode==='links')data.routes.forEach((r,i)=>{if(!names.includes(r.source)||!names.includes(r.target))return;const a=angle(r.source),b=angle(r.target);if(r.source===r.target){const p=polar(a,210);el('circle',{cx:p.x,cy:p.y,r:28,fill:'none',stroke:color(r.source),'stroke-width':Math.min(6,1+Math.log2(r.count+1)),opacity:.75},edges);}else drawRoute(edges,a,b,155,155,175+i%12*12,color(r.source),r.count);});
    data.groups.forEach(g=>{const a=angle(g.name),c=color(g.name),doc=g.name==='Документы';
        if(mode==='documents'&&!doc||mode==='memory'&&doc)return;
        const hub=polar(a,155),lab=polar(a,115);
        if(mode!=='stats'){el('line',{x1:0,y1:0,x2:hub.x,y2:hub.y,stroke:c,'stroke-width':1.5,opacity:.45},edges);const n=el('circle',{cx:hub.x,cy:hub.y,r:12,fill:'#101923',stroke:c,'stroke-width':2},nodes);interactive(n,g.name+' · '+fmt(g.count),()=>open(g.name));text(nodes,lab.x,lab.y,g.name,c,12);text(nodes,hub.x,hub.y+24,fmt(g.count),c,12);}
        if(mode==='all'||mode==='memory'||mode==='documents')g.bins.forEach(bin=>{const i=(bin.start-1)/(bin.end-bin.start+1),col=i%4,row=Math.floor(i/4),a2=a+(col-1.5)*.19,r=235+row*48,p=polar(a2,r);el('path',{d:route(a,a2,155,r,200+row*8),stroke:c,'stroke-width':.9,opacity:.35,fill:'none'},edges);const attrs={cx:p.x,cy:p.y,r:Math.min(16,4+Math.log2(bin.count+1)),fill:'#101923',stroke:c,'stroke-width':1.5};const n=doc?el('rect',{x:p.x-7,y:p.y-9,width:14,height:18,rx:2,fill:'#101923',stroke:c,'stroke-width':1.5},nodes):el('circle',attrs,nodes);interactive(n,g.name+': '+fmt(bin.count)+' записей',()=>open(g.name,bin.start,bin.end));text(nodes,p.x,p.y+24,fmt(bin.count),c,10);});
        if(mode==='all'||mode==='stats'){const height=68*Math.log1p(g.count)/Math.log1p(max),start=430,bar=el('g',{transform:'rotate('+((a+Math.PI/2)*180/Math.PI)+')'},nodes);el('rect',{x:-20,y:-start-height,width:40,height:height,rx:2,fill:c,opacity:.82},bar);const p=polar(a,510);text(nodes,p.x,p.y,g.name+' '+fmt(g.count),c,12);}
    });
}
function details(){if(!page||!focus)return;const edges=el('g',{},scene),nodes=el('g',{},scene);const c=color(focus.name),isDoc=focus.name==='Документы';
    /** @type {Map<number,{x:number,y:number,a:number,r:number}>} */const positions=new Map();
    page.items.forEach((e,i)=>{const ring=Math.floor(i/20),slot=i%20,a=-Math.PI/2+slot*Math.PI/10+ring*.045,r=135+ring*78;positions.set(e.id,{...polar(a,r),a,r});});
    if(mode==='all'||mode==='links'||mode==='documents'){page.links.forEach((link,i)=>{const a=positions.get(link.source),b=positions.get(link.target);if(a&&b)drawRoute(edges,a.a,b.a,a.r,b.r,Math.max(a.r,b.r)+12+i%4*5,c,1);});
      // Group endpoints represent actual linked records, not invented individual stations.
      page.external.filter(e=>e.group!==focus?.name&&names.includes(e.group)).forEach((e,i)=>{const p=positions.get(e.id);if(p)drawRoute(edges,p.a,angle(e.group),p.r,440,410+i%4*7,color(e.group),e.count);});
      for(const name of names.filter(n=>n!==focus?.name)){const p=polar(angle(name),440);el('circle',{cx:p.x,cy:p.y,r:8,stroke:color(name),fill:'#101923'},nodes);text(nodes,p.x,p.y+20,name,color(name),10);}}
    page.items.forEach((item,i)=>{const p=positions.get(item.id);if(!p)return;const n=isDoc?el('rect',{x:p.x-6,y:p.y-8,width:12,height:16,rx:2,fill:'#101923',stroke:c,'stroke-width':2},nodes):el('circle',{cx:p.x,cy:p.y,r:5,fill:c,stroke:'#D4E2E9','stroke-width':1},nodes);interactive(n,item.label,()=>{selected=item.id;render();detail.textContent=item.label+(isDoc?' · '+fmt(item.size||0)+' байт · '+(item.indexed?'текст проиндексирован':'метаданные'):'');});if(selected===item.id)n.classList.add('universe-selected');if(page&&page.items.length<=24||selected===item.id)text(nodes,p.x,p.y-12,item.label.length>22?item.label.slice(0,21)+'…':item.label,c,10);});
}
function render(){scene.replaceChildren();grid();if(focus)details();else overview();core();transform();back.hidden=!focus;prev.hidden=!focus||!history.length;next.hidden=!focus||!page?.next;statusElement.textContent=data?fmt(data.memory)+' записей · '+fmt(data.documents)+' документов · '+fmt(data.links)+' связей':'Подключение…';}
async function load(){const id=++request;try{const response=await fetch('/api/universe');if(!response.ok)throw Error();const result=await response.json();if(id!==request)return;data=result;focus=null;page=null;history=[];selected=0;detail.textContent='Выберите кластер или группу';render();}catch{if(id===request)statusElement.textContent='Не удалось загрузить карту';}}
async function loadPage(){if(!focus)return;const id=++request;const q=new URLSearchParams({group:focus.name,after:String(after),start:String(focus.start),end:String(focus.end)});try{const response=await fetch('/api/universe/page?'+q);if(!response.ok)throw Error();const result=await response.json();if(id!==request)return;page=result;selected=0;detail.textContent=focus.name+' · '+fmt(page.items.length)+' элементов на странице';render();}catch{if(id===request)detail.textContent='Не удалось загрузить кластер';}}
/** @param {string} name @param {number} [start] @param {number} [end] */
function open(name,start=1,end=Number.MAX_SAFE_INTEGER){focus={name,start,end};page=null;history=[];after=0;reset();void loadPage();}
back.addEventListener('click',()=>{request++;focus=null;page=null;history=[];reset();detail.textContent='Выберите кластер или группу';render();});
next.addEventListener('click',()=>{if(page?.next){history.push(after);after=page.next;void loadPage();}});
prev.addEventListener('click',()=>{if(history.length){after=history.pop();void loadPage();}});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.getAttribute('data-mode')||'all';document.querySelectorAll('[data-mode]').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));if(focus){request++;focus=null;page=null;history=[];reset();}render();}));
const refresh=/** @type {HTMLButtonElement} */(document.querySelector('#refresh'));
refresh.addEventListener('click',async()=>{refresh.disabled=true;try{const response=await fetch('/api/universe/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw Error();const scan=await response.json();await load();if(scan.errors)detail.textContent='Часть файлов недоступна: '+scan.errors;}catch{detail.textContent='Не удалось обновить документы';}finally{refresh.disabled=false;}});
svg.addEventListener('wheel',e=>{e.preventDefault();const m=svg.getScreenCTM();if(!m)return;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse()),s=Math.min(8,Math.max(.65,scale*Math.exp(-e.deltaY*.001)));x=p.x-(p.x-x)*s/scale;y=p.y-(p.y-y)*s/scale;scale=s;transform();},{passive:false});
/** @type {{id:number,x:number,y:number}|null} */let drag=null;
svg.addEventListener('pointerdown',e=>{if(/** @type {Element} */(e.target).closest('.universe-node'))return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};svg.setPointerCapture(e.pointerId);});
svg.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const m=svg.getScreenCTM();if(!m)return;x+=(e.clientX-drag.x)/m.a;y+=(e.clientY-drag.y)/m.d;drag.x=e.clientX;drag.y=e.clientY;transform();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(event,()=>{drag=null;});
document.querySelector('#reset').addEventListener('click',reset);
const legend=document.querySelector('#legend');names.forEach((name,i)=>{const b=document.createElement('button');b.textContent=name;b.style.color=palette[i];b.addEventListener('click',()=>open(name));legend.append(b);});
render();void load();
export {};
