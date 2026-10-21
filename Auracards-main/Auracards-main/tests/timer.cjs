// Behavioral checks against a DOM/fetch mock. These do not render a browser.
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','dist','pomodoro.js'),'utf8');
let checks=0;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup({hash='#aura_session=first&aura_token=secret&aura_api=http%3A%2F%2Flocalhost%3A5000',search='?deck_id=python&duration=1&return_url=https%3A%2F%2Fevil.example',cache=new Map(),fail=false}={}){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{listeners:{},classList:{toggle(){}},addEventListener(k,f){this.listeners[k]=f;}});return elements.get(id);};
 const ctx={performance:{now:()=>ctx.clock},clock:0,document:{getElementById:get,documentElement:{style:{setProperty(){}}}},localStorage:{getItem:()=>null},sessionStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)},location:{origin:'http://localhost:5000',pathname:'/pomodoro',search,hash,href:'http://localhost:5000/pomodoro'+search+hash},history:{replaceState(a,b,value){ctx.cleanedUrl=value;}},URL,URLSearchParams,AbortController,setTimeout:()=>1,clearTimeout(){},setInterval(){},window:{addEventListener(){}},console};
 ctx.snapshot={session_id:'first',status:'pending',remaining_seconds:60,duration_seconds:60,elapsed_seconds:0};ctx.fail=fail;ctx.requests=[];
 ctx.fetch=async(url,options={})=>{
  ctx.requests.push({url,options});if(ctx.rejection&&url.includes('/api/focus-sessions/'))return {ok:false,json:async()=>({code:ctx.rejection,error:'Expired session'})};if(ctx.fail)throw new TypeError('offline');
  let result=ctx.snapshot;
  if(url.endsWith('/api/config'))result={csrf_token:'csrf'};
  else if(url.endsWith('/api/focus-sessions')){ctx.snapshot={...ctx.snapshot,status:'pending',remaining_seconds:60};result={session_id:'created',completion_token:'new-token'};}
  else if(options.method==='POST'){const action=JSON.parse(options.body).action;ctx.snapshot={...ctx.snapshot,status:{start:'running',pause:'paused',cancel:'cancelled',complete:'completed'}[action],remaining_seconds:action==='complete'?0:ctx.snapshot.remaining_seconds};result=ctx.snapshot;}
  return {ok:true,json:async()=>result};
 };
 vm.createContext(ctx);vm.runInContext(source,ctx);ctx.run=code=>vm.runInContext(code,ctx);ctx.el=get;return ctx;
}
function check(value){assert.ok(value);checks++;}
(async()=>{
 const c=setup();await flush();
 check(c.el('timerClock').textContent==='01:00');check(c.el('timerState').textContent==='Ready');
 check(!c.el('returnLink').href.includes('evil.example'));check(!c.cleanedUrl.includes('secret'));check(c.requests[0].options.headers.Authorization==='Bearer secret');
 await c.el('timerToggle').listeners.click();check(c.el('timerToggle').textContent==='Pause');
 c.clock+=10000;c.run('paint()');check(c.el('timerClock').textContent==='00:50');
 await c.el('timerToggle').listeners.click();check(c.el('timerState').textContent==='Paused');
 c.clock+=500000;c.run('paint()');check(c.el('timerClock').textContent==='01:00'); // server snapshot is authoritative
 await c.el('timerToggle').listeners.click();await c.run('complete()');check(c.el('timerState').textContent==='Complete');check(c.el('timerToggle').textContent==='New session'&&!c.el('timerToggle').disabled);
 await c.el('timerToggle').listeners.click();check(c.run('sessionId')==='created');check(c.el('timerState').textContent==='Focusing');
 const create=c.requests.find(r=>r.options.headers['X-Aura-CSRF']);check(JSON.parse(create.options.body).duration_minutes===1);
 const restored=setup({hash:'',cache:c.run('sessionStorage')?new Map([['aura-current-timer','first'],['aura-timer-first',JSON.stringify({sessionId:'first',token:'secret',apiBase:'http://localhost:5000'})]]):new Map()});await flush();check(restored.run('sessionId')==='first');
 const off=setup({fail:true});await flush();check(off.el('timerToggle').textContent==='Reconnect');off.fail=false;await off.el('timerToggle').listeners.click();check(off.el('timerState').textContent==='Ready');
 const invalid=setup({hash:'#aura_api=http%3A%2F%2Fremote.example'});await flush();check(invalid.el('timerToggle').disabled);check(invalid.requests.length===0);
 const standalone=setup({hash:'',search:'?duration=1'});await standalone.el('timerToggle').listeners.click();check(standalone.run('sessionId')==='created');
 const expired=setup();await flush();expired.rejection='session_expired';await expired.run('refresh().catch(failure)');check(expired.el('timerToggle').textContent==='Start');check(expired.run('sessionId')===null);expired.rejection=null;await expired.el('timerToggle').listeners.click();check(expired.el('timerState').textContent==='Focusing');
 console.log(`${checks} timer behavior checks passed (DOM mock).`);
})().catch(error=>{console.error(error);process.exitCode=1;});
