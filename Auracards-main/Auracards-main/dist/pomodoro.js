'use strict';
const params=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.slice(1));
const byId=id=>document.getElementById(id);
let apiBase=fragment.get('aura_api')||location.origin,sessionId=fragment.get('aura_session'),token=fragment.get('aura_token'),csrf='';
let snapshot=null,receivedAt=performance.now(),busy=false,finishing=false,offline=false,focusMinutes=25,fatal=false,revision=0,refreshing=false;
const themes={obsidian:{bg:'#0b0b0e',panel:'#141419',text:'#f4f2f5',muted:'#9997a5',border:'#29272f',gold:'#d8be83',halo:'#a78bfa'},pearl:{bg:'#f7f6f3',panel:'#ffffff',text:'#22202a',muted:'#696472',border:'#dcd8e0',gold:'#b6924c',halo:'#8060c2'},midnight:{bg:'#0b101b',panel:'#141e30',text:'#f0f3fc',muted:'#9aa9c2',border:'#29354b',gold:'#d8be83',halo:'#98a5ff'}};
function message(text,error=false){byId('timerMessage').textContent=text;byId('timerMessage').classList.toggle('error',error);}
function validBase(value){const u=new URL(value);if(u.username||u.password||!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))))throw new Error('Invalid API connection.');u.search='';u.hash='';return u.toString().replace(/\/$/,'');}
try{apiBase=validBase(apiBase);}catch(error){fatal=true;message(error.message,true);byId('timerToggle').disabled=true;}
const requested=Number(params.get('duration'));if(Number.isInteger(requested)&&requested>=1&&requested<=120)focusMinutes=requested;
let deckId=params.get('deck_id')||'standalone-focus';
try{const state=JSON.parse(localStorage.getItem('aura-cards-v1')||'null');const name=state?.settings?.theme||'obsidian';const theme=themes[name]||themes.obsidian;for(const[k,v]of Object.entries(theme))document.documentElement.style.setProperty('--'+k,v);for(const[k,v]of Object.entries(state?.settings?.colors||{})){if(['gold','halo','bg','panel'].includes(k)&&/^#[0-9a-f]{6}$/i.test(v))document.documentElement.style.setProperty('--'+k,v);}document.documentElement.style.colorScheme=name==='pearl'?'light':'dark';const deck=state?.decks?.find(d=>d.id===deckId);if(deck)byId('deckContext').textContent=deck.name;}catch{/* Standalone timer needs no saved decks. */}
// Return only to the Aura API origin (or this same-origin app). No arbitrary redirects.
let back=new URL('/',location.origin);
try{const requestedBack=new URL(params.get('return_url')||'/',location.origin);const allowed=new Set([location.origin,new URL(apiBase).origin]);if(allowed.has(requestedBack.origin)&&!requestedBack.username&&!requestedBack.password){back=requestedBack;}if(!back.searchParams.has('deck')&&deckId!=='standalone-focus')back.searchParams.set('deck',deckId);}catch{}
for(const id of ['returnLink','backToCards'])byId(id).href=back.toString();
// Keep the per-session capability out of subsequent navigations/referrers while
// retaining it in this tab for refresh. Never store it in localStorage.
const cacheKey='aura-timer-'+(sessionId||'new');
if(sessionId&&token){try{sessionStorage.setItem(cacheKey,JSON.stringify({sessionId,token,apiBase}));}catch{}history.replaceState(null,'',location.pathname+location.search);}
else if(sessionId){try{const cached=JSON.parse(sessionStorage.getItem(cacheKey));if(cached){token=cached.token;apiBase=validBase(cached.apiBase);}}catch{}}
// A cleaned URL refresh can restore the session via a tab-local pointer.
if(!sessionId){try{const last=sessionStorage.getItem('aura-current-timer');const cached=last&&JSON.parse(sessionStorage.getItem('aura-timer-'+last));if(cached){sessionId=cached.sessionId;token=cached.token;apiBase=validBase(cached.apiBase);}}catch{}}
function persist(){try{sessionStorage.setItem('aura-current-timer',sessionId);sessionStorage.setItem('aura-timer-'+sessionId,JSON.stringify({sessionId,token,apiBase}));}catch{message('Keep this tab open; browser session storage is unavailable.');}}
async function request(path,body,authorize=false){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);try{const headers={};if(body){headers['Content-Type']='application/json';if(!authorize)headers['X-Aura-CSRF']=csrf;}if(authorize)headers.Authorization='Bearer '+token;const response=await fetch(apiBase+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,headers,credentials:authorize?'omit':'include',signal:controller.signal});const data=await response.json();if(!response.ok){const error=new Error(data.error||'Timer request failed.');error.code=data.code;throw error;}return data;}catch(error){const wrapped=new Error(error.name==='AbortError'?'API timed out. Retry when the server is available.':error instanceof TypeError?'API unavailable. Reconnect before continuing.':error.message);wrapped.code=error.code;throw wrapped;}finally{clearTimeout(timeout);}}
function failure(error){
 if(['session_expired','unauthorized_session'].includes(error.code)){sessionId=null;token=null;snapshot=null;offline=false;try{sessionStorage.removeItem('aura-current-timer');}catch{}message('Session unavailable. Start a new one.',true);}else{offline=true;message(error.message,true);}paint();
}
function apply(data){snapshot=data;receivedAt=performance.now();offline=false;paint();}
function remaining(){if(!snapshot)return focusMinutes*60;return Math.max(0,snapshot.remaining_seconds-(snapshot.status==='running'?(performance.now()-receivedAt)/1000:0));}
function paint(){const seconds=Math.ceil(remaining());byId('timerClock').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');const status=snapshot?.status||'pending';const labels={pending:'Ready',running:'Focusing',paused:'Paused',completed:'Complete',cancelled:'Cancelled'};byId('timerState').textContent=offline?'Connection lost':labels[status];byId('timerToggle').textContent=offline?'Reconnect':status==='running'?'Pause':status==='paused'?'Resume':status==='completed'?'New session':status==='cancelled'?'New session':'Start';byId('timerToggle').disabled=busy||fatal;byId('timerCancel').disabled=busy||fatal||['completed','cancelled'].includes(status);}
async function ensureSession(){if(sessionId&&token)return;const config=await request('/api/config');csrf=config.csrf_token;const result=await request('/api/focus-sessions',{deck_id:deckId,duration_minutes:focusMinutes,timer_url:location.href});sessionId=result.session_id;token=result.completion_token;persist();}
async function refresh(){if(refreshing||fatal)return;refreshing=true;const version=revision;try{await ensureSession();const data=await request('/api/focus-sessions/'+sessionId,null,true);if(version===revision)apply(data);}catch(error){if(version===revision)throw error;}finally{refreshing=false;}}
async function control(action){if(busy||fatal)return;revision++;busy=true;paint();try{await ensureSession();apply(await request('/api/focus-sessions/'+sessionId,{action},true));message(action==='complete'?'Session saved.':'');}catch(error){failure(error);}finally{busy=false;paint();}}
async function complete(){if(finishing||busy||offline)return;finishing=true;await control('complete');finishing=false;}
byId('timerToggle').addEventListener('click',async()=>{if(offline){busy=true;paint();try{await refresh();message('');}catch(error){failure(error);}finally{busy=false;paint();}return;}if(['cancelled','completed'].includes(snapshot?.status)){sessionId=null;token=null;snapshot=null;}await control(snapshot?.status==='running'?'pause':'start');});
byId('timerCancel').addEventListener('click',()=>control('cancel'));
setInterval(()=>{paint();if(snapshot?.status==='running'&&remaining()<=0)complete();},250);
setInterval(()=>{if(sessionId&&!busy&&!offline&&snapshot?.status==='running')refresh().catch(error=>{failure(error);paint();});},15000);
window.addEventListener('focus',()=>{if(sessionId&&!busy)refresh().catch(error=>{failure(error);paint();});});
paint();
if(!fatal&&sessionId&&token){persist();refresh().catch(error=>{failure(error);paint();});}
