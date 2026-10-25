const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto'),path=require('path');
const root=path.join(__dirname,'..');
class Element {
 constructor(){this.innerHTML='';this.textContent='';this.value='';this.dataset={};this.listeners={};this.classes=new Set();this.attributes={};this.tagName='MAIN';this.classList={add:v=>this.classes.add(v),remove:v=>this.classes.delete(v),contains:v=>this.classes.has(v),toggle:(v,b)=>{const x=b===undefined?!this.classes.has(v):b;if(x)this.classes.add(v);else this.classes.delete(v);return x;}};}
 addEventListener(k,f){this.listeners[k]=f;}setAttribute(k,v){this.attributes[k]=v;}focus(){}showModal(){this.open=true;}close(){this.open=false;}reset(){}click(){}querySelector(s){return el(s);}querySelectorAll(s){return s==='[data-draft-keep]'?draftBoxes:[];} }
const elements=new Map(),el=s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s);};
el('#uploadCategoryEditor').hidden=true;
let draftBoxes=[];
const ratings=[new Element(),new Element()];const data=new Map(),events={};
const document={querySelector:s=>s==='.study-card.flipped'?(el('.study-card').classes.has('flipped')?el('.study-card'):null):el(s),querySelectorAll:s=>s==='.study-ratings button'?ratings:[],addEventListener:(k,f)=>events[k]=f,createElement:()=>new Element(),documentElement:{style:{setProperty(){}},setAttribute(){}},activeElement:new Element()};
class FormDataMock{constructor(form){this.data=new Map(Object.entries(form?.fields||{}));}append(k,v){this.data.set(k,v);}get(k){return this.data.get(k);}}
const context=vm.createContext({document,localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},crypto,console,URL,URLSearchParams,location:{search:'',href:'http://localhost:5000/',origin:'http://localhost:5000'},getComputedStyle:()=>({getPropertyValue:()=> '#0b0b0e'}),setTimeout:()=>0,clearTimeout(){},FormData:FormDataMock,AbortController,TextDecoder,Uint8Array,Blob,window:{addEventListener(){},open:url=>({opener:{},location:{replace:value=>{context.openedUrl=value;}},close(){context.popupClosed=true;}})},fetch:async(url,options={})=>{context.lastRequest={url,options};return {ok:true,json:async()=>url.endsWith('/api/config')?{csrf_token:'test-csrf',ollama_model:'test:local'}:url.endsWith('/api/focus-sessions')?(options.method==='POST'?{session_id:'s1',completion_token:'token'}:{total_minutes:0}):url.endsWith('/api/generate')?{engine:'extractive',warnings:[],cards:[{question:'From file?',answer:'Yes',origin:'qa',tags:['API'],source:{label:'Page 1',excerpt:'Yes, this is from the uploaded file.'}}]}:{installed:false}};}});
vm.runInContext(fs.readFileSync(path.join(root,'dist/app.js'),'utf8'),context);
let count=0;function check(code){assert.ok(vm.runInContext(code,context),code);count++;}function run(code){return vm.runInContext(code,context);}
check('state.decks.length===3 && allCards().length===18');
check('state.decks.every(d=>d.name.startsWith("Python"))');
check('(()=>{const current=seed();const before=JSON.stringify(current);return !migrateSampleDecks(current)&&JSON.stringify(current)===before;})()');
check('validState(state)');
check('esc("<img src=x onerror=alert(1)>").includes("&lt;")');
check('filteredDecks().includes("Python Basics")');run('category="Data Structures"');check('filteredDecks().includes("Python Data Structures") && !filteredDecks().includes("Python Basics")');
run('search="zzzzz"');check('filteredDecks().includes("No decks match")');run('search="";category="All decks"');
run('openEditor("deck"); document.querySelector("#editorForm").fields={name:"Lab test",description:"Created manually",category:"Python Basics",color:"#aabbcc"}; document.querySelector("#editorForm").listeners.submit({preventDefault(){},target:document.querySelector("#editorForm")})');
check('state.decks.length===4 && deckById(selectedDeck).name==="Lab test"');
run('openEditor("card",deckById(selectedDeck)); document.querySelector("#editorForm").fields={question:"A < B?",answer:"Yes & correct",tags:"math, sample",deckId:selectedDeck}; document.querySelector("#editorForm").listeners.submit({preventDefault(){},target:document.querySelector("#editorForm")})');
check('deckById(selectedDeck).cards.length===1 && deckById(selectedDeck).cards[0].tags.length===2');check('detail().includes("A &lt; B?")');
run('beginSession(selectedDeck)');check('session.ids.length===1 && session.index===0');run('flip(document.querySelector(".study-card"))');check('document.querySelector(".study-card").attributes["aria-pressed"]===true');run('rate(true)');check('session.complete && deckById(selectedDeck).cards[0].mastered && state.reviews.length===1');check('deckById(selectedDeck).cards[0].due>Date.now()+86000000');
run('beginSession(selectedDeck); flip(document.querySelector(".study-card")); flip(document.querySelector(".study-card")); rate(false)');check('session.complete && !deckById(selectedDeck).cards[0].mastered && state.reviews.length===2');
check('safeUrl("http://localhost:5000")==="http://localhost:5000/"');check('(()=>{try{safeUrl("javascript:alert(1)");return false;}catch{return true;}})()');
run('selectFile({name:"bad.exe",size:10})');check('selectedFile===null');run('selectFile({name:"empty.pdf",size:0})');check('selectedFile===null');run('selectFile({name:"large.docx",size:30*1024*1024})');check('selectedFile===null');run('selectFile({name:"notes.pdf",size:1024})');check('selectedFile.name==="notes.pdf" && document.querySelector("#uploadName").value==="notes"');
check('(()=>{const s=seed();s.decks[0].cards[0].tags=[1];return !validState(s);})()');check('(()=>{const s=seed();s.decks[1].id=s.decks[0].id;return !validState(s);})()');
run('state.settings.apiBase="http://localhost:5000"; document.querySelector("#uploadCategory").value="Python Basics";document.querySelector("#uploadCount").value="10";document.querySelector("#uploadDifficulty").value="mixed";document.querySelector("#uploadEngine").value="extractive"');
(async()=>{await run('connectBackend()');check('document.querySelector("#uploadFormat").disabled===false');run('document.querySelector("#uploadFormat").value="qa"');await run('state.settings.pomodoroUrl="https://timer.example/focus?existing=yes";openFocus()');check('new URL(openedUrl).searchParams.get("duration")==="25" && new URL(openedUrl).searchParams.get("existing")==="yes"');check('new URL(openedUrl).hash.includes("aura_token=token") && !new URL(openedUrl).searchParams.has("deck_name")');check('new URL(new URL(openedUrl).searchParams.get("return_url")).searchParams.get("deck")===selectedDeck');await run('document.querySelector("#uploadForm").listeners.submit({preventDefault(){}})');check('pendingDeck.cards[0].question==="From file?" && selectedFile!==null && state.decks[0].cards[0]?.question!=="From file?"');
check('lastRequest.options.body.get("input_format")==="qa"');check('pendingDeck.cards[0].origin==="qa" && document.querySelector("#draftCards").innerHTML.includes("Q&amp;A")');
draftBoxes=run('pendingDeck.cards').map((c,i)=>{const box=new Element();box.checked=true;box.dataset.draftKeep=String(i);el(`[data-draft-question="${i}"]`).value=c.question;el(`[data-draft-answer="${i}"]`).value=c.answer;return box;});
run('updateDraftCount();document.querySelector("#reviewForm").listeners.submit({preventDefault(){}})');
check('state.decks[0].cards[0].question==="From file?" && selectedFile===null');check('validState(JSON.parse(localStorage.getItem(STORAGE)))');check('state.decks[0].cards[0].source.label==="Page 1" && detail().includes("Source · Page 1")');check('lastRequest.options.headers["X-Aura-CSRF"]==="test-csrf"');check('(()=>{const s=seed();s.decks[0].cards[0].source={label:1,excerpt:[]};return !validState(s);})()');run('actions["star-card"]({dataset:{deck:state.decks[0].id,id:state.decks[0].cards[0].id}})');check('state.decks[0].cards[0].starred && starred().includes("From file?")');
run('openEditor("card",state.decks[0],state.decks[0].cards[0]);document.querySelector("#editorForm").fields={question:"What does len do?",answer:"Returns the number of items.",tags:"Python, builtin",deckId:state.decks[1].id};document.querySelector("#editorForm").listeners.submit({preventDefault(){},target:document.querySelector("#editorForm")})');check('state.decks[0].cards.length===0 && state.decks[1].cards.some(c=>c.question==="What does len do?"&&!c.source)');
run('openEditor("category");document.querySelector("#editorForm").fields={category:"Python Patterns"};document.querySelector("#editorForm").listeners.submit({preventDefault(){},target:document.querySelector("#editorForm")})');check('state.categories.includes("Python Patterns")');
const beforeDecks=run('state.decks.length');context.importTarget={id:'importInput',files:[{size:1024,text:async()=>JSON.stringify(run('seed()'))}],value:'file'};await events.change({target:context.importTarget});check(`state.decks.length===${beforeDecks+3}`);check('validState(state)');check('importTarget.value===""');
run('actions["delete-deck"]({dataset:{id:state.decks[0].id}});document.querySelector("#confirmDelete").listeners.click()');check(`state.decks.length===${beforeDecks+2}`);
run('state.settings.theme="pearl";applyTheme();save()');check('document.documentElement.style.colorScheme==="light" && JSON.parse(localStorage.getItem(STORAGE)).settings.theme==="pearl"');
run('document.querySelector("#uploadEngine").value="cloud";document.querySelector("#cloudConsent").checked=false;updateEngineNotice();selectFile({name:"private.docx",size:1024})');
check('document.querySelector("#cloudNotice").hidden===false');check('document.querySelector("#uploadFormat").disabled===true && document.querySelector("#uploadFormat").value==="auto"');
const beforeRequest=context.lastRequest;await run('document.querySelector("#uploadForm").listeners.submit({preventDefault(){}})');assert.strictEqual(context.lastRequest,beforeRequest);count++;
check('document.querySelector("#uploadStatus").textContent.includes("Confirm")');
run('pendingDeck={id:uid(),name:"Draft deck",category:state.categories[0],description:"",generationWarnings:[],cards:[{id:uid(),question:"Old question?",answer:"Old answer.",tags:[],source:{label:"P1",excerpt:"Original evidence."}},{id:uid(),question:"Skip this?",answer:"Skipped.",tags:[]}]};showDrafts()');
draftBoxes=[new Element(),new Element()];draftBoxes[0].checked=true;draftBoxes[0].dataset.draftKeep='0';draftBoxes[1].checked=false;draftBoxes[1].dataset.draftKeep='1';
el('[data-draft-question="0"]').value='Edited question?';el('[data-draft-answer="0"]').value='Edited answer.';
run('updateDraftCount()');check('document.querySelector("#reviewCount").textContent==="1 of 2 selected"');
const kept=run('state.decks.length');run('document.querySelector("#reviewForm").listeners.submit({preventDefault(){}})');
check(`state.decks.length===${kept+1} && state.decks[0].cards.length===1 && !state.decks[0].cards[0].source`);
check('state.decks[0].cards[0].question==="Edited question?" && pendingDeck===null');
// Reduced motion and the no-animation fallback retain the correct accessible face.
run('view="overview";globalThis.glitchCard=document.querySelector(".glitch-test");glitchCard.dataset.animation="glitch";window.matchMedia=()=>({matches:true});flip(glitchCard)');
check('glitchCard.attributes["aria-pressed"]===true && document.querySelector(".card-back").attributes["aria-hidden"]===false');
run('window.matchMedia=()=>({matches:false});flip(glitchCard)');
check('glitchCard.attributes["aria-pressed"]===false && document.querySelector(".card-front").attributes["aria-hidden"]===false');
// Category creation stays inside the upload dialog and preserves its form values.
run('openUpload();selectFile({name:"category-test.pdf",size:1024});document.querySelector("#uploadName").value="Keep this name";document.querySelector("#uploadCount").value="30";document.querySelector("#uploadCategoryAdd").listeners.click()');
check('!document.querySelector("#uploadCategoryEditor").hidden');
run('document.querySelector("#uploadNewCategory").value="   ";addUploadCategory()');check('document.querySelector("#uploadCategoryStatus").textContent.includes("Enter")');
run('document.querySelector("#uploadNewCategory").value="  New film category  ";addUploadCategory()');
check('state.categories.includes("New film category") && document.querySelector("#uploadCategory").value==="New film category"');
check('selectedFile.name==="category-test.pdf" && document.querySelector("#uploadName").value==="Keep this name" && document.querySelector("#uploadCount").value==="30"');
check('document.querySelector("#uploadCategoryEditor").hidden && JSON.parse(localStorage.getItem(STORAGE)).categories.includes("New film category")');
run('document.querySelector("#uploadNewCategory").value="new FILM category"');check('!addUploadCategory() && document.querySelector("#uploadCategoryStatus").textContent.includes("already")');
run('document.querySelector("#uploadNewCategory").value="x".repeat(101)');check('!addUploadCategory()');
run('globalThis.keptCategories=state.categories;state.categories=Array.from({length:200},(_,i)=>"Category "+i);document.querySelector("#uploadNewCategory").value="One too many"');check('!addUploadCategory() && state.categories.length===200');run('state.categories=keptCategories;closeUploadCategory()');
check('Object.keys(themes).length===8');
run('state.settings.cardAnimation="auto";state.settings.theme="cyberpunk";applyTheme()');check('cardAnimation()==="glitch" && document.documentElement.style.colorScheme==="dark"');
run('state.settings.theme="zen";applyTheme()');check('cardAnimation()==="zen" && document.documentElement.style.colorScheme==="light"');
await events.change({target:{id:'cardAnimation',value:'slide'}});check('state.settings.cardAnimation==="slide" && JSON.parse(localStorage.getItem(STORAGE)).settings.cardAnimation==="slide"');
check(`flashcard(state.decks[0].cards[0]).includes('data-animation="slide"')`);
run('state.settings.theme="cyberpunk"');check('cardAnimation()==="slide"');
await events.change({target:{id:'cardLabels',value:'icon'}});check('state.settings.cardLabels==="icon" && JSON.parse(localStorage.getItem(STORAGE)).settings.cardLabels==="icon"');
check('cardLabel("front").includes("sr-only") && cardLabel("front").includes("svg")');
await events.change({target:{id:'cardLabels',value:'none'}});check('cardLabel("front")==="" && cardLabel("back")===""');
check(`flashcard(state.decks[0].cards[0]).includes('data-labels="none"')`);
await events.change({target:{id:'cardLabels',value:'full'}});check('cardLabel("front").includes("<span>Question</span>") && cardLabel("back").includes("<span>Answer</span>")');
await events.change({target:{id:'cardLabels',value:'invalid'}});check('state.settings.cardLabels==="full"');
// Detection must reach the status route, with custom URL/model values in its query.
run('state.settings.apiBase=""');
check('new URL(apiUrl("/api/llamacpp/status?")).pathname==="/api/llamacpp/status"');
run('globalThis.detectionQuery=new URLSearchParams({base_url:"http://127.0.0.1:9090/v1",model:"folder/model Q4_K_M.gguf"});globalThis.detectionURL=new URL(apiUrl("/api/llamacpp/status?"+detectionQuery))');
check('detectionURL.pathname==="/api/llamacpp/status" && !detectionURL.pathname.includes("%3F")');
check('detectionURL.searchParams.get("base_url")==="http://127.0.0.1:9090/v1" && detectionURL.searchParams.get("model")==="folder/model Q4_K_M.gguf"');
run('state.settings.apiBase="http://localhost:5000/aura/?old=value#old";globalThis.prefixedURL=new URL(apiUrl("/api/llamacpp/status?"+detectionQuery))');
check('prefixedURL.pathname==="/aura/api/llamacpp/status" && !prefixedURL.searchParams.has("old") && prefixedURL.hash===""');
check('prefixedURL.searchParams.get("model")==="folder/model Q4_K_M.gguf"');
run('state.settings.apiBase=""');check('apiUrl("/api/generate")==="http://localhost:5000/api/generate"');
// Deleting a category moves decks, preserves cards, and keeps a usable final category.
run('globalThis.categoryTestBefore=JSON.stringify(state);globalThis.fromCategory=state.decks[0].category;globalThis.destinationCategory=state.categories.find(c=>c!==fromCategory);globalThis.cardIDs=state.decks.flatMap(d=>d.cards.map(c=>c.id)).join(",");openCategoryDelete(fromCategory);document.querySelector("#categoryDestination").value=destinationCategory;deleteCategory()');
check('!state.categories.includes(fromCategory)&&state.decks.every(d=>d.category!==fromCategory)');
check('state.decks.flatMap(d=>d.cards.map(c=>c.id)).join(",")===cardIDs');
check('validState(state)&&JSON.parse(localStorage.getItem(STORAGE)).categories.every(c=>c!==fromCategory)');
run('state.categories.push("Empty delete test");openCategoryDelete("Empty delete test");deleteCategory()');check('!state.categories.includes("Empty delete test")');
run('state.categories=["Only category"];state.decks.forEach(d=>d.category="Only category");openCategoryDelete("Only category");deleteCategory()');
check('state.categories.length===1&&state.categories[0]==="Uncategorized"&&state.decks.every(d=>d.category==="Uncategorized")');
run('openCategoryDelete("Uncategorized");deleteCategory()');check('state.categories[0]==="General"&&validState(state)');
run('globalThis.originalSetItem=localStorage.setItem;localStorage.setItem=()=>{throw new Error("Full")};openCategoryDelete("General");deleteCategory();localStorage.setItem=originalSetItem');
check('state.categories[0]==="General"&&state.decks.every(d=>d.category==="General")&&document.querySelector("#categoryDeleteStatus").textContent.includes("Could not save")');
run('state=JSON.parse(categoryTestBefore)');
// The new progress parser handles split UTF-8 and result/error boundaries.
function fakeStream(text){
 const bytes=new TextEncoder().encode(text);let index=0;
 const result={cancelled:false,released:false};
 result.headers={get:()=> 'application/x-ndjson'};result.ok=true;
 result.body={getReader:()=>({read:async()=>index<bytes.length?{done:false,value:bytes.slice(index,index+=7)}:{done:true},cancel:async()=>{result.cancelled=true},releaseLock:()=>{result.released=true}})};
 return result;
}
context.progressEvents=[];
context.reportFixture={pipeline:'curriculum-v2',depth:'thorough',answer_detail:'expanded',mapped_concepts:5,covered_concepts:1,source_sections:3,selected_sections:2,represented_sections:1,repaired_cards:1,model_calls:3,topics:['Café study','<img src=x>']};
const generated={engine:'llamacpp',warnings:[],generation_report:context.reportFixture,cards:[{question:'What does this enzyme need?',answer:'A cofactor and a suitable temperature.',kind:'fact',tags:['Enzymes'],source:{label:'Page 7',excerpt:'The enzyme requires a cofactor.'}}]};
context.progressResponse=fakeStream(JSON.stringify({type:'progress',phase:'mapping',message:'Café concepts',accepted:0,requested:10})+'\n'+JSON.stringify({type:'result',data:generated})+'\n');
const streamData=await run('readGenerationStream(progressResponse,e=>progressEvents.push(e))');
assert.equal(streamData.cards.length,1);count++;
check('progressEvents[0].message==="Café concepts" && progressResponse.cancelled && progressResponse.released');
check('generationSummary(reportFixture).includes("&lt;img src=x&gt;") && !generationSummary(reportFixture).includes("<img src=x>")');
check('generationReport({...reportFixture,covered_concepts:-1})===null && generationSummary({})===""');
for(const text of ['{bad json}\n',JSON.stringify({type:'error',error:'Model is busy'})+'\n',JSON.stringify({type:'heartbeat'})+'\n']){
 context.invalidStream=fakeStream(text);await assert.rejects(run('readGenerationStream(invalidStream,()=>{})'));count++;
 assert.ok(context.invalidStream.cancelled&&context.invalidStream.released);count++;
}
const originalFetch=context.fetch;
context.fetch=async(url,options={})=>{
 if(String(url).endsWith('/api/generate')){context.lastStreamRequest=options;return fakeStream(JSON.stringify({type:'progress',message:'Reviewing the source…',accepted:0,requested:10})+'\n'+JSON.stringify({type:'result',data:generated})+'\n');}
 return originalFetch(url,options);
};
run('selectFile({name:"advanced-local.pdf",size:1024});document.querySelector("#uploadCategory").value=state.categories[0];document.querySelector("#uploadCount").value="10";document.querySelector("#uploadEngine").value="llamacpp";document.querySelector("#generationDepth").value="balanced";document.querySelector("#answerDetail").value="focused"');
await run('document.querySelector("#uploadForm").listeners.submit({preventDefault(){}})');
check('lastStreamRequest.headers.Accept==="application/x-ndjson" && lastStreamRequest.headers["X-Aura-CSRF"]==="test-csrf"');
check('lastStreamRequest.body.get("generation_depth")==="balanced" && lastStreamRequest.body.get("answer_detail")==="focused"');
check('pendingDeck.generationReport.pipeline==="curriculum-v2" && document.querySelector("#reviewGeneration").innerHTML.includes("Generated study map")');
check('state.settings.generationDepth==="balanced" && JSON.parse(localStorage.getItem(STORAGE)).settings.answerDetail==="focused"');
check('!uploading && document.querySelector("#stopGeneration").hidden && activeGeneration===null');
// Flash preferences, upload routing and result labels are distinct from model review.
run('document.querySelector("#generationDepth").value="flash"');
await events.change({target:{id:'generationDepth',value:'flash'}});
check('state.settings.generationDepth==="flash" && JSON.parse(localStorage.getItem(STORAGE)).settings.generationDepth==="flash"');
check('document.querySelector("#generationDepthNotice").textContent.includes("Skips concept mapping")');
run('openUpload()');
check('document.querySelector("#generationDepth").value==="flash"');
context.flashReport={...context.reportFixture,pipeline:'flash-v1',depth:'flash',mapped_concepts:0,covered_concepts:0,repaired_cards:0,model_calls:1};
check('generationSummary(flashReport).includes("Flash generation") && generationSummary(flashReport).includes("separate model review") && !generationSummary(flashReport).includes("Generated study map")');
check('generationReport({...flashReport,pipeline:"curriculum-v2"})===null');
context.fetch=async(url,options={})=>{
 if(!String(url).endsWith('/api/generate'))return originalFetch(url,options);
 context.lastFlashRequest=options;
 return fakeStream(JSON.stringify({type:'progress',message:'Flash · checking…',accepted:1,requested:10})+'\n'+JSON.stringify({type:'result',data:{...generated,generation_report:context.flashReport}})+'\n');
};
run('selectFile({name:"flash-local.pdf",size:1024});document.querySelector("#uploadEngine").value="llamacpp"');
await run('document.querySelector("#uploadForm").listeners.submit({preventDefault(){}})');
check('lastFlashRequest.body.get("generation_depth")==="flash" && lastFlashRequest.body.get("answer_detail")==="focused"');
check('pendingDeck.generationReport.pipeline==="flash-v1" && document.querySelector("#reviewGeneration").innerHTML.includes("Flash generation")');
check('document.querySelector("#generationCount").textContent.includes("automatically checked") && !document.querySelector("#generationCount").textContent.includes("reviewed")');
context.fetch=async(url,options={})=>{
 if(!String(url).endsWith('/api/generate'))return originalFetch(url,options);
 return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{const error=new Error('Aborted');error.name='AbortError';reject(error)}));
};
run('selectFile({name:"cancel-local.pdf",size:1024})');
const stopping=run('document.querySelector("#uploadForm").listeners.submit({preventDefault(){}})');
check('uploading && !document.querySelector("#stopGeneration").hidden && !document.querySelector("#stopGeneration").disabled');
run('document.querySelector("#stopGeneration").listeners.click()');await stopping;
check('!uploading && pendingDeck===null && document.querySelector("#uploadStatus").textContent.includes("Generation stopped")');
context.fetch=originalFetch;
console.log(`${count} functional checks passed (DOM mock; visual browser QA remains unverified).`);})().catch(error=>{console.error(error);process.exitCode=1;});
