
"use strict";

/* =========================
   STATE
========================= */

const DEFAULT_SETTINGS = {
    focus: 25,
    shortBreak: 5,
    longBreak: 15,
    autoStartBreaks: false,
    autoStartFocus: false
};

let settings = { ...DEFAULT_SETTINGS };
let currentMode = "focus";
let round = 1;
let remainingSeconds = settings.focus * 60;
let deadline = null;
let timerInterval = null;
let running = false;
let busyFinishing = false;

let subjects = [];
let tasks = [];
let stats = null;
let selectedTaskId = "";
let toastTimeout = null;

const $ = id => document.getElementById(id);

const timerDisplay = $("timer");
const startButton = $("startButton");
const resetButton = $("resetButton");
const statusDisplay = $("status");
const roundDisplay = $("round");
const modeButtons = document.querySelectorAll(".mode");
const panels = document.querySelectorAll(".side-panel");
const toolButtons = document.querySelectorAll(".tool-button");
const backdrop = $("panelBackdrop");


/* =========================
   API
========================= */

async function api(path, options = {}) {
    const config = { ...options, headers: { ...(options.headers || {}) } };

    if (config.body !== undefined) {
        config.headers["Content-Type"] = "application/json";
        config.body = JSON.stringify(config.body);
    }

    const response = await fetch(path, config);
    const contentType = response.headers.get("content-type") || "";

    let result = {};
    if (contentType.includes("application/json")) {
        result = await response.json();
    }

    if (!response.ok || result.success === false) {
        throw new Error(result.error || `Request failed (${response.status})`);
    }

    return result;
}

async function refreshData() {
    const data = await api("/api/data");

    subjects = data.subjects || [];
    tasks = data.tasks || [];
    stats = data.stats;
    settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };

    $("notes").value = data.notes || "";

    applySettingsToForm();
    renderSubjects();
    renderTasks();
    renderTaskOptions();
    updateStats(stats);
    updateConnectionStatus(true);
}

function updateConnectionStatus(connected) {
    const element = $("connectionStatus");
    element.textContent = connected
        ? "Local database connected"
        : "Database connection unavailable";
    element.classList.toggle("offline", !connected);
}

function showToast(message, isError = false) {
    const element = $("toast");
    element.textContent = message;
    element.classList.toggle("error", isError);
    element.classList.add("visible");

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        element.classList.remove("visible");
    }, 2800);
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

function formatTime(minutes) {
    minutes = Number(minutes) || 0;

    if (minutes < 60) return `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;

    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}


/* =========================
   TIMER
========================= */

function durationFor(mode = currentMode) {
    const key = {
        focus: "focus",
        shortBreak: "shortBreak",
        longBreak: "longBreak"
    }[mode];

    return (Number(settings[key]) || DEFAULT_SETTINGS[key]) * 60;
}

function updateDisplay() {
    const seconds = Math.max(0, Math.ceil(remainingSeconds));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;

    timerDisplay.textContent =
        `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;

    roundDisplay.textContent = round;

    modeButtons.forEach(button => {
        const active = button.dataset.mode === currentMode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });

    document.title = `${timerDisplay.textContent} · Pomodoro`;

    startButton.textContent = running ? "PAUSE" : "START";
}

function updateStatus(message) {
    if (message) {
        statusDisplay.textContent = message;
        return;
    }

    const messages = {
        focus: "Time to focus.",
        shortBreak: "Take a short break.",
        longBreak: "Step away and recharge."
    };

    statusDisplay.textContent = messages[currentMode];
}

