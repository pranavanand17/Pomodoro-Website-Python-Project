
const DEFAULT_SETTINGS = {
    focus: 25,
    shortBreak: 5,
    longBreak: 15,
    autoStartBreaks: false,
    autoStartFocus: false
};

// ==============================
// APPLICATION STATE
// ==============================

let settings = { ...DEFAULT_SETTINGS };
let currentMode = "focus";
let round = 1;
let remainingSeconds = DEFAULT_SETTINGS.focus * 60;
let deadline = null;
let timerInterval = null;
let running = false;
let busyFinishing = false;
let auraSession = null;
let auraSessionStatus = null;
let auraSessionReady = false;

let subjects = [];
let tasks = [];
let stats = {};
let selectedTaskId = null;
let toastTimeout = null;

// AI chat state
let chatHistory = [];
let chatBusy = false;
const MAX_CHAT_HISTORY = 10;

// ==============================
// DOM HELPERS
// ==============================

const $ = id => document.getElementById(id);

function normalizeAuraApi(value) {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

    if (
        url.username ||
        url.password ||
        !(url.protocol === "https:" || (url.protocol === "http:" && loopback))
    ) {
        throw new Error("The Aura Cards API URL must use HTTPS, except on localhost.");
    }

    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
}

function readAuraSession() {
    const query = new URLSearchParams(location.search);
    const fragment = new URLSearchParams(location.hash.slice(1));
    let sessionId = fragment.get("aura_session");
    let token = fragment.get("aura_token");
    let apiBase = fragment.get("aura_api");

    if (!sessionId) {
        try {
            sessionId = sessionStorage.getItem("aura-current-timer");
        } catch {
            sessionId = null;
        }
    }

    if (sessionId && token && apiBase) {
        try {
            apiBase = normalizeAuraApi(apiBase);
            auraSession = { sessionId, token, apiBase };
            sessionStorage.setItem(
                `aura-timer-${sessionId}`,
                JSON.stringify(auraSession)
            );
            sessionStorage.setItem("aura-current-timer", sessionId);
        } catch (error) {
            if (error instanceof TypeError) {
                showToast("Could not preserve the Aura Cards session in this tab.", true);
            } else {
                showToast(error.message, true);
            }
            auraSession = null;
        }

        for (const key of ["aura_session", "aura_token", "aura_api"]) {
            fragment.delete(key);
        }
        history.replaceState(
            null,
            "",
            location.pathname + location.search +
                (fragment.toString() ? `#${fragment}` : "")
        );
    } else if (sessionId) {
        try {
            const cached = JSON.parse(
                sessionStorage.getItem(`aura-timer-${sessionId}`)
            );
            if (cached?.sessionId === sessionId && cached.token) {
                auraSession = {
                    sessionId,
                    token: cached.token,
                    apiBase: normalizeAuraApi(cached.apiBase)
                };
            }
        } catch {
            auraSession = null;
        }
    }

    if (!auraSession) return null;

    const duration = Number(query.get("duration"));
    if (Number.isInteger(duration) && duration >= 1 && duration <= 120) {
        remainingSeconds = duration * 60;
    }

    const returnLink = $("auraReturnLink");
    if (returnLink) {
        try {
            const candidate = new URL(
                query.get("return_url") || "/",
                new URL(auraSession.apiBase).origin
            );
            if (
                candidate.origin === new URL(auraSession.apiBase).origin &&
                !candidate.username &&
                !candidate.password
            ) {
                returnLink.href = candidate.toString();
            }
        } catch {
            returnLink.href = auraSession.apiBase;
        }
        returnLink.hidden = false;
    }

    const modes = document.querySelector(".modes");
    const roundDisplay = document.querySelector(".round");
    if (modes) modes.hidden = true;
    if (roundDisplay) roundDisplay.hidden = true;
    if ($("resetButton")) $("resetButton").textContent = "Cancel Aura session";
    return auraSession;
}

