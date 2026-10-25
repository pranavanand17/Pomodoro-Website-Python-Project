/* Shared transport. Countdown uses a server snapshot and a monotonic browser clock. */
window.LinkedTimer = class {
    constructor(request, render, error) {
        this.request = request; this.render = render; this.error = error;
        this.state = null; this.online = false; this.busy = false; this.polling = false;
    }
    accept(state) {
        this.state = state; this.received = performance.now(); this.online = true;
        this.render(this);
    }
    remaining() {
        if (!this.state) return 0;
        return Math.max(0, this.state.remaining_seconds - (this.state.running ? (performance.now() - this.received) / 1000 : 0));
    }
    active() { return this.online && this.state?.running && this.state.mode === 'focus' && this.remaining() > 0; }
    async poll() {
        if (this.busy || this.polling) return;
        this.polling = true;
        try { this.accept(await this.request()); }
        catch (e) { this.online = false; this.render(this); }
        finally { this.polling = false; }
    }
    async command(action, fields = {}) {
        if (this.busy || !this.online || !this.state) return false;
        this.busy = true; this.render(this);
        // Wait for an in-flight read so an older response cannot overwrite this write.
        while (this.polling) await new Promise(resolve => setTimeout(resolve, 20));
        try {
            this.accept(await this.request({action, ...fields, revision: this.state.revision}));
            return true;
        } catch (e) {
            this.error(e.message);
            try { this.accept(await this.request()); }
            catch { this.online = false; }
            return false;
        } finally { this.busy = false; this.render(this); }
    }
    start() {
        this.poll();
        this.pollId = setInterval(() => this.poll(), 1000);
        this.paintId = setInterval(() => this.render(this), 250);
        window.addEventListener('focus', () => this.poll());
    }
};
window.timerText = seconds => {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
};