function stopInterval() {
    if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function syncRemainingFromClock() {
    if (deadline !== null) {
        remainingSeconds = Math.max(0, (deadline - Date.now()) / 1000);
    }
}

function startTimer() {
    if (busyFinishing) return;

    if (running) {
        pauseTimer();
        return;
    }

    if (remainingSeconds <= 0) {
        remainingSeconds = durationFor();
    }

    running = true;
    deadline = Date.now() + remainingSeconds * 1000;

    updateDisplay();
    updateStatus();

    timerInterval = setInterval(() => {
        syncRemainingFromClock();
        updateDisplay();

        if (remainingSeconds <= 0) {
            stopInterval();
            running = false;
            deadline = null;
            finishSession();
        }
    }, 200);
}

function pauseTimer() {
    syncRemainingFromClock();
    running = false;
    deadline = null;
    stopInterval();
    updateDisplay();
    updateStatus("Timer paused. Resume when you're ready.");
}

function resetTimer() {
    running = false;
    deadline = null;
    stopInterval();

    remainingSeconds = durationFor();
    updateDisplay();
    updateStatus();
}

function setMode(mode) {
    if (!Object.hasOwn({ focus: 1, shortBreak: 1, longBreak: 1 }, mode)) {
        return;
    }

    running = false;
    deadline = null;
    stopInterval();

    currentMode = mode;
    remainingSeconds = durationFor();

    updateDisplay();
    updateStatus();
}

async function finishSession() {
    if (busyFinishing) return;

    busyFinishing = true;
    running = false;
    deadline = null;
    stopInterval();
    remainingSeconds = 0;
    updateDisplay();

    try {
        if (currentMode === "focus") {
            const duration = Number(settings.focus);
            const taskId = selectedTaskId || null;

            try {
                await api("/api/session", {
                    method: "POST",
                    body: { duration, task_id: taskId }
                });

                await refreshData();
                showToast("Focus session saved.");
            } catch (error) {
                showToast(
                    `Session could not be saved: ${error.message}`,
                    true
                );
            }

            currentMode = round >= 4 ? "longBreak" : "shortBreak";
            remainingSeconds = durationFor();

            updateDisplay();
            updateStatus("Focus session complete. Take your break.");

        	
	if (settings.autoStartBreaks) {
   		 busyFinishing = false;
    		startTimer();
	}
	} else {
            if (currentMode === "shortBreak") {
                round = round >= 4 ? 1 : round + 1;
            } else {
                round = 1;
            }

            currentMode = "focus";
            remainingSeconds = durationFor();

            updateDisplay();
            updateStatus("Break complete. Ready for another focus session.");

        	if (settings.autoStartFocus) {
    busyFinishing = false;
    startTimer();
}
	}
    } finally {
        busyFinishing = false;
        updateDisplay();
    }
}

startButton.addEventListener("click", startTimer);
resetButton.addEventListener("click", resetTimer);

modeButtons.forEach(button => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
});


/* =========================
   PANELS
========================= */

function openPanel(id) {
    panels.forEach(panel => panel.classList.remove("open"));

    const panel = $(id);
    if (!panel) return;

    panel.classList.add("open");
    backdrop.classList.add("visible");
    document.body.classList.add("panel-open");

    if (id === "statsPanel") {
        refreshData().catch(error => showToast(error.message, true));
    }
}

function closePanels() {
    panels.forEach(panel => panel.classList.remove("open"));
    backdrop.classList.remove("visible");
    document.body.classList.remove("panel-open");
}

toolButtons.forEach(button => {
    button.addEventListener("click", () => {
        const panel = $(button.dataset.panel);
        if (panel?.classList.contains("open")) {
            closePanels();
        } else {
            openPanel(button.dataset.panel);
        }
    });
});

document.querySelectorAll(".close-panel").forEach(button => {
    button.addEventListener("click", closePanels);
});

backdrop.addEventListener("click", closePanels);

document.addEventListener("keydown", event => {
    if (event.key === "Escape") closePanels();
});


/* =========================
   SUBJECTS
========================= */

$("subjectForm").addEventListener("submit", async event => {
    event.preventDefault();

    const input = $("subjectInput");
    const name = input.value.trim();
    if (!name) return;

    try {
        await api("/api/subjects", {
            method: "POST",
            body: { name }
        });

        input.value = "";
        await refreshData();
        showToast("Subject created.");
    } catch (error) {
        showToast(error.message, true);
    }
});

function renderSubjects() {
    const list = $("subjectList");

    if (!subjects.length) {
        list.innerHTML = '<p class="empty-state">No subjects yet. Add one to organise your work.</p>';
    } else {
        list.innerHTML = subjects.map(subject => `
            <div class="subject-item">
                <div class="subject-dot"></div>
                <div class="subject-info">
                    <strong>${escapeText(subject.name)}</strong>
                    <small>${Number(subject.completed_count) || 0} of ${Number(subject.task_count) || 0} tasks done</small>
                </div>
                <button class="icon-action delete-subject"
                        data-id="${subject.id}"
                        title="Delete subject and keep its tasks unassigned"
                        aria-label="Delete ${escapeText(subject.name)}">×</button>
            </div>
        `).join("");
    }

    const subjectOptions = subjects.map(subject =>
        `<option value="${subject.id}">${escapeText(subject.name)}</option>`
    ).join("");

    $("taskSubject").innerHTML =
        '<option value="">Unassigned</option>' + subjectOptions;

    $("subjectFilter").innerHTML =
        '<option value="all">All subjects</option>' + subjectOptions;
}

$("subjectList").addEventListener("click", async event => {
    const button = event.target.closest(".delete-subject");
    if (!button) return;

    const subject = subjects.find(item => item.id === Number(button.dataset.id));
    if (!subject) return;

    if (!confirm(
        `Delete subject "${subject.name}"? Its tasks will remain, but become unassigned. Past study records will be preserved.`
    )) return;

    try {
        await api(`/api/subjects/${subject.id}`, { method: "DELETE" });
        await refreshData();
        showToast("Subject deleted.");
    } catch (error) {
        showToast(error.message, true);
    }
});


