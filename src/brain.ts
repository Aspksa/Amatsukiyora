export {};
type Entry={id:number;category:string;label:string};
const svg=document.querySelector<SVGSVGElement>('#brain')!;
const statusElement=document.querySelector<HTMLElement>('#status')!;
const ns='http://www.w3.org/2000/svg';
const categories=['Знания','Навыки','Опыт','Личность'];
const colors=['#427ECC','#26C9E4','#FFBF42','#9875CB'];
let entries:Entry[]=[], previous=new Set<number>(), initialized=false, scale=1, x=0,y=0;
function shape<K extends keyof SVGElementTagNameMap>(tag:K, attrs:Record<string,string|number>, parent:SVGElement){const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));parent.append(el);return el;}
const scene=shape('g',{},svg);
function transform(){scene.setAttribute('transform',`translate(${x} ${y}) scale(${scale})`);}
function render(){scene.replaceChildren();for(const r of [48,76,130,245,350,390,430])shape('circle',{r,cx:0,cy:0,class:'orbit'},scene);
shape('circle',{r:34,fill:'#101923',stroke:'#26C9E4','stroke-width':2},scene);
const core=shape('text',{x:0,y:4,fill:'#D4E2E9','text-anchor':'middle','font-size':10},scene);core.textContent='ЯДРО';
categories.forEach((category,i)=>{const group=entries.filter(e=>e.category===category);const color=colors[i];const mid=-Math.PI/2+i*Math.PI/2;const title=shape('text',{x:Math.cos(mid)*320,y:Math.sin(mid)*320,fill:color,'text-anchor':'middle','font-size':12},scene);title.textContent=category+' · '+group.length;
group.slice(0,120).forEach((entry,j)=>{const row=Math.floor(j/12), col=j%12;const angle=mid+(col-5.5)*.095;const r=145+row*14;const px=Math.cos(angle)*r,py=Math.sin(angle)*r;shape('line',{x1:Math.cos(angle)*76,y1:Math.sin(angle)*76,x2:px,y2:py,stroke:color,opacity:.12},scene);const node=shape('circle',{cx:px,cy:py,r:4,fill:color,stroke:color,'data-entry-id':entry.id,tabindex:0,role:'button','aria-label':entry.label,class:'node'+(initialized&&!previous.has(entry.id)?' pulse':'')},scene);shape('title',{},node).textContent=entry.label;const select=()=>{document.dispatchEvent(new CustomEvent('memory:selected',{detail:entry.id}));};node.addEventListener('click',select);node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});const outer=shape('circle',{cx:Math.cos(mid+(j/Math.max(group.length,1)-.5)*1.2)*390,cy:Math.sin(mid+(j/Math.max(group.length,1)-.5)*1.2)*390,r:5,fill:'none',stroke:color,opacity:.6},scene);outer.addEventListener('click',select);});});previous=new Set(entries.map(e=>e.id));initialized=true;transform();}
async function load(){try{const response=await fetch('/api/memory');if(!response.ok)throw Error();entries=await response.json() as Entry[];render();document.dispatchEvent(new CustomEvent('memory:loaded',{detail:entries}));statusElement.textContent='SQLite · '+entries.length+' записей (до 120 на сектор)';}catch{statusElement.textContent='Сервер недоступен';}}
svg.addEventListener('wheel',e=>{e.preventDefault();scale=Math.min(4,Math.max(.5,scale*Math.exp(-e.deltaY*.001)));transform();},{passive:false});
let drag:{id:number;x:number;y:number}|null=null;
svg.addEventListener('pointerdown',e=>{if((e.target as Element).closest('.node'))return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};svg.setPointerCapture(e.pointerId);});
svg.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const matrix=svg.getScreenCTM();if(!matrix)return;x+=(e.clientX-drag.x)/matrix.a;y+=(e.clientY-drag.y)/matrix.d;drag.x=e.clientX;drag.y=e.clientY;transform();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(event,()=>{drag=null;});
document.querySelector('#reset')!.addEventListener('click',()=>{scale=1;x=y=0;transform();});
void load();