// @ts-check
/** @typedef {{id:number,category:string,label:string}} Entry */
/** @typedef {{source:number,target:number}} Link */
/** @typedef {{x:number,y:number,a:number,r:number,color:string}} Point */
const svg = /** @type {SVGSVGElement} */ (document.querySelector('#metro'));
const graphStatus = /** @type {HTMLElement} */ (document.querySelector('#graph-status'));
const linkStatus = /** @type {HTMLElement} */ (document.querySelector('#link-status'));
const detail = /** @type {HTMLElement} */ (document.querySelector('#detail'));
const from = /** @type {HTMLSelectElement} */ (document.querySelector('#from'));
const to = /** @type {HTMLSelectElement} */ (document.querySelector('#to'));
const categories = ['Знания','Навыки','Опыт','Личность'];
const colors = ['#4aa5ff','#55dc99','#ffab58','#b699f9'];
const ns = 'http://www.w3.org/2000/svg';
/** @template {keyof SVGElementTagNameMap} K
 * @param {K} tag @param {Record<string,string|number>} attrs @param {SVGElement} parent
 * @returns {SVGElementTagNameMap[K]} */
function shape(tag, attrs, parent) {
    const el = document.createElementNS(ns,tag);
    for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,String(v));
    parent.append(el);
    return el;
}
const scene = shape('g',{},svg);
/** @type {Entry[]} */ let entries = [];
/** @type {Link[]} */ let links = [];
let selected = 0, revision = 0, scale = 1, x = 0, y = 0;
/** @param {number} a @param {number} r */
const polar = (a,r) => ({x:Math.cos(a)*r,y:Math.sin(a)*r});
/** @param {number} r @param {number} a @param {number} b */
function arc(r,a,b) {
    const p=polar(a,r), q=polar(b,r);
    return 'M '+p.x+' '+p.y+' A '+r+' '+r+' 0 0 1 '+q.x+' '+q.y;
}
function transform(){scene.setAttribute('transform','translate('+x+' '+y+') scale('+scale+')');}
/** @param {number} id */
function highlight(id) {
    selected=id;
    document.querySelectorAll('[data-entry-id]').forEach(el=>el.classList.toggle('selected',Number(el.getAttribute('data-entry-id'))===id));
    scene.querySelectorAll('[data-link-endpoints]').forEach(el=>{
        const endpoints=(el.getAttribute('data-link-endpoints')||'').split(',').map(Number);
        el.setAttribute('opacity',endpoints.includes(id)?'1':'.38');
        el.setAttribute('stroke-width',endpoints.includes(id)?'3.5':'1.6');
    });
}
/** @param {Entry} entry */
function choose(entry) {
    detail.textContent=entry.category+' — '+entry.label;
    from.value=String(entry.id);
    document.dispatchEvent(new CustomEvent('memory:selected',{detail:entry.id}));
}
function render(){
    scene.replaceChildren();
    for(const r of [65,110,160,210,260,310,360,410,445]) shape('circle',{r,class:'metro-grid'},scene);
    for(let i=0;i<43;i++){
        const a=-Math.PI/2+i*Math.PI*2/43, p=polar(a,445), q=polar(a,65), t=polar(a,467);
        shape('line',{x1:q.x,y1:q.y,x2:p.x,y2:p.y,class:'metro-grid'},scene);
        shape('text',{x:t.x,y:t.y+3,'text-anchor':'middle',fill:'#69838d','font-size':10},scene).textContent=String(i+1);
    }
    /** @type {Map<number,Point>} */ const positions=new Map();
    const routes=shape('g',{},scene), edges=shape('g',{},scene), stations=shape('g',{},scene);
    categories.forEach((category,i)=>{
        const color=colors[i], mid=-Math.PI/2+i*Math.PI/2;
        const group=entries.filter(e=>e.category===category).slice(0,120);
        const hub=polar(mid,110), label=polar(mid,82);
        shape('line',{x1:0,y1:0,x2:hub.x,y2:hub.y,stroke:color,'stroke-width':2,opacity:.7},routes);
        const spokes=Math.min(10,Math.ceil(group.length/12));
        if(spokes){
            const angles=Array.from({length:spokes},(_,j)=>mid+(j-(spokes-1)/2)*.13);
            if(spokes>1)shape('path',{d:arc(110,angles[0],angles[spokes-1]),stroke:color,'stroke-width':2,class:'metro-route'},routes);
            angles.forEach((a,j)=>{
                const count=Math.min(12,group.length-j*12);
                const p=polar(a,110),q=polar(a,140+(count-1)*25);
                shape('line',{x1:p.x,y1:p.y,x2:q.x,y2:q.y,stroke:color,'stroke-width':2,opacity:.8},routes);
                for(let k=0;k<count;k++){
                    const e=group[j*12+k],r=140+k*25;
                    positions.set(e.id,{...polar(a,r),a,r,color});
                }
            });
        }
        shape('circle',{cx:hub.x,cy:hub.y,r:7,fill:'#0b1a22',stroke:color,'stroke-width':2},stations);
        shape('text',{x:label.x,y:label.y+4,'text-anchor':'middle',fill:color,'font-size':11},stations).textContent=category;
    });
    const degree=new Map();
    let visible=0;
    for(const link of links){
        const a=positions.get(link.source), b=positions.get(link.target);
        if(!a||!b)continue;
        visible++;
        degree.set(link.source,(degree.get(link.source)||0)+1);
        degree.set(link.target,(degree.get(link.target)||0)+1);
        const r=Math.max(a.r,b.r)+12, p=polar(a.a,r), q=polar(b.a,r);
        const sweep=((b.a-a.a+Math.PI*4)%(Math.PI*2)), clockwise=sweep<=Math.PI?1:0;
        const d='M '+a.x+' '+a.y+' L '+p.x+' '+p.y+' A '+r+' '+r+' 0 0 '+clockwise+' '+q.x+' '+q.y+' L '+b.x+' '+b.y;
        shape('path',{d,stroke:'#f1d48a','stroke-width':1.6,opacity:.38,class:'metro-route','data-link-endpoints':link.source+','+link.target},edges);
    }
    for(const e of entries){
        const p=positions.get(e.id);if(!p)continue;
        const junction=degree.has(e.id),r=junction?6:3.5;
        const node=shape('circle',{cx:p.x,cy:p.y,r,fill:junction?'#071019':p.color,stroke:p.color,'stroke-width':junction?2:1,tabindex:0,role:'button','aria-label':e.label,'data-entry-id':e.id,class:'node'},stations);
        shape('title',{},node).textContent=e.label;
        node.addEventListener('click',()=>choose(e));
        node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(e);}});
        if(junction||positions.size<=32||e.id===selected){
            const t=polar(p.a,p.r+9);
            shape('text',{x:t.x,y:t.y-5,'text-anchor':p.x<0?'end':'start',fill:p.color,class:'station-label'},stations).textContent=e.label.length>20?e.label.slice(0,19)+'…':e.label;
        }
    }
    shape('circle',{r:46,fill:'#0b1a22',stroke:'#47c7d7','stroke-width':2},stations);
    shape('text',{x:0,y:4,'text-anchor':'middle',fill:'#9defff','font-size':12},stations).textContent='ЗНАНИЯ';
    graphStatus.textContent=positions.size+' узлов · '+visible+' видимых связей из '+links.length+(entries.length?'':' · добавьте записи');
    highlight(selected);transform();
}
function populate(){
    for(const select of [from,to]){
        const old=select.value;
        select.replaceChildren(new Option('Выберите запись',''));
        for(const e of entries)select.add(new Option(e.category+' — '+e.label,String(e.id)));
        select.value=old;
    }
}
async function refresh(){
    const token=++revision;
    try{
        const response=await fetch('/api/links');
        if(!response.ok)throw Error();
        const result=await response.json();
        if(token!==revision)return;
        links=result;render();
    }catch{
        if(token!==revision)return;
        links=[];render();graphStatus.textContent='Не удалось загрузить связи';
    }
}
document.addEventListener('memory:loaded',event=>{
    entries=/** @type {CustomEvent<Entry[]>} */ (event).detail;
    populate();void refresh();
});
document.addEventListener('memory:selected',event=>highlight(/** @type {CustomEvent<number>} */ (event).detail));
document.querySelector('#link-form').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!from.value||!to.value||from.value===to.value){linkStatus.textContent='Выберите две разные записи';return;}
    try{
        const response=await fetch('/api/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:Number(from.value),target:Number(to.value)})});
        if(!response.ok)throw Error();
        linkStatus.textContent='Связь сохранена';await refresh();
    }catch{linkStatus.textContent='Не удалось сохранить связь';}
});
svg.addEventListener('wheel',event=>{event.preventDefault();scale=Math.min(4,Math.max(.5,scale*Math.exp(-event.deltaY*.001)));transform();},{passive:false});
/** @type {{id:number,x:number,y:number}|null} */ let drag=null;
svg.addEventListener('pointerdown',event=>{if(/** @type {Element} */ (event.target).closest('.node'))return;drag={id:event.pointerId,x:event.clientX,y:event.clientY};svg.setPointerCapture(event.pointerId);});
svg.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;const matrix=svg.getScreenCTM();if(!matrix)return;x+=(event.clientX-drag.x)/matrix.a;y+=(event.clientY-drag.y)/matrix.d;drag.x=event.clientX;drag.y=event.clientY;transform();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(event,()=>{drag=null;});
document.querySelector('#metro-reset').addEventListener('click',()=>{scale=1;x=y=0;transform();});
const legend=document.querySelector('#legend');
categories.forEach((c,i)=>{const span=document.createElement('span');span.style.color=colors[i];span.append(document.createElement('i'),c);legend.append(span);});
const key=document.createElement('span');key.style.color='#f1d48a';key.textContent='● Связь записей';legend.append(key);
render();
export {};