async function auraRequest(action) {
    if (!auraSession) throw new Error("No Aura Cards session is connected.");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const options = {
        method: action ? "POST" : "GET",
        headers: {
            Authorization: `Bearer ${auraSession.token}`,
            ...(action ? { "Content-Type": "application/json" } : {})
        },
        credentials: "omit",
        signal: controller.signal
    };

    if (action) options.body = JSON.stringify({ action });

    try {
        const response = await fetch(
            `${auraSession.apiBase}/api/focus-sessions/${encodeURIComponent(auraSession.sessionId)}`,
            options
        );
        let result;
        try {
            result = await response.json();
        } catch {
            throw new Error("Aura Cards returned an invalid response.");
        }
        if (!response.ok) {
            const error = new Error(result.error || "Aura Cards session request failed.");
            error.code = result.code;
            throw error;
        }
        if (
            !result ||
            !["pending", "running", "paused", "completed", "cancelled"].includes(result.status) ||
            !Number.isFinite(result.remaining_seconds)
        ) {
            throw new Error("Aura Cards returned invalid session data.");
        }
        return result;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("Aura Cards timed out. Reconnect before continuing.");
        }
        if (error instanceof TypeError) {
            throw new Error("Aura Cards is unavailable. Reconnect before continuing.");
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function applyAuraState(state) {
    auraSessionStatus = state.status;
    remainingSeconds = Math.max(0, Math.ceil(state.remaining_seconds));
    running = false;
    deadline = null;
    stopInterval();
    auraSessionReady = true;

    if (state.status === "running") {
        startTimer();
    } else {
        updateDisplay();
        updateStatus();
    }

    const startButton = $("startButton");
    const resetButton = $("resetButton");
    if (startButton) {
        startButton.disabled = ["completed", "cancelled"].includes(state.status);
        if (state.status === "completed") startButton.textContent = "Completed";
        if (state.status === "cancelled") startButton.textContent = "Cancelled";
    }
    if (resetButton) {
        resetButton.disabled = ["completed", "cancelled"].includes(state.status);
    }
}

async function refreshAuraState() {
    applyAuraState(await auraRequest());
}

async function api(path, options = {}) {
    const requestOptions = {
        method: options.method || "GET",
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    };

    if (options.body !== undefined) {
        requestOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(path, requestOptions);

    let result;

    try {
        result = await response.json();
    } catch {
        throw new Error("The server returned an invalid response.");
    }

    if (!response.ok || result.success === false) {
        throw new Error(
            result.error ||
            result.message ||
            `Request failed (${response.status}).`
        );
    }

    return result;
}

function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function formatTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function showToast(message, isError = false) {
    const toast = $("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("visible");

    clearTimeout(toastTimeout);

    toastTimeout = setTimeout(() => {
        toast.classList.remove("visible");
    }, 3000);
}

function updateConnectionStatus(connected) {
    const status = $("connectionStatus");
    if (!status) return;

    status.textContent = connected ? "CONNECTED" : "OFFLINE";
    status.classList.toggle("connected", connected);
    status.classList.toggle("disconnected", !connected);
}

// ==============================
// DATA LOADING
// ==============================

async function refreshData() {
    const data = await api("/api/data");

    subjects = Array.isArray(data.subjects) ? data.subjects : [];
    tasks = Array.isArray(data.tasks) ? data.tasks : [];
    stats = data.stats || {};

    settings = {
        ...DEFAULT_SETTINGS,
        ...(data.settings || {})
    };

    if (data.notes !== undefined && $("notes")) {
        $("notes").value = data.notes || "";
    }

    if ($("focusLength")) {
        $("focusLength").value = settings.focus;
    }

    if ($("breakLength")) {
        $("breakLength").value = settings.shortBreak;
    }

    if ($("longBreakLength")) {
        $("longBreakLength").value = settings.longBreak;
    }

    if ($("autoStartBreaks")) {
        $("autoStartBreaks").checked = settings.autoStartBreaks;
    }

    if ($("autoStartFocus")) {
        $("autoStartFocus").checked = settings.autoStartFocus;
    }

    renderSubjects();
    renderTasks();
    renderTaskSelect();
    renderStats();

    updateConnectionStatus(true);
}

// ==============================
// POMODORO TIMER
// ==============================

function durationFor(mode = currentMode) {
    switch (mode) {
        case "shortBreak":
            return Number(settings.shortBreak) * 60;
        case "longBreak":
            return Number(settings.longBreak) * 60;
        default:
            return Number(settings.focus) * 60;
    }
}

function updateDisplay() {
    const timer = $("timer");
    if (timer) {
        timer.textContent = formatTime(remainingSeconds);
    }

    document.body.dataset.mode = currentMode;

    const themeColor = {
        focus: "#ba4949",
        shortBreak: "#397f8a",
        longBreak: "#467b65"
    }[currentMode];
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
        "content",
        themeColor
    );

    document.title = running
        ? `${formatTime(remainingSeconds)} | Study Space`
        : "Study Space | Pomodoro";

    document.querySelectorAll(".mode[data-mode]").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.mode === currentMode
        );
    });

    const roundDisplay = $("round");
    if (roundDisplay) {
        roundDisplay.textContent = round;
    }
}