/* =========================
   TASKS
========================= */

$("taskForm").addEventListener("submit", async event => {
    event.preventDefault();

    const title = $("taskInput").value.trim();
    if (!title) return;

    try {
        await api("/api/tasks", {
            method: "POST",
            body: {
                title,
                subject_id: $("taskSubject").value || null,
                due_date: $("taskDueDate").value || null
            }
        });

        $("taskInput").value = "";
        $("taskDueDate").value = "";

        await refreshData();
        showToast("Task added.");
    } catch (error) {
        showToast(error.message, true);
    }
});

function renderTaskOptions() {
    const select = $("sessionTask");
    const previous = selectedTaskId;

    select.innerHTML = '<option value="">No task selected</option>' +
        tasks.filter(task => !task.completed).map(task => `
            <option value="${task.id}">
                ${escapeText(task.title)}${task.subject_name
                    ? " · " + escapeText(task.subject_name)
                    : ""}
            </option>
        `).join("");

    if (previous && tasks.some(task =>
        String(task.id) === String(previous) && !task.completed
    )) {
        select.value = String(previous);
    } else {
        selectedTaskId = "";
        select.value = "";
    }
}

$("sessionTask").addEventListener("change", event => {
    selectedTaskId = event.target.value;
});

function renderTasks() {
    const list = $("taskList");
    const taskFilter = $("taskFilter").value;
    const subjectFilter = $("subjectFilter").value;

    const completedCount = tasks.filter(task => task.completed).length;
    $("taskProgress").textContent = `${completedCount} / ${tasks.length} done`;

    let visibleTasks = tasks.filter(task => {
        if (taskFilter === "active" && task.completed) return false;
        if (taskFilter === "completed" && !task.completed) return false;

        if (subjectFilter !== "all" &&
            String(task.subject_id || "") !== subjectFilter) return false;

        return true;
    });

    if (!visibleTasks.length) {
        list.innerHTML = '<p class="empty-state">Nothing here yet. Add a task above.</p>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    list.innerHTML = visibleTasks.map(task => {
        let dueLabel = "";

        if (task.due_date) {
            const due = new Date(`${task.due_date}T00:00:00`);
            const overdue = !task.completed && due < today;
            dueLabel = `<small class="due-date ${overdue ? "overdue" : ""}">
                ${overdue ? "Overdue · " : "Due "}
                ${escapeText(due.toLocaleDateString(undefined, {
                    month: "short", day: "numeric"
                }))}
            </small>`;
        }

        return `
            <article class="task-item ${task.completed ? "completed" : ""}">
                <input type="checkbox" class="task-check"
                       data-id="${task.id}"
                       aria-label="Mark ${escapeText(task.title)} complete"
                       ${task.completed ? "checked" : ""}>
                <div class="task-info">
                    <span class="task-title">${escapeText(task.title)}</span>
                    <small class="task-subject">${escapeText(task.subject_name || "Unassigned")}</small>
                    ${dueLabel}
                </div>
                <button class="icon-action delete-task" data-id="${task.id}"
                        aria-label="Delete ${escapeText(task.title)}">×</button>
            </article>
        `;
    }).join("");
}

$("taskFilter").addEventListener("change", renderTasks);
$("subjectFilter").addEventListener("change", renderTasks);

$("taskList").addEventListener("change", async event => {
    const checkbox = event.target.closest(".task-check");
    if (!checkbox) return;

    try {
        await api(`/api/tasks/${checkbox.dataset.id}`, {
            method: "PATCH",
            body: { completed: checkbox.checked }
        });

        await refreshData();
        showToast(checkbox.checked ? "Task completed." : "Task reopened.");
    } catch (error) {
        showToast(error.message, true);
        await refreshData();
    }
});

$("taskList").addEventListener("click", async event => {
    const button = event.target.closest(".delete-task");
    if (!button) return;

    const task = tasks.find(item => item.id === Number(button.dataset.id));
    if (!task || !confirm(`Delete "${task.title}"?`)) return;

    try {
        await api(`/api/tasks/${task.id}`, { method: "DELETE" });

        if (String(selectedTaskId) === String(task.id)) {
            selectedTaskId = "";
        }

        await refreshData();
        showToast("Task deleted.");
    } catch (error) {
        showToast(error.message, true);
    }
});


/* =========================
   NOTES
========================= */

$("saveNotes").addEventListener("click", async () => {
    try {
        await api("/api/notes", {
            method: "POST",
            body: { notes: $("notes").value }
        });

        $("notesSaved").textContent = "Saved to the local database.";
        showToast("Notes saved.");
    } catch (error) {
        $("notesSaved").textContent = "";
        showToast(error.message, true);
    }
});


