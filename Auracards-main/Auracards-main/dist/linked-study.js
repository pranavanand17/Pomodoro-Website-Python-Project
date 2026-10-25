/* Focus companion lives beside the Aura workspace; Aura owns all card data. */
(() => {
    // Persist any first-run sample IDs before sharing the decks with Pomodoro.
    if (!loadFailed) save();
    const panel = document.getElementById('linkedFocus');
    const workspace = document.getElementById('auraWorkspace');
    const trigger = document.getElementById('sidebarFocus');
    const backdrop = document.getElementById('linkedBackdrop');
    const $l = id => document.getElementById(id);
    const modes = {focus:'Focus', shortBreak:'Short break', longBreak:'Long break'};
    let linked = false, lastSnapshot = '', publishing = false, pending = false, saveDelay;
    let settingsRevision = null;

    let drawerOpen=false,drawerRevision=0,drawerAnimations=[];
    function setDrawerOpen(open, returnFocus = false) {
        if(open===drawerOpen&&!panel.hidden)return;
        const wasHidden=panel.hidden;
        const current=wasHidden?null:{opacity:getComputedStyle(panel).opacity,transform:getComputedStyle(panel).transform};
        const backdropOpacity=wasHidden?0:getComputedStyle(backdrop).opacity;
        const revision=++drawerRevision;
        for(const animation of drawerAnimations)animation.cancel();drawerAnimations=[];
        drawerOpen=open;
        if(open){panel.hidden=false;backdrop.hidden=false;panel.inert=false;}
        else panel.inert=true;
        workspace.classList.toggle('focus-companion-open',open);
        // Keep the mobile backdrop and page lock alive through the exit animation.
        if(open)document.body.classList.add('focus-drawer-lock');
        trigger.setAttribute('aria-expanded',String(open));
        trigger.setAttribute('aria-label',open?'Hide Focus companion':'Show Focus companion');
        trigger.title=open?'Hide companion':'Show Focus companion';
        if(open)$l('linkedClose').focus({preventScroll:true});
        if(!open&&returnFocus)trigger.focus({preventScroll:true});
        const finish=()=>{
            if(revision!==drawerRevision)return;
            if(!open){panel.hidden=true;backdrop.hidden=true;document.body.classList.remove('focus-drawer-lock');}
            for(const animation of drawerAnimations)animation.cancel();drawerAnimations=[];
        };
        if((wasHidden&&!open)||window.matchMedia('(prefers-reduced-motion: reduce)').matches||!panel.animate){finish();return;}
        const ease='cubic-bezier(.22,.8,.2,1)';
        drawerAnimations.push(panel.animate([
            current||{opacity:0,transform:'translateX(22px) scale(.97)'},
            open?{opacity:1,transform:'translateX(0) scale(1)'}:{opacity:0,transform:'translateX(16px) scale(.985)'}
        ],{duration:open?440:300,easing:ease,fill:'both'}));
        if(getComputedStyle(backdrop).display!=='none')drawerAnimations.push(backdrop.animate([
            {opacity:wasHidden?0:backdropOpacity},{opacity:open?1:0}
        ],{duration:open?360:280,easing:ease,fill:'both'}));
        Promise.all(drawerAnimations.map(a=>a.finished.catch(()=>{}))).then(finish);
    }

    const request = async body => {
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5000);
        try { return await api('/api/linked/timer', body ? {method:'POST', body, signal:controller.signal} : {signal:controller.signal}); }
        finally { clearTimeout(timeout); }
    };
    const timer = new LinkedTimer(request, draw, message => toast(message));

    function draw(t) {
        const s = t.state;
        $l('linkedClock').textContent = s ? timerText(t.remaining()) : '—:—';
        $l('linkedMode').textContent = s ? modes[s.mode] || 'Focus' : 'Focus';
        $l('linkedRound').textContent = s ? `Round ${s.round} of 4` : 'Your next focus session';
        const total = s?.settings?.[s.mode] * 60;
        const progress = Number.isFinite(total) && total > 0 ? 100 * (1 - Math.min(total, t.remaining()) / total) : 0;
        $l('linkedProgress').style.width = `${Math.max(0, Math.min(100, progress))}%`;
        const connection = $l('linkedConnection');
        connection.classList.toggle('online', t.online);
        connection.classList.toggle('offline', !t.online);
        $l('linkedConnectionText').textContent = t.online ? (s?.running ? 'In session' : 'Ready') : 'Offline';
        $l('focusShortcutDot').classList.toggle('running', Boolean(t.online && s?.running));
        $l('linkedStatus').textContent = !t.online
            ? 'Pomodoro is offline. Start the Pomodoro server, then this companion will reconnect automatically.'
            : `Connected to Pomodoro · ${s.running ? 'Running' : 'Ready or paused'} · Round ${s.round} of 4`;
        $l('linkedToggle').textContent = s?.running ? (s.mode === 'focus' ? 'Pause focus' : 'Pause break') : (s?.mode === 'shortBreak' || s?.mode === 'longBreak' ? 'Start break' : 'Start focus');
        panel.querySelectorAll('[data-timer-action], [data-timer-mode], #linkedSave').forEach(b => b.disabled = !t.online || t.busy);
        $l('linkedDeck').disabled = !t.online || t.busy;
        $l('linkedDeck').textContent = linked ? 'Change linked deck' : 'Link current deck';
        panel.querySelectorAll('[data-timer-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.timerMode === s?.mode)));
        if (s && settingsRevision !== JSON.stringify(s.settings) && !panel.contains(document.activeElement)) {
            for (const key of ['focus','shortBreak','longBreak']) $l('linked-' + key).value = s.settings[key];
            for (const key of ['autoStartBreaks','autoStartFocus']) $l('linked-' + key).checked = s.settings[key];
            settingsRevision = JSON.stringify(s.settings);
        }
        freezeStudy();
    }

    function freezeStudy() {
        const frozen = linked && !timer.active();
        document.body.classList.toggle('focus-frozen', frozen);
        document.querySelectorAll('#mainContent .study-layout').forEach(el => { el.inert = frozen; });
        $l('linkedGate').hidden = !linked;
        $l('linkedGate').textContent = !linked ? ''
            : !timer.online ? 'Your study deck is paused until Pomodoro reconnects.'
            : timer.state?.mode !== 'focus' ? 'Break time. Cards unlock when the next focus round starts.'
            : timer.active() ? 'Studying together. Your deck follows this focus interval.'
            : 'Cards are paused. Start the timer to pick up where you left off.';
        $l('linkedUnlink').hidden = !linked;
        $l('linkedStudyHint').textContent = linked ? 'Your active deck follows the timer. Unlink anytime to study freely.' : 'Optional: pause your cards alongside the timer.';
    }

    // Stop card shortcuts and direct clicks while a linked study session is paused.
    document.addEventListener('keydown', e => {
        if (linked && !timer.active() && view === 'study' && !['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName) && ['Space','ArrowLeft','ArrowRight','Digit1','Digit2'].includes(e.code)) {
            e.preventDefault(); e.stopImmediatePropagation();
        }
    }, true);
    document.addEventListener('click', e => {
        if (linked && !timer.active() && e.target.closest('#mainContent .study-layout')) {
            e.preventDefault(); e.stopImmediatePropagation();
        }
    }, true);
    new MutationObserver(freezeStudy).observe($l('mainContent'), {childList:true});

    $l('linkedClose').addEventListener('click', () => setDrawerOpen(false, true));
    backdrop.addEventListener('click', () => setDrawerOpen(false, true));
    document.addEventListener('keydown', e => {
        if (panel.hidden || document.querySelector('dialog[open]')) return;
        if (e.key === 'Escape') { e.preventDefault(); setDrawerOpen(false, true); }
        if (e.key === 'Tab' && window.matchMedia('(max-width: 850px)').matches) {
            const focusables = [...panel.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]), summary, select:not([disabled])')].filter(el => el.getClientRects().length);
            if (!focusables.length) return;
            const first = focusables[0], last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {e.preventDefault();last.focus();}
            else if (!e.shiftKey && document.activeElement === last) {e.preventDefault();first.focus();}
        }
    });
    panel.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.timerMode) await timer.command('mode', {mode:b.dataset.timerMode});
        if (b.dataset.timerAction) await timer.command(b.dataset.timerAction === 'toggle' ? (timer.state?.running ? 'pause' : 'start') : b.dataset.timerAction);
        if (b.id === 'linkedDeck') {
            const id = session?.deckId || document.getElementById('studyDeck')?.value || selectedDeck;
            if (!deckById(id)?.cards.length) return toast('Choose a deck with cards first.');
            if (!await publish()) return;
            if (!await timer.command('deck', {deck_id:id})) return;
            linked = true;
            try { localStorage.setItem('aura-linked-focus', 'yes'); } catch {}
            if (!session || session.deckId !== id || session.complete) beginSession(id);
            freezeStudy(); remember();
            if (timer.state.mode === 'focus' && !timer.state.running) toast('Deck linked. Start your focus interval when ready.');
        }
        if (b.id === 'linkedUnlink') {
            linked = false;
            try { localStorage.removeItem('aura-linked-focus'); } catch {}
            freezeStudy();
        }
    });
    $l('linkedSettings').addEventListener('submit', async e => {
        e.preventDefault();
        const settings = {};
        for (const key of ['focus','shortBreak','longBreak']) settings[key] = Number($l('linked-' + key).value);
        for (const key of ['autoStartBreaks','autoStartFocus']) settings[key] = $l('linked-' + key).checked;
        if (await timer.command('settings', {settings})) toast('Durations saved. Current interval reset and paused.');
    });

    async function publish() {
        if (publishing) { pending = true; return false; }
        const decks = state.decks.map(d => ({id:d.id,name:d.name,cards:d.cards.map(c=>({id:c.id,question:c.question,answer:c.answer}))}));
        const snapshot = JSON.stringify(decks);
        if (snapshot === lastSnapshot) return true;
        publishing = true;
        try {
            await api('/api/study-library', {method:'POST',body:{decks},signal:AbortSignal.timeout(8000)});
            lastSnapshot = snapshot;
            $l('linkedLibrary').textContent = `${decks.length} decks available to your Pomodoro app.`;
            return true;
        } catch (e) { $l('linkedLibrary').textContent = 'Deck sync pending — ' + e.message; return false; }
        finally { publishing = false; if (pending) {pending = false; setTimeout(publish, 100);} }
    }
    window.addEventListener('aura:changed', () => {clearTimeout(saveDelay); saveDelay = setTimeout(publish, 350);});
    window.addEventListener('focus', publish);
    setInterval(publish, 10000);
    try {
        linked = localStorage.getItem('aura-linked-focus') === 'yes';
        const saved = JSON.parse(sessionStorage.getItem('aura-study-position') || 'null');
        if (saved && deckById(saved.deckId) && Array.isArray(saved.ids) && saved.ids.length && saved.ids.every(id => deckById(saved.deckId).cards.some(c=>c.id===id)) && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < saved.ids.length && saved.ratings && typeof saved.ratings === 'object') {
            session = saved; selectedDeck = saved.deckId; view = 'study'; render();
        }
    } catch {}
    const remember = () => {try {sessionStorage.setItem('aura-study-position', JSON.stringify(session));} catch {}};
    document.addEventListener('click', remember);
    document.addEventListener('keydown', remember);
    window.addEventListener('pagehide', remember);
    window.AuraLinkedFocus = {
        open() { setDrawerOpen(true); },
        close() { setDrawerOpen(false, true); },
        toggle() { setDrawerOpen(!drawerOpen, drawerOpen); },
        timer
    };
    // Never occupy study space on page load, even if the session is restored.
    setDrawerOpen(false);
    timer.start(); publish();
})();