function updateStatus() {
    const status = $("status");
    if (!status) return;

    if (auraSession && auraSessionStatus === "completed") {
        status.textContent = "Aura Cards session complete.";
        return;
    }
    if (auraSession && auraSessionStatus === "cancelled") {
        status.textContent = "Aura Cards session cancelled.";
        return;
    }

    const labels = {
        focus: running ? "Focus session in progress." : "Time to focus.",
        shortBreak: running ? "Short break in progress." : "Take a short break.",
        longBreak: running ? "Long break in progress." : "Step away and recharge."
    };

    status.textContent = labels[currentMode] || "READY";
}

function stopInterval() {
    if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function syncRemainingFromClock() {
    if (!running || deadline === null) return;

    remainingSeconds = Math.max(
        0,
        Math.ceil((deadline - Date.now()) / 1000)
    );

    updateDisplay();

    if (remainingSeconds <= 0) {
        finishSession();
    }
}

function startTimer() {
    if (running || busyFinishing) return;

    running = true;
    deadline = Date.now() + remainingSeconds * 1000;

    stopInterval();

    timerInterval = setInterval(syncRemainingFromClock, 250);

    const startButton = $("startButton");
    if (startButton) startButton.textContent = "Pause";

    updateDisplay();
    updateStatus();
}

function pauseTimer() {
    if (!running) return;

    remainingSeconds = Math.max(
        0,
        Math.ceil((deadline - Date.now()) / 1000)
    );

    running = false;
    deadline = null;

    stopInterval();

    const startButton = $("startButton");
    if (startButton) startButton.textContent = "Start";

    updateDisplay();
    updateStatus();
}

function resetTimer() {
    if (auraSession) {
        cancelAuraSession();
        return;
    }

    pauseTimer();

    remainingSeconds = durationFor();

    updateDisplay();
    updateStatus();
}

function setMode(mode) {
    if (auraSession) return;

    const allowedModes = ["focus", "shortBreak", "longBreak"];
    if (!allowedModes.includes(mode)) return;

    pauseTimer();

    currentMode = mode;
    remainingSeconds = durationFor(mode);

    updateDisplay();
    updateStatus();
}

async function cancelAuraSession() {
    if (!auraSession || !auraSessionReady || busyFinishing) return;

    const button = $("resetButton");
    if (button) button.disabled = true;

    try {
        applyAuraState(await auraRequest("cancel"));
        showToast("Aura Cards session cancelled.");
    } catch (error) {
        showToast(error.message || "Could not cancel the Aura Cards session.", true);
    } finally {
        if (button && !["completed", "cancelled"].includes(auraSessionStatus)) {
            button.disabled = false;
        }
    }
}

async function toggleAuraSession() {
    if (!auraSession) {
        if (running) {
            pauseTimer();
        } else {
            startTimer();
        }
        return;
    }

    if (!auraSessionReady || busyFinishing) return;

    const button = $("startButton");
    if (button) button.disabled = true;

    try {
        const action = running ? "pause" : "start";
        applyAuraState(await auraRequest(action));
    } catch (error) {
        showToast(error.message || "Could not update the Aura Cards session.", true);
    } finally {
        if (button && !["completed", "cancelled"].includes(auraSessionStatus)) {
            button.disabled = false;
        }
    }
}

async function finishSession() {
    if (busyFinishing) return;

    busyFinishing = true;
    pauseTimer();
    remainingSeconds = 0;
    updateDisplay();

    const completedMode = currentMode;
    const completedDuration = durationFor(completedMode);

    try {
        if (completedMode === "focus") {
            if (auraSession) {
                applyAuraState(await auraRequest("complete"));
                showToast("Aura Cards session completed.");
                return;
            }

            await api("/api/session", {
                method: "POST",
                body: {
                    duration: Math.round(completedDuration / 60),
                    task_id: selectedTaskId || null
                }
            });

            round++;

            showToast("Focus session completed.");

            currentMode = round % 4 === 1
                ? "longBreak"
                : "shortBreak";
        } else {
            showToast("Break completed.");
            currentMode = "focus";
        }

        remainingSeconds = durationFor();

        await refreshData();
    } catch (error) {
        console.error("Could not save session:", error);
        if (auraSession) {
            try {
                await refreshAuraState();
            } catch (refreshError) {
                console.error("Could not refresh Aura Cards session:", refreshError);
            }
            showToast(error.message || "Could not complete the Aura Cards session.", true);
            return;
        }

        showToast("Session finished, but saving failed.", true);

        if (completedMode === "focus") {
            round++;
            currentMode = round % 4 === 1
                ? "longBreak"
                : "shortBreak";
        } else {
            currentMode = "focus";
        }

        remainingSeconds = durationFor();
    } finally {
        busyFinishing = false;
        updateDisplay();
        updateStatus();

        const shouldAutoStart =
            !auraSession && (
            (currentMode !== "focus" && settings.autoStartBreaks) ||
            (currentMode === "focus" && settings.autoStartFocus)
            );

        if (shouldAutoStart) {
            startTimer();
        }
    }
}

// ==============================
// PANEL NAVIGATION
// ==============================

function openPanel(id) {
    closePanels();

    const panel = $(id);
    if (!panel) return;

    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");

    const backdrop = $("panelBackdrop");
    if (backdrop) backdrop.classList.add("visible");

    document.querySelectorAll("[data-panel]").forEach(button => {
        button.classList.toggle("active", button.dataset.panel === id);
        if (button.id === "auraCardsButton") {
            button.setAttribute("aria-expanded", String(button.dataset.panel === id));
        }
    });

    if (id === "auraPanel") loadAuraPanel();

    if (id === "statsPanel") {
        refreshData().catch(error => {
            console.error("Could not refresh statistics:", error);
            showToast("Could not refresh statistics.", true);
        });
    }

    if (id === "chatPanel") {
        scrollChatToBottom();

        setTimeout(() => {
            if (!chatBusy) $("chatInput")?.focus();
        }, 200);
    }
}

function closePanels() {
    document.querySelectorAll(".side-panel").forEach(panel => {
        panel.classList.remove("open");
        panel.setAttribute("aria-hidden", "true");
    });

    const backdrop = $("panelBackdrop");
    if (backdrop) backdrop.classList.remove("visible");

    document.querySelectorAll("[data-panel]").forEach(button => {
        button.classList.remove("active");
        if (button.id === "auraCardsButton") {
            button.setAttribute("aria-expanded", "false");
        }
    });
}

async function loadAuraPanel() {
    const frame = $("auraCardsFrame");
    const status = $("auraPanelStatus");
    if (!frame || frame.dataset.loaded === "true") return;

    if (status) {
        status.hidden = false;
        status.textContent = "Connecting to Aura Cards…";
    }

    try {
        const config = await api("/api/integrations/config");
        const url = new URL(config.auracards_url);
        const externalLink = $("auraCardsOpenExternal");
        if (externalLink) externalLink.href = url.href;
        if (url.origin === location.origin) {
            throw new Error("Aura Cards must use a separate origin to open in the side panel.");
        }
        frame.src = url.href;
        frame.dataset.loaded = "true";
        if (externalLink) externalLink.href = url.href;
        if (status) status.hidden = true;
    } catch (error) {
        if (status) {
            status.hidden = false;
            status.textContent = error.message || "Could not connect to Aura Cards.";
        }
        showToast(error.message || "Could not connect to Aura Cards.", true);
    }
}

document.querySelectorAll("[data-panel]").forEach(button => {
    button.addEventListener("click", () => {
        openPanel(button.dataset.panel);
    });
});

document.querySelectorAll(".close-panel").forEach(button => {
    button.addEventListener("click", closePanels);
});

$("panelBackdrop")?.addEventListener("click", closePanels);

document.addEventListener("keydown", event => {
    if (event.key === "Escape") closePanels();
});

// ==============================
// SUBJECTS
// ==============================

function renderSubjects() {
    const taskSubject = $("taskSubject");
    const selectedTaskSubject = taskSubject?.value || "";
    if (taskSubject) {
        taskSubject.innerHTML = `
            <option value="">Unassigned</option>
            ${subjects.map(subject => `
                <option value="${escapeText(subject.id)}">
                    ${escapeText(subject.name)}
                </option>
            `).join("")}
        `;
        taskSubject.value = selectedTaskSubject;
    }

    const subjectFilter = $("subjectFilter");
    const selectedFilter = subjectFilter?.value || "all";
    if (subjectFilter) {
        subjectFilter.innerHTML = `
            <option value="all">All subjects</option>
            ${subjects.map(subject => `
                <option value="${escapeText(subject.id)}">
                    ${escapeText(subject.name)}
                </option>
            `).join("")}
        `;
        subjectFilter.value = subjects.some(
            subject => String(subject.id) === selectedFilter
        ) ? selectedFilter : "all";
    }

    const list = $("subjectList");
    if (!list) return;

    if (subjects.length === 0) {
        list.innerHTML = '<p class="empty-state">No subjects yet. Add one to organise your work.</p>';
        return;
    }

    list.innerHTML = subjects.map(subject => `
        <div class="subject-item" data-id="${escapeText(subject.id)}">
            <span>${escapeText(subject.name)}</span>
            <button
                type="button"
                class="delete-subject"
                data-id="${escapeText(subject.id)}"
                aria-label="Delete ${escapeText(subject.name)}"
            >×</button>
        </div>
    `).join("");
}

$("subjectForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const input = $("subjectInput");
    const name = input?.value.trim();

    if (!name) return;

    try {
        await api("/api/subjects", {
            method: "POST",
            body: { name }
        });

        input.value = "";
        await refreshData();
        showToast("Subject added.");
    } catch (error) {
        showToast(error.message || "Could not add subject.", true);
    }
});

