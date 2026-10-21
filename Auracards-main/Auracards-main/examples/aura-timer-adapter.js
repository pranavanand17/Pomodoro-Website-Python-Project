/* Copy this file into the friend's timer project; load it before their timer JS.
   Session control only. Call createAuraTimerAdapter() after a handoff from Aura. */
'use strict';
window.createAuraTimerAdapter=function(){
  const query=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.slice(1));
  let id=fragment.get('aura_session'),token=fragment.get('aura_token'),base=fragment.get('aura_api');
  if(!(id&&token&&base)){
    try{const old=JSON.parse(sessionStorage.getItem('aura-adapter-session'));if(old){id=old.id;token=old.token;base=old.base;}}catch{}
  }
  if(!(id&&token&&base))throw new Error('Open this timer from Aura Cards to connect a session.');
  const api=new URL(base);
  if(api.username||api.password||!(api.protocol==='https:'||(api.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(api.hostname))))throw new Error('Invalid Aura API URL.');
  api.search='';api.hash='';base=api.toString().replace(/\/$/,'');
  try{sessionStorage.setItem('aura-adapter-session',JSON.stringify({id,token,base}));}catch{}
  for(const key of ['aura_session','aura_token','aura_api'])fragment.delete(key);
  history.replaceState(null,'',location.pathname+location.search+(fragment.toString()?'#'+fragment.toString():''));
  let returnUrl=api.origin+'/';
  try{const candidate=new URL(query.get('return_url')||'/',api.origin);if(candidate.origin===api.origin&&!candidate.username&&!candidate.password)returnUrl=candidate.toString();}catch{}
  async function request(action){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const headers={Authorization:'Bearer '+token};if(action)headers['Content-Type']='application/json';
      const response=await fetch(base+'/api/focus-sessions/'+encodeURIComponent(id),{method:action?'POST':'GET',headers,body:action?JSON.stringify({action}):undefined,credentials:'omit',signal:controller.signal});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Aura session request failed.');return result;
    }catch(error){if(error.name==='AbortError')throw new Error('Aura API timed out. Reconnect before continuing.');throw error;}finally{clearTimeout(timeout);}
  }
  return Object.freeze({sessionId:id,returnUrl,deckId:query.get('deck_id'),durationMinutes:Number(query.get('duration'))||25,getStatus:()=>request(),start:()=>request('start'),pause:()=>request('pause'),cancel:()=>request('cancel'),complete:()=>request('complete')});
};
