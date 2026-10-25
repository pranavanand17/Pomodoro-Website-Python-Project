// Lightweight DOM contract test, without a browser or external dependencies.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const handlers = {};
const buttons = Object.fromEntries(['startButton','resetButton','sessionTask','settingsForm'].map(id => [id, {id, disabled:false, value:'', addEventListener:(type, cb) => {handlers[id+':'+type]=cb}}]));
let state = {mode:'focus',running:false,round:1,remaining_seconds:1500,revision:0,completed:0,settings:{focus:25,shortBreak:5,longBreak:15,autoStartBreaks:false,autoStartFocus:false},task_id:null};
let actions = [];
let displayCount=0;
const sandbox = {
    auraSession:null, currentMode:'focus', running:false, round:1, remainingSeconds:1500,
    deadline:null, selectedTaskId:null, settings:{...state.settings},
    DEFAULT_SETTINGS:{...state.settings},
    performance:{now:() => 0}, Date,
    document:{getElementById:id=>buttons[id]||null,addEventListener:(type, cb) => {handlers['document:'+type]=cb},hidden:false},
    window:{addEventListener:(type,cb)=>{handlers['window:'+type]=cb}},
    setInterval:()=>1,setTimeout: cb=>{ /* no timeout needed for mock */ return 1 },clearTimeout:()=>{},
    AbortController, console,
    fetch:async (url,options) => {
        assert.equal(url,'/api/timer');
        if (options.method==='POST'){
            const cmd=JSON.parse(options.body);
            assert.equal(cmd.revision,state.revision);
            actions.push(cmd);
            state={...state, revision:state.revision+1};
            if(cmd.action==='start')state.running=true;
            if(cmd.action==='pause')state.running=false;
            if(cmd.action==='mode'){state.mode=cmd.mode;state.remaining_seconds=state.settings[cmd.mode]*60;state.running=false}
        }
        return {ok:true,json:async()=>({...state})};
    },
    stopInterval:()=>{},updateDisplay:()=>{displayCount++},updateStatus:()=>{},refreshData:()=>Promise.resolve(),showToast:(msg)=>{throw new Error(msg)},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','aura-sync.js'),'utf8'),sandbox);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
    await tick();
    assert.ok(displayCount>0,'initial timer read renders');
    async function click(button){
        let blocked=false;
        handlers['document:click']({target:{closest:()=>button},preventDefault(){},stopImmediatePropagation(){blocked=true}});
        await tick(); await tick();
        assert.ok(blocked,'bridge intercepts original timer click');
    }
    await click(buttons.startButton);
    assert.equal(actions[0].action,'start');
    assert.equal(sandbox.running,true);
    await click(buttons.startButton);
    assert.equal(actions[1].action,'pause');
    assert.equal(sandbox.running,false);
    await click({dataset:{mode:'longBreak'},matches:s=>s==='.mode[data-mode]'});
    assert.equal(actions[2].action,'mode');
    assert.equal(sandbox.currentMode,'longBreak');
    console.log('Aura sync JS contract passed');
})().catch(err=>{console.error(err);process.exitCode=1});