$("subjectList")?.addEventListener("click", async event => {
    const button = event.target.closest(".delete-subject");
    if (!button) return;

    try {
        await api(`/api/subjects/${encodeURIComponent(button.dataset.id)}`, {
            method: "DELETE"
        });

        await refreshData();
        showToast("Subject deleted.");
    } catch (error) {
        showToast(error.message || "Could not delete subject.", true);
    }
});

// ==============================
// TASKS
// ==============================

function renderTaskSelect() {
    const select = $("sessionTask");
    if (!select) return;

    const previousValue = selectedTaskId;

    select.innerHTML = `
        <option value="">No task selected</option>
        ${tasks
            .filter(task => !task.completed)
            .map(task => `
                <option value="${escapeText(task.id)}">
                    ${escapeText(task.title)}
                </option>
            `).join("")}
    `;

    const stillExists = tasks.some(task =>
        String(task.id) === String(previousValue) && !task.completed
    );

    selectedTaskId = stillExists ? previousValue : null;
    select.value = selectedTaskId || "";
}

function renderTasks() {
    const list = $("taskList");
    if (!list) return;

    const filter = $("taskFilter")?.value || "all";
    const subjectFilter = $("subjectFilter")?.value || "all";
    const completedCount = tasks.filter(task => task.completed).length;
    const progress = $("taskProgress");
    if (progress) {
        progress.textContent = `${completedCount} / ${tasks.length} done`;
    }

    const visibleTasks = tasks.filter(task => {
        if (filter === "active") return !task.completed;
        if (filter === "completed") return Boolean(task.completed);
        return true;
    }).filter(task => {
        return subjectFilter === "all" ||
            String(task.subject_id || "") === subjectFilter;
    });

    if (visibleTasks.length === 0) {
        list.innerHTML = '<p class="empty-state">No tasks to display.</p>';
        return;
    }

    list.innerHTML = visibleTasks.map(task => {
        const subject = subjects.find(
            item => String(item.id) === String(task.subject_id)
        );

        return `
            <div class="task-item ${task.completed ? "completed" : ""}"
                 data-id="${escapeText(task.id)}">
                <label class="task-label">
                    <input
                        type="checkbox"
                        class="task-checkbox"
                        data-id="${escapeText(task.id)}"
                        ${task.completed ? "checked" : ""}
                    >
                    <span class="task-title">${escapeText(task.title)}</span>
                </label>
                <div class="task-meta">
                    ${subject ? `<span>${escapeText(subject.name)}</span>` : ""}
                    ${task.due_date ? `<span>${escapeText(task.due_date)}</span>` : ""}
                    <button
                        type="button"
                        class="delete-task"
                        data-id="${escapeText(task.id)}"
                        aria-label="Delete task"
                    >×</button>
                </div>
            </div>
        `;
    }).join("");
}

