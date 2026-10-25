'use strict';
// Aura Cards: lightweight offline generation and explicitly opt-in AI.
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
 home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
 layers:'<path d="m12 3 10 5-10 5L2 8Z M2 12l10 5 10-5 M2 16l10 5 10-5"/>',
 sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z M20 2v4 M18 4h4"/>',
 star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
 settings:'<path d="M4 7h16 M4 17h16 M8 4v6 M16 14v6"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.4 1.4 M17.6 17.6 1.4 1.4 M5 19l1.4-1.4 M17.6 6.4 1.4-1.4"/>',
 plus:'<path d="M12 5v14 M5 12h14"/>',
 upload:'<path d="M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 arrow:'<path d="M5 12h14 M14 7l5 5-5 5"/>',
 back:'<path d="M19 12H5 M10 7l-5 5 5 5"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 flip:'<path d="M20 7H8l3-3 M4 17h12l-3 3 M20 7v6 M4 17v-6"/>',
 edit:'<path d="m15 4 5 5 M4 20l4-1 13-13-4-4L4 15Z"/>',
 trash:'<path d="M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7"/>',
 book:'<path d="M12 5v16 M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1Z"/>',
 download:'<path d="M12 3v13 M7 11l5 5 5-5 M4 17v4h16v-4"/>',
 shuffle:'<path d="M3 5h3l12 14h3 M17 15l4 4-4 3 M3 19h3L18 5h3 M17 2l4 3-4 4"/>',
 external:'<path d="M14 3h7v7 M21 3 10 14 M11 5H4v15h15v-7"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.layers}</svg>`;
function hydrateIcons(root=document){ $$('[data-icon]',root).forEach(e=>e.innerHTML=icon(e.dataset.icon)); }
const themes = {
 obsidian:{bg:'#0b0b0e',sidebar:'#101014',panel:'#141419','panel-hover':'#1b1b22',text:'#f4f2f5',muted:'#9997a5',border:'#29272f',gold:'#d8be83',halo:'#a78bfa'},
 pearl:{bg:'#f7f6f3',sidebar:'#efede8',panel:'#ffffff','panel-hover':'#eae7e1',text:'#22202a',muted:'#696472',border:'#dcd8e0',gold:'#b6924c',halo:'#8060c2'},
 midnight:{bg:'#0b101b',sidebar:'#0e1523',panel:'#141e30','panel-hover':'#1b2940',text:'#f0f3fc',muted:'#9aa9c2',border:'#29354b',gold:'#d8be83',halo:'#98a5ff'},
 cyberpunk:{bg:'#090e19',sidebar:'#0c1320',panel:'#111c2b','panel-hover':'#19283a',text:'#edfaff',muted:'#9fb5c5',border:'#304153',gold:'#f4ec45',halo:'#50e5e7'},
 zen:{bg:'#f3f1e9',sidebar:'#eae9df',panel:'#fcfbf5','panel-hover':'#e8ecdf',text:'#303d35',muted:'#637064',border:'#d0d8c9',gold:'#b8ce98',halo:'#52735d'},
 aurora:{bg:'#0e111b',sidebar:'#121724',panel:'#181e2e','panel-hover':'#202b3c',text:'#eef6f7',muted:'#a4b1c5',border:'#303a51',gold:'#9ee2cb',halo:'#bca6ef'},
 ocean:{bg:'#071820',sidebar:'#0b1e28',panel:'#102733','panel-hover':'#173440',text:'#e8f6f8',muted:'#93b4c1',border:'#284854',gold:'#9adbd5',halo:'#70bce3'},
 ember:{bg:'#1b1211',sidebar:'#211715',panel:'#2a1d1a','panel-hover':'#352622',text:'#faf0e6',muted:'#c4a89b',border:'#4c352c',gold:'#f0ba86',halo:'#e79681'}
};
const themeNames={cyberpunk:'Cyberpunk 2077'};
const themeDescriptions={obsidian:'Original dark',pearl:'Light editorial',midnight:'Deep blue',cyberpunk:'After hours',zen:'Warm minimal',aurora:'Soft glass',ocean:'Cool precision',ember:'Warm editorial'};
const cardLabels={full:'Text + icon',icon:'Icon only',none:'Nothing'};
const animations={auto:['Theme match','Follows your theme’s mood.'],flip:['Classic flip','A lifted, dimensional turn.'],glitch:['Glitch','Fragmented lettering, RGB trails and a signal-lock reveal.'],zen:['Zen fade','A drifting, unhurried dissolve.'],slide:['Slide','A sweeping reveal with a soft overshoot.'],bloom:['Bloom','A luminous expansion into focus.']};
const themeAnimations={cyberpunk:'glitch',zen:'zen',aurora:'bloom',ocean:'slide',ember:'bloom'};
function cardAnimation(){return state.settings.cardAnimation==='auto'?(themeAnimations[state.settings.theme]||'flip'):state.settings.cardAnimation;}

