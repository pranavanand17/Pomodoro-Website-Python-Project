/* Compatibility bridge for modern AuraCards.
 * The original Study Space markup, styles, panels and legacy per-session
 * handoff are deliberately left intact. The Python server owns shared timing.
 */
(() => {
    'use strict';
    let snapshot = null;
    let receivedAt = 0;
    let updating = false;
    let polling = false;
    let lastCompleted = null;

    // The older Aura session handoff is still supported without alteration.
    function legacyActive() { return Boolean(auraSession); }

    async function request(action, extra = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        try {
            const options = {cache: 'no-store', signal: controller.signal};
            if (action) {
                options.method = 'POST';
                options.headers = {'Content-Type': 'application/json'};
                options.body = JSON.stringify({action, revision: snapshot?.revision, ...extra});
            }
            const response = await fetch('/api/timer', options);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `Timer request failed (${response.status}).`);
            return data;
        } finally { clearTimeout(timeout); }
    }

    function accept(state) {
        if (legacyActive()) return;
        // Ignore an older in-flight poll that resolves after a timer write.
        if (snapshot && state.revision < snapshot.revision) return;
        const previous = snapshot;
        snapshot = state;
        receivedAt = performance.now();
        // Existing Study Space rendering functions, labels and colors stay.
        stopInterval();
        running = Boolean(state.running);
        currentMode = state.mode;
        round = state.round;
        remainingSeconds = Math.max(0, Math.ceil(state.remaining_seconds));
        deadline = running ? Date.now() + state.remaining_seconds * 1000 : null;
        settings = {...DEFAULT_SETTINGS, ...state.settings};
        const start = document.getElementById('startButton');
        if (start) { start.textContent = running ? 'Pause' : 'Start'; start.disabled = updating; }
        const reset = document.getElementById('resetButton');
        if (reset) reset.disabled = updating;
        // Only refresh the statistics when a completed focus round was added.
        if (lastCompleted !== null && state.completed > lastCompleted) {
            refreshData().catch(error => console.warn('Statistics refresh:', error));
        }
        lastCompleted = state.completed;
        // Task selection is synchronized with the companion if available.
        if (state.task_id != null && String(state.task_id) !== String(selectedTaskId || '')) {
            selectedTaskId = String(state.task_id);
            const select = document.getElementById('sessionTask');
            if (select && [...select.options].some(o => o.value === selectedTaskId)) select.value = selectedTaskId;
        } else if (previous && previous.task_id !== null && state.task_id === null) {
            selectedTaskId = null;
            const select = document.getElementById('sessionTask');
            if (select) select.value = '';
        }
        updateDisplay();
        updateStatus();
    }

    async function poll() {
        if (legacyActive() || updating || polling) return;
        polling = true;
        try { accept(await request()); }
        catch (error) { /* The original timer remains visible during reconnect. */ }
        finally { polling = false; }
    }

    // Render the authoritative server deadline between 1-second polls without
    // running the old client completion path (which would double-save a round).
    setInterval(() => {
        if (legacyActive() || !snapshot || updating) return;
        const predicted = snapshot.running
            ? snapshot.remaining_seconds - (performance.now() - receivedAt) / 1000
            : snapshot.remaining_seconds;
        remainingSeconds = Math.max(0, Math.ceil(predicted));
        if (remainingSeconds === 0 && running) { poll(); return; }
        updateDisplay();
    }, 250);

    async function command(action, data={}) {
        if (legacyActive() || updating) return;
        updating = true;
        try {
            if (!snapshot) snapshot = await request();
            let previous = snapshot;
            try {
                accept(await request(action, data));
            } catch (error) {
                // A simultaneous command from the Aura companion may have
                // advanced the revision; re-read, then retry just once.
                snapshot = await request();
                if (snapshot.revision === previous.revision) throw error;
                accept(await request(action, data));
            }
        } catch (error) {
            showToast(error.message || 'Could not sync the timer.', true);
            await poll();
        } finally {
            updating = false;
            await poll();
        }
    }

    // Intercept only the timer controls. The existing event handlers for every
    // other feature (tasks, notes, AI, panels, stats) remain unchanged.
    document.addEventListener('click', event => {
        if (legacyActive()) return;
        const button = event.target.closest('button');
        if (!button) return;
        let action = null, extra = {};
        if (button.id === 'startButton') action = snapshot?.running ? 'pause' : 'start';
        else if (button.id === 'resetButton') action = 'reset';
        else if (button.matches('.mode[data-mode]')) {
            action = 'mode'; extra = {mode: button.dataset.mode};
        }
        if (!action) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        command(action, extra);
    }, true);

    document.getElementById('sessionTask')?.addEventListener('change', event => {
        if (!legacyActive()) {
            const id = event.target.value;
            command('task', {task_id: id ? Number(id) : null});
        }
    });

    // Settings continue to be saved using the original form and endpoint;
    // the server now applies them to the shared timer atomically.
    document.getElementById('settingsForm')?.addEventListener('submit', () => {
        setTimeout(poll, 200);
        setTimeout(poll, 800);
    });

    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', () => {if (!document.hidden) poll();});
    setInterval(poll, 1000);
    poll();
})();