$("taskForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const titleInput = $("taskInput");
    const title = titleInput?.value.trim();

    if (!title) return;

    try {
        await api("/api/tasks", {
            method: "POST",
            body: {
                title,
                subject_id: $("taskSubject")?.value || null,
                due_date: $("taskDueDate")?.value || null
            }
        });

        titleInput.value = "";

        if ($("taskDueDate")) $("taskDueDate").value = "";

        await refreshData();
        showToast("Task added.");
    } catch (error) {
        showToast(error.message || "Could not add task.", true);
    }
});

$("sessionTask")?.addEventListener("change", event => {
    selectedTaskId = event.target.value || null;
});

$("taskFilter")?.addEventListener("change", renderTasks);
$("subjectFilter")?.addEventListener("change", renderTasks);

$("taskList")?.addEventListener("change", async event => {
    const checkbox = event.target.closest(".task-checkbox");
    if (!checkbox) return;

    try {
        await api(`/api/tasks/${encodeURIComponent(checkbox.dataset.id)}`, {
            method: "PATCH",
            body: { completed: checkbox.checked }
        });

        await refreshData();
    } catch (error) {
        showToast(error.message || "Could not update task.", true);
        await refreshData();
    }
});

$("taskList")?.addEventListener("click", async event => {
    const button = event.target.closest(".delete-task");
    if (!button) return;

    try {
        await api(`/api/tasks/${encodeURIComponent(button.dataset.id)}`, {
            method: "DELETE"
        });

        if (String(selectedTaskId) === String(button.dataset.id)) {
            selectedTaskId = null;
        }

        await refreshData();
        showToast("Task deleted.");
    } catch (error) {
        showToast(error.message || "Could not delete task.", true);
    }
});