/* =========================
   SETTINGS
========================= */

function applySettingsToForm() {
    $("focusLength").value = String(settings.focus);
    $("breakLength").value = String(settings.shortBreak);
    $("longBreakLength").value = String(settings.longBreak);
    $("autoStartBreaks").checked = Boolean(settings.autoStartBreaks);
    $("autoStartFocus").checked = Boolean(settings.autoStartFocus);
}

$("settingsForm").addEventListener("submit", async event => {
    event.preventDefault();

    const newSettings = {
        focus: Number($("focusLength").value),
        shortBreak: Number($("breakLength").value),
        longBreak: Number($("longBreakLength").value),
        autoStartBreaks: $("autoStartBreaks").checked,
        autoStartFocus: $("autoStartFocus").checked
    };

    try {
        const result = await api("/api/settings", {
            method: "POST",
            body: { settings: newSettings }
        });

        settings = { ...DEFAULT_SETTINGS, ...result.settings };

        if (!running) {
            remainingSeconds = durationFor();
            updateDisplay();
        }

        $("settingsSaved").textContent = "Settings saved.";
        showToast("Settings saved.");
    } catch (error) {
        showToast(error.message, true);
    }
});


/* =========================
   ANALYTICS
========================= */

function updateStats(data) {
    if (!data) return;

    $("todayTime").textContent = formatTime(data.today.minutes);
    $("todaySessions").textContent = data.today.sessions;
    $("weekTime").textContent = formatTime(data.week.minutes);
    $("allTime").textContent = formatTime(data.all_time.minutes);
    $("allSessions").textContent = data.all_time.sessions;
    $("streakCount").textContent = data.streak;
    $("streakLabel").textContent =
        data.streak === 1 ? "consecutive study day" : "consecutive study days";

    updateWeeklyChart(data.week.days);
    updateSubjectAnalytics(data.subjects);
    updateTaskProgress(data.tasks);
}

function updateWeeklyChart(days) {
    const chart = $("weeklyChart");
    chart.innerHTML = "";

    const maximum = Math.max(1, ...days.map(day => day.minutes));

    days.forEach(day => {
        const column = document.createElement("div");
        column.className = "chart-day";

        const value = document.createElement("span");
        value.className = "chart-value";
        value.textContent = day.minutes ? formatTime(day.minutes) : "";

        const barArea = document.createElement("div");
        barArea.className = "chart-bar-area";

        const bar = document.createElement("div");
        bar.className = "chart-bar";
        bar.style.height = day.minutes
            ? `${Math.max(5, (day.minutes / maximum) * 100)}%`
            : "3px";
        bar.title = `${day.date}: ${day.minutes} minutes`;

        const label = document.createElement("span");
        label.className = "chart-label";
        label.textContent = day.label;

        barArea.appendChild(bar);
        column.append(value, barArea, label);
        chart.appendChild(column);
    });
}

function updateSubjectAnalytics(items) {
    const container = $("subjectAnalytics");
    container.innerHTML = "";

    if (!items.length) {
        container.innerHTML =
            '<p class="empty-state">Complete a focus session linked to a subject to see your breakdown.</p>';
        return;
    }

    const max = Math.max(1, ...items.map(item => item.minutes));

    items.forEach(item => {
        const row = document.createElement("div");
        row.className = "subject-stat";

        const heading = document.createElement("div");
        heading.className = "subject-stat-heading";

        const name = document.createElement("span");
        name.textContent = item.name;

        const time = document.createElement("strong");
        time.textContent = formatTime(item.minutes);

        heading.append(name, time);

        const track = document.createElement("div");
        track.className = "progress-track";

        const fill = document.createElement("div");
        fill.style.width = `${(item.minutes / max) * 100}%`;

        track.appendChild(fill);
        row.append(heading, track);
        container.appendChild(row);
    });
}

function updateTaskProgress(data) {
    const total = data.total || 0;
    const completed = data.completed || 0;
    const percent = total ? (completed / total) * 100 : 0;

    $("taskProgressBar").style.width = `${percent}%`;
    $("taskProgressText").textContent = total
        ? `${completed} completed · ${data.remaining} remaining · ${Math.round(percent)}% complete`
        : "No tasks yet. Add a few tasks to track your progress.";
}

$("refreshStats").addEventListener("click", async () => {
    try {
        await refreshData();
        showToast("Statistics refreshed.");
    } catch (error) {
        showToast(error.message, true);
    }
});


/* =========================
   INITIALIZATION
========================= */

async function initialize() {
    updateDisplay();
    updateStatus();

    try {
        await refreshData();
    } catch (error) {
        updateConnectionStatus(false);
        showToast(
            "Cannot reach the Python server. Start it with: python server.py",
            true
        );
        console.error(error);
    }
}

initialize();