function seed(){
 const make=(q,a,tags=[])=>({id:uid(),question:q,answer:a,tags,starred:false,mastered:false,due:0});
 return {version:1,categories:['Python Basics','Data Structures','Functions and OOP'],settings:{theme:'obsidian',cardAnimation:'auto',cardLabels:'full',colors:{},apiBase:'',pomodoroUrl:'',generatorMode:'extractive',generatorChosen:false,llamaBase:'',llamaModel:'',generationDepth:'thorough',answerDetail:'expanded',focusDuration:25},reviews:[],focusMinutes:0,decks:[
  {id:uid(),name:'Python Basics',description:'Variables, syntax and everyday Python.',category:'Python Basics',source:'Sample deck',sampleKey:'python-basics',color:'#a78bfa',created:Date.now(),cards:[
   make('How do you create a variable in Python?','Assign a value with =.\nFor example: name = "Ada"\nPython determines the value’s type at runtime.',['Variables']),
   make('Why does indentation matter in Python?','Indentation defines code blocks, such as the body of an if statement, loop or function.\nUse consistent indentation; four spaces is the usual style.',['Syntax']),
   make('What is the difference between / and // in Python?','/ performs true division. // performs floor division.\n7 / 2 gives 3.5\n7 // 2 gives 3\n-7 // 2 gives -4',['Operators']),
   make('How do you convert input into an integer in Python?','input() returns a string. Convert it with int().\nExample: age = int(input("Age: "))\nInvalid integer text raises ValueError.',['Input']),
   make('What values does range(3) produce in Python?','0, 1 and 2.\nThe stop value is excluded.\nExample: for i in range(3): print(i)',['Loops']),
   make('What does print("Hello, Python!") do?','It writes Hello, Python! to standard output, followed by a newline by default.',['Output'])]},
  {id:uid(),name:'Python Data Structures',description:'Lists, tuples, dictionaries and sets.',category:'Data Structures',source:'Sample deck',sampleKey:'python-data',color:'#d8be83',created:Date.now(),cards:[
   make('How do Python lists and tuples differ?','Lists are mutable: their elements can be changed. Tuples are immutable: their element references cannot be reassigned.\nA tuple can still contain a mutable object.',['Sequences']),
   make('How do you look up a dictionary value in Python?','Use its key.\nuser = {"name": "Ada"}\nuser["name"] returns "Ada".\nuser.get("age") returns None when the key is absent.',['Dictionaries']),
   make('What happens to duplicates in a Python set?','A set contains unique elements.\nset([1, 1, 2]) produces {1, 2}.\nSets do not support indexing.',['Sets']),
   make('What does numbers[1:3] return in Python?','A slice from index 1 up to, but excluding, index 3.\nIf numbers = [10, 20, 30, 40], the result is [20, 30].',['Slicing']),
   make('What is a list comprehension in Python?','A concise way to build a list from an iterable.\n[x * x for x in range(4)] gives [0, 1, 4, 9].',['Comprehensions']),
   make('How do append() and extend() differ for a Python list?','append() adds one object. extend() adds each item from an iterable.\n[1].append([2, 3]) makes [1, [2, 3]].\n[1].extend([2, 3]) makes [1, 2, 3].',['Lists'])]},
  {id:uid(),name:'Python Functions and OOP',description:'Functions, classes and error handling.',category:'Functions and OOP',source:'Sample deck',sampleKey:'python-functions',color:'#86b5a1',created:Date.now(),cards:[
   make('How do you define a function in Python?','Use def, a function name, parameters and an indented body.\ndef add(a, b):\n    return a + b',['Functions']),
   make('What does a Python function return without a return statement?','It returns None.\nA bare return statement also returns None.',['Return values']),
   make('What is __init__ used for in a Python class?','It initializes an instance after the instance is created.\nFor example, it can assign self.name from an argument.\nIt must return None.',['Classes']),
   make('What does self represent in a Python instance method?','The instance on which the method is called.\nIt is conventionally the first parameter of an instance method.\nThe name self is a convention, not a keyword.',['Methods']),
   make('What do *args and **kwargs collect in a Python function?','*args collects extra positional arguments into a tuple.\n**kwargs collects extra keyword arguments into a dictionary.',['Arguments']),
   make('How do you handle a ValueError in Python?','Wrap the operation in try and catch ValueError with except.\ntry:\n    value = int("hello")\nexcept ValueError:\n    print("Enter a valid integer")',['Exceptions'])]}
 ]};
}
const STORAGE='aura-cards-v1';
function validState(s){
 const text=(v,max)=>typeof v==='string'&&v.length<=max;
 const card=c=>c&&text(c.id,100)&&text(c.question,3000)&&text(c.answer,10000)&&Array.isArray(c.tags)&&c.tags.length<=20&&c.tags.every(t=>text(t,100))&&(!c.source||(text(c.source.label,100)&&text(c.source.excerpt,3000)));
 return !!(s&&s.version===1&&Array.isArray(s.categories)&&s.categories.length<=200&&s.categories.every(c=>text(c,100))&&s.settings&&typeof s.settings==='object'&&!Array.isArray(s.settings)&&Array.isArray(s.reviews)&&s.reviews.length<=10000&&s.reviews.every(r=>r&&Number.isFinite(r.at)&&typeof r.known==='boolean')&&Array.isArray(s.decks)&&s.decks.length<=500&&s.decks.every(d=>d&&text(d.id,100)&&text(d.name,100)&&text(d.category,100)&&text(d.description,10000)&&(!d.generationWarnings||(Array.isArray(d.generationWarnings)&&d.generationWarnings.length<=20&&d.generationWarnings.every(w=>text(w,1000))))&&Array.isArray(d.cards)&&d.cards.length<=2000&&d.cards.every(card))&&new Set(s.decks.map(d=>d.id)).size===s.decks.length&&new Set(s.decks.flatMap(d=>d.cards.map(c=>c.id))).size===s.decks.reduce((n,d)=>n+d.cards.length,0));
}
// Refresh only unchanged built-in examples; user-edited cards remain intact.
const LEGACY_SAMPLES=[{"name":"Computer Networks","fingerprint":1616724741,"category":"Computer Science"},{"name":"Cell Biology","fingerprint":435651967,"category":"Biology"},{"name":"Design Fundamentals","fingerprint":196353238,"category":"Design"}];
function sampleFingerprint(cards){const text=JSON.stringify(cards.map(c=>[c.question,c.answer,c.tags]));let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619)>>>0;return hash;}
function migrateSampleDecks(s){
 let changed=false;const fresh=seed();const replacedCards=new Set();
 s.decks.forEach(d=>{const legacy=LEGACY_SAMPLES.find(x=>x.name===d.name);if(!legacy||d.source!=='Sample deck')return;
  if(sampleFingerprint(d.cards)!==legacy.fingerprint){d.source='Created by you';changed=true;return;}
  const replacement=fresh.decks[LEGACY_SAMPLES.indexOf(legacy)];const cards=replacement.cards.map((c,i)=>{replacedCards.add(d.cards[i].id);return {...c,id:d.cards[i].id,starred:!!d.cards[i].starred};});
  Object.assign(d,{name:replacement.name,description:replacement.description,category:replacement.category,sampleKey:replacement.sampleKey,cards});changed=true;
 });
 if(changed){const used=new Set(s.decks.map(d=>d.category));s.categories=s.categories.filter(c=>!LEGACY_SAMPLES.some(x=>x.category===c)||used.has(c));for(const c of fresh.categories)if(!s.categories.includes(c))s.categories.push(c);s.reviews=s.reviews.filter(r=>!replacedCards.has(r.cardId));}
 return changed;
}
let state,loadFailed=false;
try{const raw=localStorage.getItem(STORAGE);if(raw){const parsed=JSON.parse(raw);if(!validState(parsed))throw new Error();state=parsed;}else state=seed();}catch{state=seed();loadFailed=true;}
state.settings={theme:'obsidian',cardAnimation:'auto',cardLabels:'full',colors:{},apiBase:'',pomodoroUrl:'',generatorMode:'extractive',generatorChosen:false,llamaBase:'',llamaModel:'',generationDepth:'thorough',answerDetail:'expanded',focusDuration:25,...state.settings};state.focusMinutes=Number.isFinite(state.focusMinutes)?state.focusMinutes:0;
if(!Object.prototype.hasOwnProperty.call(themes,state.settings.theme))state.settings.theme='obsidian';
if(!Object.prototype.hasOwnProperty.call(animations,state.settings.cardAnimation))state.settings.cardAnimation='auto';
if(!Object.prototype.hasOwnProperty.call(cardLabels,state.settings.cardLabels))state.settings.cardLabels='full';
if(!state.settings.colors||typeof state.settings.colors!=='object'||Array.isArray(state.settings.colors))state.settings.colors={};
for(const key of ['apiBase','pomodoroUrl']){if(typeof state.settings[key]!=='string'||state.settings[key].length>2000)state.settings[key]='';}
if(!['flash','balanced','thorough'].includes(state.settings.generationDepth))state.settings.generationDepth='thorough';
if(!['focused','expanded'].includes(state.settings.answerDetail))state.settings.answerDetail='expanded';
const samplesUpdated=migrateSampleDecks(state);
if(!['extractive','cloud','ollama','llamacpp'].includes(state.settings.generatorMode))state.settings.generatorMode='extractive';
for(const k of ['llamaBase','llamaModel'])if(typeof state.settings[k]!=='string'||state.settings[k].length>2000)state.settings[k]='';
if(!Number.isInteger(state.settings.focusDuration)||state.settings.focusDuration<1||state.settings.focusDuration>120)state.settings.focusDuration=25;
let view='overview',category='All decks',search='',selectedDeck=state.decks[0]?.id,session=null,editContext=null,deleteAction=null,categoryToDelete=null,selectedFile=null,uploading=false,pendingDeck=null,activeGeneration=null;
// Native dialogs make the page inert, but do not consistently lock its scroll.
// Fix the body at its current position until the final dialog has closed.
let dialogScrollSnapshot=null;
function syncDialogScrollLock(){
 if(!document.body)return;
 const root=document.documentElement,body=document.body;
 const open=!!document.querySelector('dialog[open]');
 if(open&&!dialogScrollSnapshot){
  const gap=Math.max(0,window.innerWidth-root.clientWidth);
  const properties=['top','padding-right'];
  dialogScrollSnapshot={x:window.scrollX,y:window.scrollY,styles:properties.map(name=>[name,body.style.getPropertyValue(name),body.style.getPropertyPriority(name)])};
  const padding=parseFloat(getComputedStyle(body).paddingRight)||0;
  body.style.setProperty('top',`-${dialogScrollSnapshot.y}px`);
  body.style.setProperty('padding-right',`${padding+gap}px`);
  root.classList.add('modal-scroll-lock');body.classList.add('modal-scroll-lock');
 }else if(!open&&dialogScrollSnapshot){
  const previous=dialogScrollSnapshot;dialogScrollSnapshot=null;
  for(const [name,value,priority] of previous.styles){if(value)body.style.setProperty(name,value,priority);else body.style.removeProperty(name);}
  body.classList.remove('modal-scroll-lock');root.classList.remove('modal-scroll-lock');
  window.scrollTo({left:previous.x,top:previous.y,behavior:'instant'});
 }
}
if(document.body&&typeof MutationObserver==='function'){
 // Observe native Escape, close buttons, and upload -> review -> back transitions.
 new MutationObserver(changes=>{if(changes.some(change=>change.target.tagName==='DIALOG'))syncDialogScrollLock();}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
 document.addEventListener('close',syncDialogScrollLock,true);
 syncDialogScrollLock();
}
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000);}
function save(){try{localStorage.setItem(STORAGE,JSON.stringify(state));window.dispatchEvent?.(new Event('aura:changed'));return true;}catch{toast('Browser storage is full or unavailable. Export a backup to keep your work.');return false;}}
function applyTheme(){const theme=themes[state.settings.theme]||themes.obsidian;for(const [k,v]of Object.entries(theme))document.documentElement.style.setProperty('--'+k,v);for(const[k,v]of Object.entries(state.settings.colors||{})){if(['gold','halo','bg','panel'].includes(k)&&/^#[0-9a-f]{6}$/i.test(v))document.documentElement.style.setProperty('--'+k,v);}document.documentElement.setAttribute('data-theme',state.settings.theme);document.documentElement.style.colorScheme=['pearl','zen'].includes(state.settings.theme)?'light':'dark';$('meta[name="theme-color"]').content=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();}
const deckById=id=>state.decks.find(d=>d.id===id);
const allCards=()=>state.decks.flatMap(d=>d.cards);
const mastered=d=>d.cards.filter(c=>c.mastered).length;
const percent=d=>d.cards.length?Math.round(mastered(d)/d.cards.length*100):0;
function categoryOptions(value){return state.categories.map(c=>`<option ${c===value?'selected':''}>${esc(c)}</option>`).join('');}
function categories(){}
function switchView(next){view=next;search='';if(next!=='decks')category='All decks';render();$('#mainContent').focus({preventScroll:true});}
function intro(title,description,actions=''){return `<div class="page-intro"><div><h1>${title}</h1>${description?`<p>${description}</p>`:''}</div>${actions?`<div class="intro-actions">${actions}</div>`:''}</div>`;}
const createActions=()=>`<button class="btn btn-ghost" data-action="new-deck">${icon('plus')}New deck</button>`;
function deckTile(d){const color=/^#[0-9a-f]{6}$/i.test(d.color)?d.color:'#a78bfa';return `<article class="deck" style="--deck-color:${color}"><div class="deck-top"><span class="deck-category">${esc(d.category)}</span><button class="icon-btn" aria-label="Edit ${esc(d.name)}" title="Edit deck" data-action="edit-deck" data-id="${esc(d.id)}">${icon('edit')}</button></div><h3><a href="#" data-action="open-deck" data-id="${esc(d.id)}">${esc(d.name)}</a></h3><div class="deck-bottom"><span>${d.cards.length} cards <span class="separator">·</span> ${percent(d)}% mastered</span><button class="text-link" data-action="study-deck" data-id="${esc(d.id)}" aria-label="Study ${esc(d.name)}">Study ${icon('arrow')}</button></div><div class="progress-track"><div class="progress-fill" style="width:${percent(d)}%"></div></div></article>`;}
function empty(title,description,action=''){return `<div class="empty"><h3>${title}</h3>${description?`<p>${description}</p>`:''}${action}</div>`;}
function cardLabel(side){
 if(state.settings.cardLabels==='none')return '';
 const label=side==='front'?'Question':'Answer';
 return `<span class="card-label" title="${label}">${icon(side==='front'?'book':'check')}${state.settings.cardLabels==='full'?`<span>${label}</span>`:`<span class="sr-only">${label}</span>`}</span>`;
}
function flashcard(c,cls=''){return `<button class="flashcard ${cls}" data-labels="${state.settings.cardLabels}" data-animation="${cardAnimation()}" data-action="flip" aria-label="Reveal answer" aria-pressed="false"><span class="card-inner"><span class="card-face card-front" aria-hidden="false">${cardLabel('front')}<span class="card-question">${esc(c.question)}</span><span class="flip-hint">${icon('flip')}</span></span><span class="card-face card-back" aria-hidden="true">${cardLabel('back')}<span class="card-answer">${esc(c.answer)}</span><span class="flip-hint">${icon('flip')}</span></span></span></button>`;}

function overview(){const cards=allCards(),reviews=state.reviews.filter(r=>new Date(r.at).toDateString()===new Date().toDateString());const d=(deckById(selectedDeck)?.cards.length?deckById(selectedDeck):null)||state.decks.find(d=>d.cards.length),c=d?.cards[0];return `<div class="overview-stats">${cards.length} cards <span class="separator">·</span> ${cards.filter(c=>c.mastered).length} mastered <span class="separator">·</span> ${reviews.length} reviewed today${state.focusMinutes?` <span class="separator">·</span> ${state.focusMinutes} focus min`:''}</div>`+`<section class="study-preview"><div class="panel-header"><span>${esc(d?.name||'Quick study')}</span>${c?`<button class="text-link" data-action="study-deck" data-id="${esc(d.id)}">Study deck ${icon('arrow')}</button>`:''}</div>${c?flashcard(c):empty('No decks yet.','',createActions())}</section><div class="section-heading"><h2>Decks <span class="subtle-count">${state.decks.length}</span></h2>${createActions()}</div>${filters()}<div id="deckGrid" class="deck-grid">${filteredDecks()}</div>`;}
function focusBanner(){return '';}
function filters(){return `<div class="filter-bar"><label class="search-box">${icon('search')}<input id="deckSearch" aria-label="Search decks" placeholder="Search decks" value="${esc(search)}"></label><label class="category-filter"><span class="sr-only">Filter category</span><select id="categoryFilter">${['All decks',...state.categories].map(c=>`<option ${c===category?'selected':''}>${esc(c)}</option>`).join('')}</select></label></div>`;}
function filteredDecks(){const ds=state.decks.filter(d=>(category==='All decks'||d.category===category)&&`${d.name} ${d.description} ${d.category}`.toLowerCase().includes(search.toLowerCase()));return ds.length?ds.map(deckTile).join(''):empty('No decks match.','',`<button class="btn" data-action="new-deck">${icon('plus')}Create a deck</button>`);}
function decks(){return intro('Decks','',createActions())+filters()+`<div id="deckGrid" class="deck-grid">${filteredDecks()}</div>`;}
function cardRow(c,d,i){return `<article class="card-row"><span class="card-num">${String(i+1).padStart(2,'0')}</span><div><h3>${esc(c.question)}</h3><p>${esc(c.answer)}</p>${view==='starred'?`<span class="badge">${esc(d.name)}</span>`:''}${c.tags.map(t=>`<span class="badge">${esc(t)}</span>`).join('')}${c.mastered?'<span class="badge">Mastered</span>':''}${c.source?.excerpt?`<details class="source-detail"><summary>Source · ${esc(c.source.label||'Notes')}</summary><p>${esc(c.source.excerpt)}</p></details>`:''}</div><div class="row-actions"><button class="icon-btn ${c.starred?'starred':''}" aria-label="${c.starred?'Unstar':'Star'} card" aria-pressed="${!!c.starred}" data-action="star-card" data-id="${esc(c.id)}" data-deck="${esc(d.id)}">${icon('star')}</button><button class="icon-btn" aria-label="Edit card" data-action="edit-card" data-id="${esc(c.id)}" data-deck="${esc(d.id)}">${icon('edit')}</button><button class="icon-btn" aria-label="Delete card" data-action="delete-card" data-id="${esc(c.id)}" data-deck="${esc(d.id)}">${icon('trash')}</button></div></article>`;}
function detail(){const d=deckById(selectedDeck);if(!d)return decks();return `<button class="back-link" data-action="all-decks">${icon('back')}Back to decks</button><div class="deck-title-row"><div><span class="eyebrow">${esc(d.category)}</span><h1>${esc(d.name)}</h1><p>${esc(d.description)}</p>${generationSummary(d.generationReport)}${d.generationWarnings?.length?`<details class="generation-note"><summary>Generation notes</summary><p>${d.generationWarnings.map(esc).join('<br>')}</p></details>`:''}</div><div class="intro-actions"><button class="btn" data-action="edit-deck" data-id="${esc(d.id)}">${icon('edit')}Edit deck</button><button class="btn btn-gold" data-action="study-deck" data-id="${esc(d.id)}">${icon('sparkles')}Study now</button></div></div><div class="list-controls"><label class="search-box">${icon('search')}<input id="cardSearch" placeholder="Search questions, answers or tags..." aria-label="Search cards" value="${esc(search)}"></label><div class="row-actions"><button class="btn btn-small" data-action="new-card" data-id="${esc(d.id)}">${icon('plus')}Add card</button><button class="icon-btn" aria-label="Export deck" data-action="export-deck" data-id="${esc(d.id)}">${icon('download')}</button><button class="icon-btn" aria-label="Delete deck" data-action="delete-deck" data-id="${esc(d.id)}">${icon('trash')}</button></div></div><div id="cardsList" class="cards-list">${filteredCards(d)}</div>`;}
function filteredCards(d){const cs=d.cards.filter(c=>`${c.question} ${c.answer} ${c.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase()));return cs.length?cs.map((c,i)=>cardRow(c,d,i)).join(''):empty('No cards.','');}
function starred(){const rows=state.decks.flatMap(d=>d.cards.filter(c=>c.starred).map(c=>({c,d})));return intro('Starred cards','')+`<div class="cards-list">${rows.length?rows.map(({c,d},i)=>cardRow(c,d,i)).join(''):empty('No starred cards.','')}</div>`;}
function beginSession(id,onlyDue=false){const d=deckById(id);if(!d?.cards.length){toast('No cards in this deck.');return;}selectedDeck=id;const ids=d.cards.filter(c=>!onlyDue||!c.due||c.due<=Date.now()).map(c=>c.id);if(!ids.length){toast('No cards due.');return;}session={deckId:id,ids,index:0,ratings:{},complete:false};view='study';render();}
function study(){const d=deckById(session?.deckId||selectedDeck)||state.decks[0];if(!d)return intro('Study','')+empty('No decks yet.','',`<button class="btn btn-gold" data-action="new-deck">New deck</button>`);if(!session||session.deckId!==d.id){return intro('Study','')+`<div class="study-layout"><div class="study-start"><label>Deck<select id="studyDeck">${state.decks.map(x=>`<option value="${esc(x.id)}" ${x.id===d.id?'selected':''}>${esc(x.name)} · ${x.cards.length} cards</option>`).join('')}</select></label><div class="backup-actions"><button class="btn btn-gold" data-action="start-study">Study all</button><button class="btn btn-ghost" data-action="start-due">Due cards</button></div></div></div>`;}
 if(session.complete){const known=Object.values(session.ratings).filter(Boolean).length;return intro('Session complete','')+`<div class="study-layout"><div class="session-summary"><h2>${known} of ${session.ids.length} remembered</h2><p>${esc(d.name)}</p><div class="study-nav"><button class="btn btn-ghost" data-action="restart-study">Study again</button><button class="btn btn-gold" data-action="open-deck" data-id="${esc(d.id)}">Back to deck</button></div></div></div>`;}
 const c=d.cards.find(c=>c.id===session.ids[session.index]);if(!c){session=null;return study();}const count=Object.keys(session.ratings).length;return intro('Study','')+`<div class="study-layout"><div class="study-tools"><span>${esc(d.name)}</span><div class="row-actions"><button class="icon-btn ${c.starred?'starred':''}" data-action="star-card" data-id="${esc(c.id)}" data-deck="${esc(d.id)}" aria-label="Star current card">${icon('star')}</button><button class="icon-btn" data-action="shuffle" aria-label="Shuffle remaining cards">${icon('shuffle')}</button><button class="btn btn-small btn-ghost" data-action="end-study">End</button></div></div><div class="session-progress"><span style="width:${count/session.ids.length*100}%"></span></div>${flashcard(c,'study-card')}<div class="study-nav"><button class="icon-btn" data-action="prev-card" aria-label="Previous card" ${session.index===0?'disabled':''}>${icon('back')}</button><span class="muted">${session.index+1} / ${session.ids.length}</span><button class="icon-btn" data-action="next-card" aria-label="Next card" ${session.index===session.ids.length-1?'disabled':''}>${icon('arrow')}</button></div><div class="study-ratings"><button class="btn btn-ghost" data-action="rate-again" disabled>Again <small>1</small></button><button class="btn btn-gold" data-action="rate-known" disabled>Got it <small>2</small></button></div><p class="review-hint sr-only">Reveal the answer to rate your recall.</p><details class="shortcuts"><summary>Keyboard shortcuts</summary><p>Space to flip · ← → to move · 1 Again · 2 Got it</p></details></div>`;}

function settings(){return intro('Settings','')+`<div class="settings-layout"><details class="settings-section" name="settings" open><summary>Appearance</summary><div class="settings-body"><div class="theme-grid">${Object.keys(themes).map(t=>`<button class="theme-option ${state.settings.theme===t?'active':''}" data-theme="${t}" aria-pressed="${state.settings.theme===t}"><span class="theme-swatch" aria-hidden="true" style="background:${themes[t].bg}"><i style="background:${themes[t].panel};border-color:${themes[t].halo}"></i><i style="background:${themes[t].panel};border-color:${themes[t].gold}"></i></span><span class="theme-name">${themeNames[t]||t[0].toUpperCase()+t.slice(1)}</span><span class="theme-caption">${themeDescriptions[t]}</span></button>`).join('')}</div><div class="animation-settings"><div class="appearance-controls"><label for="cardAnimation">Card animation<select id="cardAnimation">${Object.entries(animations).map(([key,[name]])=>`<option value="${key}" ${state.settings.cardAnimation===key?'selected':''}>${name}</option>`).join('')}</select></label><label for="cardLabels">Card heading<select id="cardLabels">${Object.entries(cardLabels).map(([key,label])=>`<option value="${key}" ${state.settings.cardLabels===key?'selected':''}>${label}</option>`).join('')}</select></label></div><p id="animationDescription" class="helper">${animations[state.settings.cardAnimation][1]} Click the card below to try it.</p><div id="animationPreview">${flashcard({question:'A moment of curiosity.',answer:'A little more clarity.'},'animation-preview')}</div></div><div class="color-controls">${[['gold','Gold accent'],['halo','Card halo'],['bg','Background'],['panel','Panels']].map(([k,t])=>`<label class="color-control">${t}<input type="color" aria-label="${t}" data-color="${k}" value="${esc(state.settings.colors[k]||themes[state.settings.theme]?.[k]||themes.obsidian[k])}"></label>`).join('')}</div><button class="btn btn-ghost btn-small" data-action="reset-colors">Reset colors</button></div></details><details class="settings-section" name="settings" id="categoriesSection"><summary>Categories</summary><div class="settings-body"><div class="category-list category-manager">${state.categories.map(c=>`<div class="category-row"><div><span>${esc(c)}</span><small>${state.decks.filter(d=>d.category===c).length} deck${state.decks.filter(d=>d.category===c).length===1?'':'s'}</small></div><button type="button" class="icon-btn" data-action="delete-category" data-category-name="${esc(c)}" aria-label="Delete category ${esc(c)}" title="Delete category">${icon('trash')}</button></div>`).join('')}</div><button class="btn btn-ghost" data-action="new-category">${icon('plus')}Add category</button></div></details><details class="settings-section" name="settings" id="connectionsSection"><summary>Connections</summary><div class="settings-body"><form id="apiForm"><label>Python API base URL<input name="apiBase" type="url" placeholder="Automatic on localhost" value="${esc(state.settings.apiBase)}"></label><div class="backup-actions"><button class="btn btn-ghost" type="submit">Save API</button><button class="btn btn-ghost" type="button" data-action="check-api">Check connection</button></div><p id="connectionStatus" class="form-status">${backend.ready?'Connected':'Not connected'}</p></form><p class="helper">The Focus companion connects to your local Pomodoro server on port 8000. Use its duration controls to adjust the shared timer.</p><button type="button" class="btn btn-ghost" data-action="focus">Open Focus companion</button></div></details><details class="settings-section" name="settings"><summary>Backup</summary><div class="settings-body"><div class="backup-actions"><button class="btn btn-ghost" data-action="export-all">${icon('download')}Export backup</button><button class="btn btn-ghost" data-action="import">${icon('upload')}Import JSON</button><input type="file" id="importInput" accept=".json,application/json" hidden></div><p class="helper">Imports add decks.</p><button type="button" class="btn btn-ghost btn-small" data-action="clear-focus">Clear focus history</button></div></details></div>`;}

function render(){categories();$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view||view==='detail'&&b.dataset.view==='decks'));$('#mainContent').innerHTML=({overview,decks,detail,study,starred,settings})[view]();}
function updateGenerationDepthNotice(){
 const mode=$('#generationDepth').value;
 $('#generationDepthNotice').textContent=mode==='flash'?'Flash drafts directly from selected passages, with automatic source and duplicate checks. Skips concept mapping and separate model review/repair. Three-minute processing budget; speed depends on your model. Choose Focused answers and 10 cards for a quicker run.':mode==='balanced'?'Maps study concepts, writes cards, then checks and repairs them against your notes. Balanced has an eight-minute processing budget.':'Maps study concepts, writes cards, then checks and repairs them against your notes. Thorough allows broader coverage and up to 15 minutes of processing.';
}
function openUpload(){if(uploading)return;closeUploadCategory();$('#uploadCategory').innerHTML=categoryOptions(state.categories[0]);$('#uploadStatus').className='form-status';$('#uploadStatus').textContent='';$('#uploadEngine').value=state.settings.generatorMode;$('#generationDepth').value=state.settings.generationDepth;$('#answerDetail').value=state.settings.answerDetail;updateGenerationDepthNotice();updateEngineNotice();$('#llamaBase').value=state.settings.llamaBase;$('#uploadDialog').showModal();detectLlama();}
function closeUploadCategory(){
 $('#uploadCategoryEditor').hidden=true;$('#uploadNewCategory').value='';$('#uploadCategoryStatus').textContent='';$('#uploadCategoryAdd').setAttribute('aria-expanded','false');
}
function addUploadCategory(){
 const name=$('#uploadNewCategory').value.trim(),status=$('#uploadCategoryStatus');
 const fail=message=>{status.textContent=message;$('#uploadNewCategory').focus();return false;};
 if(!name)return fail('Enter a category name.');
 if(name.length>100)return fail('Use 100 characters or fewer.');
 if(state.categories.some(c=>c.toLowerCase()===name.toLowerCase()))return fail('That category already exists.');
 if(state.categories.length>=200)return fail('Maximum 200 categories.');
 state.categories.push(name);
 if(!save()){state.categories.pop();return fail('Could not save. Free browser storage and try again.');}
 $('#uploadCategory').innerHTML=categoryOptions(name);$('#uploadCategory').value=name;
 closeUploadCategory();render();$('#uploadCategory').focus();return true;
}
function openEditor(type,d,c){editContext={type,deckId:d?.id,cardId:c?.id};$('#editorTitle').textContent=type==='category'?'Add category':type==='deck'?(d?'Edit deck':'New deck'):(c?'Edit flashcard':'New flashcard');let html='';if(type==='category')html='<label>Category name<input name="category" maxlength="100" required placeholder="e.g. Semester 3"></label>';if(type==='deck')html=`<label>Deck name<input name="name" maxlength="100" required value="${esc(d?.name||'')}"></label><label>Description<input name="description" maxlength="300" value="${esc(d?.description||'')}" placeholder="Optional description"></label><div class="form-grid"><label>Category<select name="category">${categoryOptions(d?.category)}</select></label><label>Deck accent<input type="color" name="color" value="${esc(/^#[0-9a-f]{6}$/i.test(d?.color)?d.color:'#a78bfa')}"></label></div>`;if(type==='card')html=`<label>Question<textarea name="question" maxlength="3000" required>${esc(c?.question||'')}</textarea></label><label>Answer<textarea name="answer" maxlength="10000" required>${esc(c?.answer||'')}</textarea></label><label>Tags<input name="tags" maxlength="500" value="${esc(c?.tags.join(', ')||'')}" placeholder="loops, basics"></label>${d?`<label>Deck<select name="deckId">${state.decks.map(x=>`<option value="${esc(x.id)}" ${x.id===d.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>`:''}`;$('#editorFields').innerHTML=`<div class="editor-stack">${html}</div>`;$('#editorDialog').showModal();}
function openCategoryDelete(name){
 if(!state.categories.includes(name))return;
 categoryToDelete=name;
 const count=state.decks.filter(d=>d.category===name).length;
 const choices=state.categories.filter(c=>c!==name);
 const last=!choices.length;
 if(last)choices.push(name==='Uncategorized'?'General':'Uncategorized');
 $('#categoryDeleteName').textContent=name;
 $('#categoryDeleteMessage').textContent=count?`${count} deck${count===1?'':'s'} will be kept. Choose where to move ${count===1?'it':'them'} before deleting this category.`:last?`This is your last category. It will be replaced with “${choices[0]}” so you can keep creating decks.`:'This empty category will be removed.';
 $('#categoryDestinationField').hidden=!count;
 $('#categoryDestination').innerHTML=choices.map(c=>`<option>${esc(c)}</option>`).join('');
 $('#categoryDeleteStatus').textContent='';$('#categoryDeleteDialog').showModal();
}
function deleteCategory(){
 const name=categoryToDelete;
 if(!state.categories.includes(name)){$('#categoryDeleteDialog').close();return;}
 const alternatives=state.categories.filter(c=>c!==name);
 const replacement=alternatives.length?$('#categoryDestination').value:(name==='Uncategorized'?'General':'Uncategorized');
 const affected=state.decks.filter(d=>d.category===name);
 if(affected.length&&alternatives.length&&!alternatives.includes(replacement)){
  $('#categoryDeleteStatus').textContent='Choose an existing category for these decks.';return;
 }
 const before={categories:state.categories,filter:category,pending:pendingDeck?.category};
 state.categories=alternatives.length?alternatives:[replacement];
 for(const deck of affected)deck.category=replacement;
 if(pendingDeck?.category===name)pendingDeck.category=replacement||state.categories[0];
 if(category===name)category='All decks';
 if(!save()){
  state.categories=before.categories;category=before.filter;
  for(const deck of affected)deck.category=name;
  if(pendingDeck)pendingDeck.category=before.pending;
  $('#categoryDeleteStatus').textContent='Could not save the change. Free browser storage and try again.';return;
 }
 categoryToDelete=null;$('#categoryDeleteDialog').close();render();
 const section=$('#categoriesSection');if(section)section.open=true;
 toast(affected.length?'Category deleted. Decks moved and cards kept.':'Category deleted.');
}
function confirmDelete(message,fn){deleteAction=fn;$('#confirmText').textContent=message;$('#confirmDialog').showModal();}
function download(data,name){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function safeUrl(value){if(!value.trim())return '';const u=new URL(value);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw new Error('Use HTTPS, or HTTP for a localhost server.');if(u.username||u.password)throw new Error('Do not put credentials in this URL.');return u.toString();}
// API configuration and CSRF remain in memory, never in backups or URLs.
let backend={ready:false,csrf:'',base:'',model:''},connectionPromise=null,focusOpening=false;
function apiUrl(path){
 const base=state.settings.apiBase?safeUrl(state.settings.apiBase):location.origin;
 const u=new URL(base),route=new URL(path,'http://aura.invalid');
 // Keep routing and query parameters separate; assigning '?' to pathname encodes it.
 u.pathname=u.pathname.replace(/\/$/,'')+route.pathname;u.search=route.search;u.hash='';
 return u.toString();
}
async function connectBackend(){
 if(connectionPromise)return connectionPromise;
 connectionPromise=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{const response=await fetch(apiUrl('/api/config'),{credentials:'include',signal:controller.signal});const data=await response.json();if(!response.ok||typeof data.csrf_token!=='string')throw new Error(data.error||'API connection failed.');backend={ready:true,csrf:data.csrf_token,base:state.settings.apiBase||location.origin,model:data.ollama_model,cloud:data.cloud,llamacpp:data.llamacpp};updateEngineNotice();return data;}catch(error){backend.ready=false;throw new Error(error.name==='AbortError'?'API connection timed out.':'Local API unavailable. Start python app.py and open localhost.');}finally{clearTimeout(timer);connectionPromise=null;}})();return connectionPromise;
}
async function api(path,options={}){
 if(!backend.ready)await connectBackend();
 const headers={...options.headers};if(options.method&&options.method!=='GET')headers['X-Aura-CSRF']=backend.csrf;
 let body=options.body;if(body&&!(body instanceof FormData)&&typeof body!=='string'){body=JSON.stringify(body);headers['Content-Type']='application/json';}
 const response=await fetch(apiUrl(path),{...options,body,headers,credentials:'include'});
 if(response.ok&&options.onProgress&&response.headers?.get('Content-Type')?.includes('application/x-ndjson')&&response.body?.getReader)return readGenerationStream(response,options.onProgress);
 const data=await response.json().catch(()=>{throw new Error('The API returned an unreadable response.');});
 if(!response.ok){if(data.code==='csrf_required')backend.ready=false;throw new Error(data.error||`Server returned ${response.status}.`);}return data;
}
async function readGenerationStream(response,onProgress){
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',received=0;
 try{
  while(true){
   const {value,done}=await reader.read();
   if(value){received+=value.byteLength;if(received>4*1024*1024)throw new Error('Generation response exceeded its size limit.');}
   buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
   const lines=buffer.split('\n');buffer=lines.pop();if(done&&buffer.trim())lines.push(buffer);
   for(const line of lines){
    if(!line.trim())continue;let event;try{event=JSON.parse(line);}catch{throw new Error('The generation connection returned an unreadable update.');}
    if(event.type==='error')throw new Error(typeof event.error==='string'?event.error:'Generation could not finish.');
    if(event.type==='progress'&&onProgress)onProgress(event);
    if(event.type==='result'&&event.data&&typeof event.data==='object')return event.data;
   }
   if(done)throw new Error('The generation connection closed before the cards were ready. No cards were saved.');
  }
 }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
}
function generationReport(raw){
 if(!raw||!((raw.pipeline==='curriculum-v2'&&['thorough','balanced'].includes(raw.depth))||(raw.pipeline==='flash-v1'&&raw.depth==='flash'))||!['focused','expanded'].includes(raw.answer_detail))return null;
 const keys=['mapped_concepts','covered_concepts','source_sections','selected_sections','represented_sections','repaired_cards','model_calls'];
 if(keys.some(k=>!Number.isInteger(raw[k])||raw[k]<0||raw[k]>10000))return null;
 return {pipeline:raw.pipeline,depth:raw.depth,answer_detail:raw.answer_detail,...Object.fromEntries(keys.map(k=>[k,raw[k]])),topics:Array.isArray(raw.topics)?raw.topics.filter(t=>typeof t==='string').map(t=>t.slice(0,100)).slice(0,50):[],uncovered_concepts:Array.isArray(raw.uncovered_concepts)?raw.uncovered_concepts.filter(t=>typeof t==='string').map(t=>t.slice(0,240)).slice(0,12):[]};
}
function generationSummary(raw){
 const r=generationReport(raw);if(!r)return '';
 if(r.pipeline==='flash-v1')return `<details class="generation-note"><summary>Flash generation · source checks</summary><p>${r.represented_sections} of ${r.source_sections} source sections represented · ${r.model_calls} model requests · ${r.answer_detail==='expanded'?'Expanded explanations':'Focused answers'}. Skipped concept mapping and the separate model review/repair pass. Automatic source, format, numeric and duplicate checks ran. Review each answer and source excerpt before saving.</p></details>`;
 return `<details class="generation-note study-map"><summary>Generated study map · ${r.covered_concepts} of ${r.mapped_concepts} mapped concepts covered</summary><div class="study-map-stats"><span><strong>${r.covered_concepts}</strong> concepts covered</span><span><strong>${r.repaired_cards}</strong> cards repaired</span><span><strong>${r.represented_sections} / ${r.source_sections}</strong> source sections represented</span></div><p>${r.depth==='thorough'?'Thorough':'Balanced'} generation · ${r.answer_detail==='expanded'?'Expanded explanations':'Focused answers'}. ${r.selected_sections} source sections selected for mapping. Describes the original generated draft; editing or removing cards can change coverage. This is not an accuracy score or full-document guarantee. Review the evidence for each card.</p>${r.topics.length?`<div class="study-map-topics">${r.topics.map(t=>`<span class="badge">${esc(t)}</span>`).join('')}</div>`:''}${r.uncovered_concepts.length?`<details class="study-map-gaps"><summary>Mapped concepts not included</summary><ul>${r.uncovered_concepts.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></details>`:''}</details>`;
}
async function syncFocus(){try{const data=await api('/api/focus-sessions');if(Number.isFinite(data.total_minutes)&&data.total_minutes>=0){const changed=state.focusMinutes!==data.total_minutes;state.focusMinutes=data.total_minutes;if(changed){save();if(view==='overview')render();}}}catch{/* No unsolicited offline toast. */}}
async function checkApi(){
 const status=$('#connectionStatus');if(status)status.textContent='Connecting…';backend.ready=false;
 try{await connectBackend();const [local,ollama]=await Promise.all([api('/api/llamacpp/status?'+new URLSearchParams({base_url:state.settings.llamaBase})).catch(()=>({ready:false})),api('/api/models/status')]);
 const message=local.ready?`Connected · llama.cpp · ${local.model}`:ollama.installed?`Connected · ${ollama.model}`:'Connected · offline generation ready';toast(message);if(status)status.textContent=message;
 }catch(error){toast(error.message);if(status)status.textContent='Not connected';}
}
async function openFocus(){
 if(window.AuraLinkedFocus){window.AuraLinkedFocus.open();return;}
 if(focusOpening)return;const d=deckById(selectedDeck)||state.decks[0];if(!d){toast('Create a deck first.');return;}
 let timer;try{timer=new URL(state.settings.pomodoroUrl?safeUrl(state.settings.pomodoroUrl):'/pomodoro',location.origin);}catch(error){toast(error.message);return;}
 // Open synchronously from the click; fill the tab after the API answers.
 const popup=window.open('about:blank','_blank');if(!popup){toast('Allow pop-ups to open the timer.');return;}popup.opener=null;
 focusOpening=true;
 try{
  const data=await api('/api/focus-sessions',{method:'POST',body:{deck_id:d.id,duration_minutes:state.settings.focusDuration,timer_url:timer.toString()}});
  const back=new URL(location.href);back.search='';back.hash='';back.searchParams.set('deck',d.id);
  timer.searchParams.set('deck_id',d.id);timer.searchParams.set('duration',String(state.settings.focusDuration));timer.searchParams.set('return_url',back.toString());
  const fragment=new URLSearchParams(timer.hash.slice(1));fragment.set('aura_session',data.session_id);fragment.set('aura_token',data.completion_token);fragment.set('aura_api',backend.base);timer.hash=fragment.toString();
  popup.location.replace(timer.toString());
 }catch(error){popup.close();toast(error.message);}finally{focusOpening=false;}
}
// Animate the real faces; preserve readable text and accessible review state.
function updateRecallControls(button){
 if(view!=='study'||!session||session.complete||button.isConnected===false)return;
 const flipped=button.classList.contains('flipped');
 const busy=button.classList.contains('is-animating');
 const frozen=document.body?.classList.contains('focus-frozen');
 $$('.study-ratings button').forEach(b=>b.disabled=!flipped||busy||frozen);
 $('.review-hint').textContent=busy?'Revealing…':flipped?'How well did you remember this?':'Reveal the answer to rate your recall.';
}
function flip(button){
 const inner=$('.card-inner',button),front=$('.card-front',button),back=$('.card-back',button);
 const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
 const previous=button._reveal;
 // Capture in-flight values before cancellation, so reversing a click blends
 // from the visible frame rather than briefly flashing the opposite face.
 const snapshot=previous?{front:getComputedStyle(front),back:getComputedStyle(back),inner:getComputedStyle(inner)}:null;
 const current=snapshot?{
  front:{opacity:snapshot.front.opacity,transform:snapshot.front.transform,filter:snapshot.front.filter},
  back:{opacity:snapshot.back.opacity,transform:snapshot.back.transform,filter:snapshot.back.filter},
  inner:{transform:snapshot.inner.transform}
 }:null;
 previous?.cancel();
 const flipped=button.classList.toggle('flipped');
 button.setAttribute('aria-pressed',flipped);button.setAttribute('aria-label',flipped?'Show question':'Reveal answer');
 front.setAttribute('aria-hidden',flipped);back.setAttribute('aria-hidden',!flipped);
 const mode=button.dataset.animation||'flip';
 if(reduced||typeof inner.animate!=='function'){
  button.classList.remove('is-animating');button._reveal=null;updateRecallControls(button);return;
 }
 button.classList.add('is-animating');
 const handles=[],artifacts=[];
 const run={cancel(){for(const a of handles)a.cancel();for(const node of artifacts)node.remove();}};
 button._reveal=run;
 const duration={flip:780,glitch:1120,zen:1000,slide:720,bloom:920}[mode]||720;
 const animate=(element,frames,options={})=>{
  const a=element.animate(frames,{duration,fill:'both',easing:'cubic-bezier(.22,.75,.2,1)',...options});handles.push(a);return a;
 };
 const from=flipped?front:back,to=flipped?back:front;
 if(mode==='flip'){
  const start=flipped?0:180,end=flipped?180:0;
  animate(inner,[current?.inner||{transform:`rotateY(${start}deg) translateY(0) scale(1)`},{transform:`rotateY(${(start+end)/2}deg) translateY(-14px) scale(1.04)`,offset:.48},{transform:`rotateY(${end}deg) translateY(0) scale(1)`}]);
 }else if(previous){
  animate(front,[current.front,{opacity:flipped?0:1,transform:'none',filter:'none'}]);
  animate(back,[current.back,{opacity:flipped?1:0,transform:'none',filter:'none'}]);
 }else if(mode==='glitch'){
  // Logo-style signal lock: the lettering fragments; the card shell stays intact.
  const sourceText=$('.card-question,.card-answer',from),targetText=$('.card-question,.card-answer',to);
  animate(from,[{opacity:1,offset:0},{opacity:0,offset:.58},{opacity:0,offset:1}],{easing:'linear'});
  animate(to,[{opacity:0,offset:0},{opacity:1,offset:.58},{opacity:1,offset:1}],{easing:'linear'});
  animate(sourceText,[{opacity:0},{opacity:0}]);
  animate(targetText,[{opacity:0,offset:0},{opacity:0,offset:.84},{opacity:1,offset:1}],{easing:'linear'});
  const layer=document.createElement('span');layer.className='glitch-stage logo-glitch';layer.setAttribute('aria-hidden','true');button.append(layer);artifacts.push(layer);
  const cardRect=button.getBoundingClientRect();
  const copyText=face=>{
   const copy=face.cloneNode(true);copy.classList.add('effect-face');
   const original=$('.card-question,.card-answer',face),text=$('.card-question,.card-answer',copy);
   // Keep the original wrapping and scroll position, including long answers.
   text.style.opacity='1';
   return {copy,restore(){text.scrollTop=original.scrollTop;}};
  };
  const edges=[0,5,14,24,29,43,52,58,73,82,91,100];
  for(const incoming of [false,true]){
   const face=incoming?to:from,rect=$('.card-question,.card-answer',face).getBoundingClientRect();
   const height=cardRect.height||350;
   const top=rect.height?Math.max(0,(rect.top-cardRect.top)/height*100):20;
   const span=rect.height?Math.min(100-top,rect.height/height*100):60;
   for(let i=0;i<edges.length-1;i++){
    const direction=i%2?1:-1,shift=direction*(24+(i%4)*16),lag=(i%4)*.018;
    const band=document.createElement('span');band.className='tear-band';
    band.style.clipPath=`inset(${top+edges[i]*span/100}% 0 ${Math.max(0,100-top-edges[i+1]*span/100)}% 0)`;
    const piece=document.createElement('span');piece.className='tear-piece';const copy=copyText(face);
    piece.append(copy.copy);band.append(piece);layer.append(band);copy.restore();
    const move=(x,y=0,scale=1)=>`translate(${x}px,${y}px) scaleX(${scale})`;
    animate(piece,incoming?[
     {opacity:0,transform:move(-shift*1.6,0,1.4),offset:0},
     {opacity:0,transform:move(-shift*1.6,0,1.4),offset:.35+lag},
     {opacity:.9,transform:move(shift,-2,1.12),offset:.4+lag},
     {opacity:.5,transform:move(-shift*.7,1,.94),offset:.49+lag},
     {opacity:1,transform:move(shift*.35,0,1.04),offset:.6+lag},
     {opacity:.8,transform:move(-shift*.12,0,1),offset:.73+lag},
     {opacity:1,transform:'none',offset:.87},
     {opacity:0,transform:'none',offset:1}
    ]:[
     {opacity:1,transform:'none',offset:0},
     {opacity:1,transform:move(shift*.1),offset:.1},
     {opacity:.85,transform:move(-shift*.3,-1,1.03),offset:.17+lag},
     {opacity:1,transform:move(shift,2,1.16),offset:.27+lag},
     {opacity:.65,transform:move(-shift*1.5,0,.9),offset:.37+lag},
     {opacity:.2,transform:move(shift*.4,0,1.3),offset:.46+lag},
     {opacity:0,transform:move(shift*2,0,1.7),offset:.56+lag},
     {opacity:0,transform:'none',offset:1}
    ],{easing:'steps(1,end)'});
   }
  }
  // Red, green and blue copies detach, stretch into trails, then register again.
  for(const incoming of [false,true])for(const [channel,sign] of [['red',-1],['green',1],['blue',-1]]){
   const ghost=document.createElement('span');ghost.className=`color-echo ${channel}`;
   const copy=copyText(incoming?to:from);ghost.append(copy.copy);layer.append(ghost);copy.restore();
   const distance=channel==='blue'?34:channel==='red'?22:12;
   animate(ghost,[
    {opacity:0,transform:'none',offset:0},
    {opacity:incoming?0:.5,transform:`translate(${sign*distance/2}px,-2px)`,offset:.16},
    {opacity:incoming?0:.8,transform:`translate(${sign*distance}px,2px) scaleX(1.2)`,offset:.31},
    {opacity:incoming ? .75 : .25,transform:`translate(${-sign*distance}px,-1px) scaleX(.94)`,offset:.43},
    {opacity:incoming ? .7 : 0,transform:`translate(${sign*distance*.55}px,2px) scaleX(1.06)`,offset:.57},
    {opacity:incoming ? .4 : 0,transform:`translate(${-sign*5}px,-1px)`,offset:.72},
    {opacity:incoming ? .25 : 0,transform:`translate(${sign*2}px,0)`,offset:.84},
    {opacity:0,transform:'none',offset:1}
   ],{easing:'steps(1,end)'});
  }
 }else if(mode==='zen'){
  animate(from,[{opacity:1,transform:'translateY(0)',filter:'blur(0)'},{opacity:0,transform:'translateY(-12px)',filter:'blur(9px)'}],{easing:'ease-in-out'});
  animate(to,[{opacity:0,transform:'translateY(14px)',filter:'blur(12px)',offset:0},{opacity:.15,transform:'translateY(10px)',filter:'blur(7px)',offset:.35},{opacity:1,transform:'none',filter:'blur(0)',offset:1}],{easing:'ease-in-out'});
 }else if(mode==='slide'){
  const sign=flipped?1:-1;
  animate(from,[{opacity:1,transform:'translateX(0) rotate(0)'},{opacity:.4,transform:`translateX(${-sign*110}%) rotate(${-sign*5}deg)`}]);
  animate(to,[{opacity:.6,transform:`translateX(${sign*110}%) rotate(${sign*5}deg)`,offset:0},{opacity:1,transform:`translateX(${-sign*2}%) rotate(0)`,offset:.84},{opacity:1,transform:'none',offset:1}]);
 }else{
  animate(from,[{opacity:1,transform:'scale(1)',filter:'blur(0)'},{opacity:0,transform:'scale(1.13)',filter:'blur(12px)'}]);
  animate(to,[{opacity:0,transform:'scale(.78)',filter:'blur(14px)',offset:0},{opacity:.75,transform:'scale(.98)',filter:'blur(2px)',offset:.65},{opacity:1,transform:'scale(1.02)',filter:'blur(0)',offset:.84},{opacity:1,transform:'scale(1)',filter:'blur(0)',offset:1}]);
  const halo=document.createElement('span');halo.className='motion-halo';halo.setAttribute('aria-hidden','true');button.append(halo);artifacts.push(halo);
  animate(halo,[{opacity:0,transform:'scale(.35)',offset:0},{opacity:.7,transform:'scale(.9)',offset:.4},{opacity:0,transform:'scale(1.4)',offset:1}]);
 }
 updateRecallControls(button);
 Promise.all(handles.map(a=>a.finished.catch(()=>{}))).then(()=>{
  if(button._reveal!==run)return;
  run.cancel();button._reveal=null;button.classList.remove('is-animating');updateRecallControls(button);
 });
}

function rate(known){if(!session||session.complete||!$('.study-card.flipped')||$('.study-card.flipped').classList.contains('is-animating'))return;const d=deckById(session.deckId),id=session.ids[session.index],c=d.cards.find(c=>c.id===id);c.mastered=known;c.due=Date.now()+(known?86400000:600000);session.ratings[id]=known;state.reviews.push({at:Date.now(),cardId:id,known});state.reviews=state.reviews.slice(-10000);save();const next=session.ids.findIndex((id,i)=>i>session.index&&!(id in session.ratings));if(next>=0)session.index=next;else {const first=session.ids.findIndex(id=>!(id in session.ratings));if(first>=0)session.index=first;else session.complete=true;}render();}
const actions={
 'upload':openUpload,'new-deck':()=>openEditor('deck'),'new-category':()=>openEditor('category'),'delete-category':b=>openCategoryDelete(b.dataset.categoryName),'all-decks':()=>switchView('decks'),
 'open-deck':b=>{selectedDeck=b.dataset.id;view='detail';search='';render();},
 'edit-deck':b=>openEditor('deck',deckById(b.dataset.id)),
 'study-deck':b=>beginSession(b.dataset.id),
 'new-card':b=>openEditor('card',deckById(b.dataset.id)),
 'edit-card':b=>{const d=deckById(b.dataset.deck);openEditor('card',d,d.cards.find(c=>c.id===b.dataset.id));},
 'star-card':b=>{const c=deckById(b.dataset.deck)?.cards.find(c=>c.id===b.dataset.id);if(c){c.starred=!c.starred;save();if(view==='study'){b.classList.toggle('starred',c.starred);b.setAttribute('aria-pressed',c.starred);}else render();}},
 'delete-card':b=>confirmDelete('This flashcard and its progress will be removed.',()=>{const d=deckById(b.dataset.deck);d.cards=d.cards.filter(c=>c.id!==b.dataset.id);session=null;save();render();toast('Card deleted.');}),
 'delete-deck':b=>{const d=deckById(b.dataset.id);confirmDelete(`“${d.name}” and its ${d.cards.length} cards will be removed.`,()=>{state.decks=state.decks.filter(x=>x.id!==d.id);session=null;selectedDeck=state.decks[0]?.id;save();switchView('decks');toast('Deck deleted.');});},
 'export-deck':b=>{const d=deckById(b.dataset.id);download({version:1,categories:[d.category],decks:[d],settings:{},reviews:[]},'aura-deck.json');toast('Deck exported.');},
 'export-all':()=>{download(state,'aura-cards-backup.json');toast('Backup exported.');},
 'import':()=>$('#importInput').click(), 'focus':openFocus,'flip':flip,'check-api':checkApi,
 'clear-focus':()=>confirmDelete('Clear focus history and open timers on this device?',async()=>{try{await api('/api/focus-sessions',{method:'DELETE'});state.focusMinutes=0;save();render();toast('Focus history cleared.');}catch(error){toast(error.message);}}),
 'reset-colors':()=>{state.settings.colors={};save();applyTheme();render();},
 'start-study':()=>beginSession($('#studyDeck').value),'start-due':()=>beginSession($('#studyDeck').value,true),
 'end-study':()=>{session=null;render();},'restart-study':()=>beginSession(session.deckId),
 'prev-card':()=>{if(session.index>0){session.index--;render();}},'next-card':()=>{if(session.index<session.ids.length-1){session.index++;render();}},
 'rate-again':()=>rate(false),'rate-known':()=>rate(true),
 'shuffle':()=>{const start=session.index;for(let i=session.ids.length-1;i>start;i--){const j=start+Math.floor(Math.random()*(i-start+1));[session.ids[i],session.ids[j]]=[session.ids[j],session.ids[i]];}render();toast('Remaining cards shuffled.');}
};
document.addEventListener('click',e=>{const b=e.target.closest('button,a');if(!b)return;if(b.hasAttribute('data-close')){b.closest('dialog').close();return;}if(b.dataset.view){e.preventDefault();if(b.dataset.view==='study')session=null;switchView(b.dataset.view);return;}if(b.classList.contains('brand')){e.preventDefault();switchView('overview');return;}if(b.dataset.category){category=b.dataset.category;view='decks';search='';render();return;}if(b.dataset.filter){category=b.dataset.filter;render();return;}if(b.dataset.theme){state.settings.theme=b.dataset.theme;state.settings.colors={};save();applyTheme();render();return;}if(b.dataset.action){e.preventDefault();actions[b.dataset.action]?.(b);}});
document.addEventListener('input',e=>{if(e.target.id==='deckSearch'){search=e.target.value;$('#deckGrid').innerHTML=filteredDecks();}if(e.target.id==='cardSearch'){search=e.target.value;$('#cardsList').innerHTML=filteredCards(deckById(selectedDeck));}if(e.target.dataset.color){state.settings.colors[e.target.dataset.color]=e.target.value;save();applyTheme();}});
document.addEventListener('submit',e=>{if(e.target.id==='apiForm'||e.target.id==='pomodoroForm'){e.preventDefault();const key=e.target.id==='apiForm'?'apiBase':'pomodoroUrl';try{const form=new FormData(e.target);state.settings[key]=safeUrl(String(form.get(key)||''));if(key==='pomodoroUrl')state.settings.focusDuration=Number(form.get('focusDuration'))||25;if(key==='apiBase'){backend.ready=false;connectionPromise=null;}save();toast(key==='apiBase'?'API saved.':'Timer saved.');if(key==='apiBase')checkApi();}catch(err){toast(err.message);}}});
$('#editorForm').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target),ctx=editContext;const get=k=>String(f.get(k)||'').trim();if(ctx.type==='deck'&&!ctx.deckId&&state.decks.length>=500)return toast('Maximum 500 decks.');if(ctx.type==='category'&&state.categories.length>=200)return toast('Maximum 200 categories.');if(ctx.type==='category'){const c=get('category');if(!c)return toast('Enter a category name.');if(state.categories.some(x=>x.toLowerCase()===c.toLowerCase()))return toast('That category already exists.');state.categories.push(c);}if(ctx.type==='deck'){if(!get('name'))return toast('Enter a deck name.');const existing=deckById(ctx.deckId),fields={name:get('name'),description:get('description'),category:get('category'),color:get('color')};if(existing)Object.assign(existing,fields);else {const d={id:uid(),...fields,source:'Created by you',created:Date.now(),cards:[]};state.decks.unshift(d);selectedDeck=d.id;view='detail';}}if(ctx.type==='card'){if(!get('question')||!get('answer'))return toast('Enter both a question and an answer.');const d=deckById(ctx.deckId),existing=d.cards.find(c=>c.id===ctx.cardId),fields={question:get('question'),answer:get('answer'),tags:get('tags').split(',').map(t=>t.trim().slice(0,100)).filter(Boolean).slice(0,20)};const target=deckById(get('deckId'))||d;if((!existing||target!==d)&&target.cards.length>=2000)return toast('Maximum 2000 cards per deck.');if(existing){Object.assign(existing,fields,{mastered:false,due:0});delete existing.source;if(target!==d){d.cards=d.cards.filter(c=>c.id!==existing.id);target.cards.push(existing);}}else target.cards.push({id:uid(),...fields,starred:false,mastered:false,due:0});session=null;}save();$('#editorDialog').close();render();toast('Saved.');});
$('#categoryDeleteForm').addEventListener('submit',e=>{e.preventDefault();deleteCategory();});
$('#confirmDelete').addEventListener('click',()=>{deleteAction?.();deleteAction=null;$('#confirmDialog').close();});
$('#uploadTop').addEventListener('click',openUpload);$('#addCategory')?.addEventListener('click',()=>openEditor('category'));$('#sidebarFocus').addEventListener('click',()=>window.AuraLinkedFocus ? window.AuraLinkedFocus.toggle() : openFocus());
$('#uploadCategoryAdd').addEventListener('click',()=>{
 if(uploading)return;const editor=$('#uploadCategoryEditor');
 if(!editor.hidden){closeUploadCategory();return;}
 editor.hidden=false;$('#uploadCategoryAdd').setAttribute('aria-expanded','true');$('#uploadNewCategory').focus();
});
$('#uploadCategorySave').addEventListener('click',addUploadCategory);
$('#uploadCategoryCancel').addEventListener('click',()=>{closeUploadCategory();$('#uploadCategoryAdd').focus();});
$('#uploadNewCategory').addEventListener('keydown',e=>{
 if(e.key==='Enter'){e.preventDefault();e.stopPropagation();addUploadCategory();}
 if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeUploadCategory();$('#uploadCategoryAdd').focus();}
});
$('#quickTheme').addEventListener('click',()=>{state.settings.theme=state.settings.theme==='pearl'?'obsidian':'pearl';state.settings.colors={};save();applyTheme();if(view==='settings')render();});
function selectFile(file){if(uploading||!file)return;const extension=file.name.split('.').pop().toLowerCase();if(!['pdf','docx','pptx'].includes(extension)){toast('Supported formats: PDF, DOCX, PPTX.');return;}if(file.size>20*1024*1024){toast('File exceeds 20 MB.');return;}if(!file.size){toast('File is empty.');return;}selectedFile=file;$('#cloudConsent').checked=false;pendingDeck=null;$('#fileLabel').textContent=file.name;$('#uploadName').value=file.name.replace(/\.[^.]+$/,'').slice(0,100);$('#uploadStatus').textContent=`${(file.size/1024/1024).toFixed(2)} MB`;}
$('#fileInput').addEventListener('change',e=>selectFile(e.target.files[0]));
$('#dropZone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#fileInput').click();}});
['dragenter','dragover'].forEach(t=>$('#dropZone').addEventListener(t,e=>{e.preventDefault();$('#dropZone').classList.add('dragover');}));
['dragleave','drop'].forEach(t=>$('#dropZone').addEventListener(t,e=>{e.preventDefault();$('#dropZone').classList.remove('dragover');if(t==='drop')selectFile(e.dataTransfer.files[0]);}));
$('#uploadDialog').addEventListener('cancel',e=>{if(uploading)e.preventDefault();});
function updateEngineNotice(){
 $('#llamaNotice').hidden=$('#uploadEngine').value!=='llamacpp';
 const cloud=$('#uploadEngine').value==='cloud';$('#cloudNotice').hidden=!cloud;
 const offline=$('#uploadEngine').value==='extractive';$('#uploadFormat').disabled=!offline;if(!offline)$('#uploadFormat').value='auto';
 $('#cloudSetup').textContent=backend.cloud?.configured?'':'Set OPENAI_API_KEY on the server, then restart Aura.';
}
let llamaDetection=0,llamaReady=false;
async function detectLlama(){
 if(uploading)return;
 const revision=++llamaDetection;
 const raw=$('#llamaBase').value.trim();
 const params=new URLSearchParams();if(raw)params.set('base_url',raw);if(state.settings.llamaModel)params.set('model',state.settings.llamaModel);
 // Inspect the selected model, recovering if it has been removed.
 $('#llamaStatus').textContent='Looking for a running llama.cpp model…';
 $('#llamaDetect').disabled=true;llamaReady=false;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
 try{
  let data=await api('/api/llamacpp/status?'+params.toString(),{signal:controller.signal});
  if(data.code==='llamacpp_model'&&params.has('model')){params.delete('model');data=await api('/api/llamacpp/status?'+params.toString(),{signal:controller.signal});}
  if(revision!==llamaDetection||uploading)return;
  const names=Array.isArray(data.models)?data.models.filter(x=>typeof x==='string'):[];
  const selected=names.includes(state.settings.llamaModel)?state.settings.llamaModel:data.model||'';
  $('#llamaModel').innerHTML=names.length?names.map(m=>`<option value="${esc(m)}" ${m===selected?'selected':''}>${esc(m)}</option>`).join(''):'<option value="">Auto-detect loaded model</option>';
  $('#llamaModel').value=selected;
  llamaReady=data.ready===true;
  $('#llamaStatus').textContent=llamaReady?`Ready · ${selected}${data.context_size?' · '+data.context_size.toLocaleString()+' token context':''}. Document text stays on this computer.`:data.message||'No llama.cpp model detected.';
  if(llamaReady&&!state.settings.generatorChosen&&$('#uploadEngine').value==='extractive'){state.settings.generatorMode='llamacpp';$('#uploadEngine').value='llamacpp';updateEngineNotice();}
  if(llamaReady){state.settings.llamaBase=data.base_url;state.settings.llamaModel=selected;$('#llamaBase').value=data.base_url;save();}
 }catch(error){if(revision===llamaDetection)$('#llamaStatus').textContent=error.name==='AbortError'?'Detection timed out. Check the server address.':error.message;}
 finally{clearTimeout(timeout);if(revision===llamaDetection&&!uploading)$('#llamaDetect').disabled=false;}
}
$('#llamaDetect').addEventListener('click',detectLlama);
$('#llamaBase').addEventListener('change',()=>{llamaReady=false;state.settings.llamaBase=$('#llamaBase').value.trim();state.settings.llamaModel='';$('#llamaModel').innerHTML='<option value="">Auto-detect loaded model</option>';save();detectLlama();});
$('#llamaModel').addEventListener('change',()=>{state.settings.llamaModel=$('#llamaModel').value;save();detectLlama();});
$('#uploadEngine').addEventListener('change',()=>{state.settings.generatorChosen=true;save();$('#cloudConsent').checked=false;updateEngineNotice();if($('#uploadEngine').value==='llamacpp')detectLlama();});
function showDrafts(){
 if(!pendingDeck)return;
 $('#draftCards').innerHTML=pendingDeck.cards.map((c,i)=>`<article class="draft-card"><div class="draft-top"><label class="check-line"><input type="checkbox" data-draft-keep="${i}" checked aria-label="Keep card ${i+1}"><span>Card ${i+1}</span></label><span class="badge">${esc(c.origin==='qa'?'Q&A':c.origin==='topic'?'Topic':c.kind||'fact')}</span></div><details ${i===0?'open':''}><summary>${esc(c.question)}</summary><label>Question<textarea data-draft-question="${i}" maxlength="3000" aria-label="Question ${i+1}">${esc(c.question)}</textarea></label><label>Answer<textarea data-draft-answer="${i}" maxlength="10000" aria-label="Answer ${i+1}">${esc(c.answer)}</textarea></label>${c.source?`<details class="source-detail"><summary>Source · ${esc(c.source.label)}</summary><p>${esc(c.source.excerpt)}</p></details>`:''}</details></article>`).join('');
 const report=generationSummary(pendingDeck.generationReport);$('#reviewGeneration').innerHTML=report;$('#reviewGeneration').hidden=!report;
 $('#reviewWarnings').hidden=!pendingDeck.generationWarnings.length;
 $('#reviewWarnings p').textContent=pendingDeck.generationWarnings.join(' ');
 $('#reviewStatus').textContent='';updateDraftCount();$('#reviewDialog').showModal();
}
function updateDraftCount(){
 const count=$$('[data-draft-keep]',$('#draftCards')).filter(el=>el.checked).length;
 $('#reviewCount').textContent=`${count} of ${pendingDeck?.cards.length||0} selected`;
 $('#saveDraftBtn').textContent=`Add ${count} card${count===1?'':'s'}`;$('#saveDraftBtn').disabled=!count;
}
$('#draftCards').addEventListener('change',updateDraftCount);
$('#reviewBack').addEventListener('click',()=>{$('#reviewDialog').close();$('#uploadDialog').showModal();$('#cloudConsent').checked=false;});
$('#reviewForm').addEventListener('submit',e=>{e.preventDefault();if(!pendingDeck)return;
 const cards=[];
 for(const box of $$('[data-draft-keep]',$('#draftCards'))){
  if(!box.checked)continue;const i=Number(box.dataset.draftKeep),original=pendingDeck.cards[i];
  const question=$(`[data-draft-question="${i}"]`,$('#draftCards')).value.trim(),answer=$(`[data-draft-answer="${i}"]`,$('#draftCards')).value.trim();
  if(!question||!answer||question.length>3000||answer.length>10000){$('#reviewStatus').textContent=`Check the question and answer on card ${i+1}.`;return;}
  const card={...original,question,answer};if(question!==original.question||answer!==original.answer)delete card.source;cards.push(card);
 }
 if(!cards.length){$('#reviewStatus').textContent='Select at least one card.';return;}
 if(state.decks.length>=500){$('#reviewStatus').textContent='Maximum 500 decks.';return;}
 const d={...pendingDeck,cards};state.decks.unshift(d);
 if(!save()){state.decks.shift();$('#reviewStatus').textContent='Storage is full. Export your existing decks and free some space, then try again.';return;}
 pendingDeck=null;selectedDeck=d.id;view='detail';render();$('#reviewDialog').close();selectedFile=null;$('#uploadForm').reset();$('#fileLabel').textContent='Choose file';$('#cloudConsent').checked=false;toast(`${cards.length} flashcards added.`);
});
$('#stopGeneration').addEventListener('click',()=>{if(!activeGeneration)return;activeGeneration.auraStopped=true;activeGeneration.abort();$('#stopGeneration').disabled=true;});
$('#uploadForm').addEventListener('submit',async e=>{
 e.preventDefault();if(uploading)return;if(!$('#uploadCategoryEditor').hidden&&!addUploadCategory())return;if(!selectedFile){toast('No file selected.');return;}
 if(state.decks.length>=500){toast('Maximum 500 decks.');return;}
 const engine=$('#uploadEngine').value;
 if(engine==='cloud'&&!$('#cloudConsent').checked){$('#uploadStatus').textContent='Confirm sending document text to OpenAI.';return;}
 const file=selectedFile,f=new FormData();f.append('file',file);f.append('name',$('#uploadName').value.trim());f.append('category',$('#uploadCategory').value);f.append('count',$('#uploadCount').value);f.append('difficulty',$('#uploadDifficulty').value);f.append('engine',engine);f.append('input_format',$('#uploadFormat').value||'auto');f.append('style',$('#uploadStyle').value||'mixed');f.append('focus',$('#uploadFocus').value.trim());if(engine==='cloud')f.append('cloud_consent','yes');if(engine==='llamacpp'){f.append('llama_base',$('#llamaBase').value.trim());f.append('llama_model',$('#llamaModel').value);f.append('generation_depth',$('#generationDepth').value||'thorough');f.append('answer_detail',$('#answerDetail').value||'expanded');state.settings.generationDepth=f.get('generation_depth');state.settings.answerDetail=f.get('answer_detail');}
 state.settings.generatorMode=engine;state.settings.generatorChosen=true;save();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),engine==='llamacpp'?(f.get('generation_depth')==='flash'?210000:f.get('generation_depth')==='thorough'?930000:510000):240000);
 const isFlash=engine==='llamacpp'&&f.get('generation_depth')==='flash';
 activeGeneration=controller;uploading=true;$('#generateBtn').disabled=true;$('#uploadProgress').hidden=false;
 $$('input,select,button,textarea',$('#uploadForm')).forEach(b=>b.disabled=true);
 $('#stopGeneration').hidden=engine!=='llamacpp';$('#stopGeneration').disabled=false;$('#generationCount').hidden=engine!=='llamacpp';$('#generationCount').textContent=engine==='llamacpp'?(isFlash?'0 automatically checked cards ready':'0 reviewed cards ready'):'';
 $('#uploadStatus').className='form-status';$('#uploadStatus').textContent=engine==='cloud'?'Drafting and reviewing…':engine==='llamacpp'?(isFlash?'Flash · drafting directly from your notes…':'Reading document sections, drafting and reviewing locally… This can take several minutes.'):'Generating…';
 try{
  const data=await api('/api/generate',{method:'POST',body:f,signal:controller.signal,...(engine==='llamacpp'?{headers:{Accept:'application/x-ndjson'},onProgress:event=>{if(typeof event.message==='string')$('#uploadStatus').textContent=event.message.slice(0,500);if(Number.isInteger(event.accepted)&&Number.isInteger(event.requested))$('#generationCount').textContent=`${event.accepted} of ${event.requested} ${isFlash?'automatically checked':'reviewed'} cards ready`;}}:{})});
  if(!Array.isArray(data.cards)||!data.cards.length||data.cards.length>50||data.cards.some(c=>typeof c.question!=='string'||!c.question.trim()||c.question.length>3000||typeof c.answer!=='string'||!c.answer.trim()||c.answer.length>10000))throw new Error('The API returned invalid card data.');
  pendingDeck={id:uid(),name:f.get('name'),description:`Generated from ${file.name}`,category:f.get('category'),source:file.name,generationEngine:data.engine,generationReport:generationReport(data.generation_report),generationWarnings:Array.isArray(data.warnings)?data.warnings.filter(w=>typeof w==='string').map(w=>w.slice(0,1000)).slice(0,20):[],color:'#a78bfa',created:Date.now(),cards:data.cards.map(c=>({id:uid(),question:c.question.trim(),answer:c.answer.trim(),kind:typeof c.kind==='string'?c.kind:'fact',origin:['qa','topic'].includes(c.origin)?c.origin:'generated',tags:Array.isArray(c.tags)?c.tags.filter(t=>typeof t==='string').map(t=>t.slice(0,100)).slice(0,20):[],source:c.source&&typeof c.source.excerpt==='string'?{label:String(c.source.label||'Source').slice(0,100),excerpt:c.source.excerpt.slice(0,3000)}:undefined,starred:false,mastered:false,due:0}))};
  $('#uploadDialog').close();showDrafts();
 }catch(err){$('#uploadStatus').className='form-status error';$('#uploadStatus').textContent=err.name==='AbortError'?(controller.auraStopped?'Generation stopped. No cards were saved. Your model may need a moment to finish its current request.':engine==='llamacpp'?'Local generation timed out. Try fewer cards or a smaller document.':'Generation timed out (4 minutes).'):err instanceof TypeError?'API connection failed.':err.message;}
 finally{clearTimeout(timer);activeGeneration=null;$('#stopGeneration').hidden=true;$('#generationCount').hidden=true;uploading=false;$('#generateBtn').disabled=false;$('#uploadProgress').hidden=true;$$('input,select,button,textarea',$('#uploadForm')).forEach(b=>b.disabled=false);$('#cloudConsent').checked=false;updateEngineNotice();}
});
document.addEventListener('change',async e=>{if(e.target.id==='generationDepth'||e.target.id==='answerDetail'){
 const key=e.target.id,values=key==='generationDepth'?['flash','balanced','thorough']:['focused','expanded'];
 if(values.includes(e.target.value)){state.settings[key]=e.target.value;save();updateGenerationDepthNotice();}return;
 }if(e.target.id==='cardLabels'){
 if(!Object.prototype.hasOwnProperty.call(cardLabels,e.target.value))return;
 state.settings.cardLabels=e.target.value;save();
 $('#animationPreview').innerHTML=flashcard({question:'A moment of curiosity.',answer:'A little more clarity.'},'animation-preview');return;
 }if(e.target.id==='cardAnimation'){
 if(!Object.prototype.hasOwnProperty.call(animations,e.target.value))return;
 state.settings.cardAnimation=e.target.value;save();
 $('#animationDescription').textContent=animations[e.target.value][1]+' Click the card below to try it.';
 $('#animationPreview').innerHTML=flashcard({question:'A moment of curiosity.',answer:'A little more clarity.'},'animation-preview');return;
 }if(e.target.id==='categoryFilter'){category=e.target.value;$('#deckGrid').innerHTML=filteredDecks();return;}if(e.target.id!=='importInput')return;const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024){toast('Choose a JSON backup smaller than 10 MB.');return;}try{const data=JSON.parse(await file.text());if(!validState(data))throw new Error('This is not a valid Aura Cards backup.');if(state.decks.length+data.decks.length>500)throw new Error('Import would exceed the limit of 500 decks.');const importedCategories=[...new Set([...state.categories,...data.categories,...data.decks.map(d=>d.category)])];if(importedCategories.length>200)throw new Error('Maximum 200 categories.');state.categories=importedCategories;for(const d of data.decks){state.decks.push({...d,id:uid(),cards:d.cards.map(c=>({...c,id:uid()}))});}save();render();toast(`${data.decks.length} decks imported. Your current decks were kept.`);}catch(err){toast(err.message||'Could not read this backup.');}e.target.value='';});
document.addEventListener('keydown',e=>{if(view!=='study'||!session||session.complete||$('dialog[open]')||['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement.tagName))return;if(e.code==='Space'){e.preventDefault();const card=$('.study-card');if(card)flip(card);}if(e.key==='ArrowRight')actions['next-card']();if(e.key==='ArrowLeft')actions['prev-card']();if(e.key==='1')rate(false);if(e.key==='2')rate(true);});
// Pomodoro may return a deck ID via a navigation link. Completion data is intentionally not trusted here.
const returnDeck=new URLSearchParams(location.search).get('deck');if(returnDeck&&deckById(returnDeck)){selectedDeck=returnDeck;view='detail';}
hydrateIcons();applyTheme();render();if(samplesUpdated)save();if(loadFailed)toast('Stored data could not be loaded. Export a backup after making changes.');

window.addEventListener('focus',()=>syncFocus());
connectBackend().then(()=>syncFocus()).catch(()=>{});