// ==============================
// NOTES
// ==============================

$("saveNotes")?.addEventListener("click", async () => {
    try {
        await api("/api/notes", {
            method: "POST",
            body: { notes: $("notes")?.value || "" }
        });

        const saved = $("notesSaved");
        if (saved) {
            saved.textContent = "Saved";
            setTimeout(() => {
                saved.textContent = "";
            }, 2000);
        }

        showToast("Notes saved.");
    } catch (error) {
        showToast(error.message || "Could not save notes.", true);
    }
});

// ==============================
// SETTINGS
// ==============================

$("settingsForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const newSettings = {
        focus: Number($("focusLength")?.value) || DEFAULT_SETTINGS.focus,
        shortBreak: Number($("breakLength")?.value) || DEFAULT_SETTINGS.shortBreak,
        longBreak: Number($("longBreakLength")?.value) || DEFAULT_SETTINGS.longBreak,
        autoStartBreaks: Boolean($("autoStartBreaks")?.checked),
        autoStartFocus: Boolean($("autoStartFocus")?.checked)
    };

    const validLengths = [
        newSettings.focus,
        newSettings.shortBreak,
        newSettings.longBreak
    ].every(value => Number.isFinite(value) && value >= 1 && value <= 180);

    if (!validLengths) {
        showToast("Timer lengths must be between 1 and 180 minutes.", true);
        return;
    }

    try {
        const result = await api("/api/settings", {
            method: "POST",
            body: { settings: newSettings }
        });

        settings = {
            ...DEFAULT_SETTINGS,
            ...(result.settings || newSettings)
        };

        if (!running) {
            remainingSeconds = durationFor();
            updateDisplay();
        }

        updateStatus();
        showToast("Settings saved.");
    } catch (error) {
        showToast(error.message || "Could not save settings.", true);
    }
});

// ==============================
// STATISTICS
// ==============================

function renderStats() {
    const data = stats || {};

    const today = data.today || {};
    const week = data.week || {};
    const allTime = data.all_time || {};

    if ($("todayTime")) {
        $("todayTime").textContent = `${today.minutes || 0} min`;
    }

    if ($("todaySessions")) {
        $("todaySessions").textContent = today.sessions || 0;
    }

    if ($("weekTime")) {
        $("weekTime").textContent = `${week.minutes || 0} min`;
    }

    if ($("streakCount")) {
        $("streakCount").textContent = data.streak || 0;
    }

    if ($("streakLabel")) {
        $("streakLabel").textContent =
            Number(data.streak || 0) === 1 ? "day streak" : "day streak";
    }

    if ($("allTime")) {
        $("allTime").textContent = `${allTime.minutes || 0} min`;
    }

    if ($("allSessions")) {
        $("allSessions").textContent = allTime.sessions || 0;
    }

    renderWeeklyChart(week.days || []);
    renderSubjectAnalytics(data.subjects || []);
    renderTaskProgress(data.tasks || []);
}

function renderWeeklyChart(days) {
    const chart = $("weeklyChart");
    if (!chart) return;

    if (!Array.isArray(days) || days.length === 0) {
        chart.innerHTML = '<p class="empty-state">No weekly data yet.</p>';
        return;
    }

    const maxMinutes = Math.max(
        1,
        ...days.map(day => Number(day.minutes || 0))
    );

    chart.innerHTML = days.map(day => {
        const minutes = Number(day.minutes || 0);
        const height = Math.max(4, (minutes / maxMinutes) * 100);

        return `
            <div class="chart-day">
                <div class="chart-bar-container">
                    <div class="chart-bar"
                         style="height:${height}%"
                         title="${minutes} minutes"></div>
                </div>
                <span>${escapeText(day.label || day.day || "")}</span>
            </div>
        `;
    }).join("");
}

function renderSubjectAnalytics(subjectData) {
    const container = $("subjectAnalytics");
    if (!container) return;

    if (!Array.isArray(subjectData) || subjectData.length === 0) {
        container.innerHTML = '<p class="empty-state">No subject data yet.</p>';
        return;
    }

    container.innerHTML = subjectData.map(subject => `
        <div class="analytics-row">
            <span>${escapeText(subject.name || "Unknown subject")}</span>
            <strong>${Number(subject.minutes || 0)} min</strong>
        </div>
    `).join("");
}

function renderTaskProgress(taskData) {
    const bar = $("taskProgressBar");
    const text = $("taskProgressText");

    if (!bar || !text) return;

    const completed = Number(
        taskData.completed ?? taskData.done ?? 0
    );

    const total = Number(
        taskData.total ?? taskData.count ?? 0
    );

    const percentage = total > 0
        ? Math.min(100, Math.round((completed / total) * 100))
        : 0;

    bar.style.width = `${percentage}%`;
    text.textContent = `${completed} / ${total} tasks completed`;
}

$("refreshStats")?.addEventListener("click", async () => {
    try {
        await refreshData();
        showToast("Statistics refreshed.");
    } catch (error) {
        showToast("Could not refresh statistics.", true);
    }
});

$("refreshAuraStats")?.addEventListener("click", async () => {
    const output = $("auraProgress");
    if (output) output.textContent = "Connecting to Aura Cards…";

    try {
        const summary = await api("/api/integrations/auracards");
        if (
            summary.service !== "auracards" ||
            !Number.isInteger(summary.completed_sessions) ||
            !Number.isInteger(summary.total_minutes)
        ) {
            throw new Error("Aura Cards returned invalid summary data.");
        }

        const sessions = summary.completed_sessions;
        const minutes = summary.total_minutes;
        if (output) {
            output.textContent =
                `${sessions} completed focus ${sessions === 1 ? "session" : "sessions"} · ${minutes} minutes total.`;
        }
    } catch (error) {
        if (output) {
            output.textContent = error.message || "Could not load Aura Cards progress.";
        }
        showToast(error.message || "Could not load Aura Cards progress.", true);
    }
});

// ==============================
// AI STUDY SIDEKICK
// ==============================

function scrollChatToBottom() {
    const messages = $("chatMessages");
    if (messages) messages.scrollTop = messages.scrollHeight;
}

function setChatStatus(message, isError = false) {
    const status = $("chatStatus");
    if (!status) return;

    status.textContent = message;
    status.classList.toggle("error", isError);
}

function setChatBusy(busy) {
    chatBusy = busy;

    const input = $("chatInput");
    const send = $("chatSend");

    if (input) input.disabled = busy;
    if (send) {
        send.disabled = busy;
        const label = send.querySelector("span:first-child");
        if (label) label.textContent = busy ? "Thinking..." : "Send";
    }

    if (busy) {
        setChatStatus("Your study sidekick is thinking...");
    } else {
        setChatStatus("Ready");
    }
}

function addChatMessage(role, content) {
    const container = $("chatMessages");
    if (!container) return;

    const message = document.createElement("div");
    message.className = `chat-message ${role === "user" ? "user-message" : "assistant-message"}`;

    const label = document.createElement("span");
    label.className = "message-label";
    label.textContent = role === "user" ? "YOU" : "STUDY SIDEKICK";

    const body = document.createElement("p");
    body.className = "chat-message-content";

    // textContent prevents model output from being interpreted as HTML.
    body.textContent = content;

    message.append(label, body);
    container.appendChild(message);

    scrollChatToBottom();
    return message;
}

function showTypingIndicator() {
    const container = $("chatMessages");
    if (!container) return;

    const indicator = document.createElement("div");
    indicator.id = "chatTyping";
    indicator.className = "chat-message assistant-message typing-indicator";
    indicator.textContent = "Thinking...";
    container.appendChild(indicator);

    scrollChatToBottom();
}

function removeTypingIndicator() {
    $("chatTyping")?.remove();
}

async function sendChatMessage(message) {
    const text = String(message || "").trim();

    if (!text || chatBusy) return;

    const input = $("chatInput");

    if (input) input.value = "";

    addChatMessage("user", text);

    const previousHistory = chatHistory.slice(-MAX_CHAT_HISTORY);

    chatHistory.push({
        role: "user",
        content: text
    });

    setChatBusy(true);
    showTypingIndicator();

    try {
        const result = await api("/api/chat", {
            method: "POST",
            body: {
                message: text,
                history: previousHistory
            }
        });

        removeTypingIndicator();

        const reply = String(
            result.reply || result.response || result.message || ""
        ).trim();

        if (!reply) {
            throw new Error("The AI returned an empty response.");
        }

        addChatMessage("assistant", reply);

        chatHistory.push({
            role: "model",
            content: reply
        });

        chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);

        setChatStatus("Ready");
    } catch (error) {
        removeTypingIndicator();

        console.error("AI chat error:", error);

        addChatMessage(
            "assistant",
            `I couldn't get a response. ${error.message || "Check that the Python server and Gemini API are configured correctly."}`
        );

        setChatStatus("Unable to connect to the AI.", true);
    } finally {
        setChatBusy(false);
        if (input) input.focus();
    }
}

$("chatForm")?.addEventListener("submit", event => {
    event.preventDefault();
    sendChatMessage($("chatInput")?.value || "");
});

$("chatInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();

        if (!$("chatForm")?.requestSubmit) {
            sendChatMessage($("chatInput")?.value || "");
        } else {
            $("chatForm").requestSubmit();
        }
    }
});

$("chatSuggestions")?.addEventListener("click", event => {
    const button = event.target.closest(".suggestion-button");
    if (!button || chatBusy) return;

    const prompt = button.dataset.prompt || button.textContent;
    sendChatMessage(prompt);
});

$("clearChat")?.addEventListener("click", () => {
    const messages = $("chatMessages");

    if (messages) {
        messages.replaceChildren();
    }

    chatHistory = [];

    addChatMessage(
        "assistant",
        "Chat cleared. I'm ready to help you study, plan tasks, or explain a tricky concept."
    );

    setChatStatus("Ready");
});

// ==============================
// TIMER BUTTONS
// ==============================

$("startButton")?.addEventListener("click", () => {
    toggleAuraSession();
});

$("resetButton")?.addEventListener("click", resetTimer);

document.querySelectorAll(".mode[data-mode]").forEach(button => {
    button.addEventListener("click", () => {
        setMode(button.dataset.mode);
    });
});

// ==============================
// INITIALIZATION
// ==============================

async function initialize() {
    const linkedSession = readAuraSession();
    updateDisplay();
    updateStatus();

    // Show a welcome message if the chat panel exists.
    if ($("chatMessages") && !$("chatMessages").children.length) {
        addChatMessage(
            "assistant",
            "I'm your study sidekick. Ask me to explain a concept, break a task into smaller steps, quiz you, or help plan your next study session."
        );
    }

    try {
        await refreshData();
    } catch (error) {
        updateConnectionStatus(false);

        showToast(
            "Cannot reach the Python server. Start it with: python server.py",
            true
        );

        console.error("Initialization failed:", error);
    }

    if (linkedSession) {
        const startButton = $("startButton");
        if (startButton) startButton.disabled = true;
        try {
            await refreshAuraState();
        } catch (error) {
            showToast(error.message || "Could not connect to the Aura Cards session.", true);
        }
    }
}

initialize();
