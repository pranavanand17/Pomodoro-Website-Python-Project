const DURATIONS = {
    focus: 25 * 60,
    shortBreak: 5 * 60,
    longBreak: 15 * 60
};

let currentMode = "focus";
let timeRemaining = DURATIONS.focus;

let round = 1;

let timer = null;
let running = false;


/* =========================
   TIMER
========================= */

const timerDisplay = document.getElementById("timer");
const startButton = document.getElementById("startButton");
const resetButton = document.getElementById("resetButton");
const statusDisplay = document.getElementById("status");
const roundDisplay = document.getElementById("round");

const modeButtons = document.querySelectorAll(".mode");


function updateDisplay() {

    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;

    timerDisplay.textContent =
        `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    roundDisplay.textContent = round;

    modeButtons.forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.mode === currentMode
        );
    });
}


function updateStatus() {

    if (currentMode === "focus") {
        statusDisplay.textContent = "Time to focus.";
    }

    else if (currentMode === "shortBreak") {
        statusDisplay.textContent = "Take a short break.";
    }

    else {
        statusDisplay.textContent = "Take a long break.";
    }
}


function startTimer() {

    if (running) {
        pauseTimer();
        return;
    }

    running = true;

    startButton.textContent = "PAUSE";

    timer = setInterval(() => {

        timeRemaining--;

        updateDisplay();

        if (timeRemaining <= 0) {
            finishSession();
        }

    }, 1000);
}


function pauseTimer() {

    running = false;

    clearInterval(timer);

    timer = null;

    startButton.textContent = "START";
}


function resetTimer() {

    pauseTimer();

    timeRemaining = DURATIONS[currentMode];

    updateDisplay();
}


function setMode(mode) {

    pauseTimer();

    currentMode = mode;

    timeRemaining = DURATIONS[mode];

    updateStatus();
    updateDisplay();
}


async function finishSession() {

    pauseTimer();

    /*
        Only completed focus sessions
        count toward statistics.
    */

    if (currentMode === "focus") {

        await saveCompletedSession(DURATIONS.focus / 60);

        if (round >= 4) {
            currentMode = "longBreak";
        } else {
            currentMode = "shortBreak";
        }

    } else if (currentMode === "shortBreak") {

        round++;

        currentMode = "focus";

    } else {

        round = 1;

        currentMode = "focus";
    }

    timeRemaining = DURATIONS[currentMode];

    updateStatus();
    updateDisplay();

    /*
        Automatically start the next session.
    */

    startTimer();
}


startButton.addEventListener("click", startTimer);

resetButton.addEventListener("click", resetTimer);


modeButtons.forEach(button => {

    button.addEventListener("click", () => {

        setMode(button.dataset.mode);

    });

});


/* =========================
   BACKEND / STATISTICS
========================= */

async function saveCompletedSession(duration) {

    try {

        const response = await fetch("/api/session", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                duration: duration
            })

        });

        const data = await response.json();

        if (!data.success) {
            console.error("Failed to save session:", data.error);
        }

    } catch (error) {

        console.error("Could not connect to backend:", error);

    }
}


async function loadStats() {

    try {

        const response = await fetch("/api/stats");

        const data = await response.json();

        updateStats(data);

    } catch (error) {

        console.error("Could not load statistics:", error);

    }
}


function formatTime(minutes) {

    if (minutes < 60) {
        return `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (mins === 0) {
        return `${hours}h`;
    }

    return `${hours}h ${mins}m`;
}


function updateStats(data) {

    document.getElementById("todayTime").textContent =
        formatTime(data.today.minutes);

    document.getElementById("todaySessions").textContent =
        data.today.sessions;

    document.getElementById("allTime").textContent =
        formatTime(data.all_time.minutes);

    document.getElementById("allSessions").textContent =
        data.all_time.sessions;

    updateWeeklyChart(data.sessions);
}


function updateWeeklyChart(sessions) {

    const chart = document.getElementById("weeklyChart");

    chart.innerHTML = "";

    const today = new Date();

    const days = [];

    /*
        Create the last 7 days.
    */

    for (let i = 6; i >= 0; i--) {

        const date = new Date(today);

        date.setDate(today.getDate() - i);

        const dateString =
            date.toISOString().split("T")[0];

        days.push({
            date: dateString,
            name: date.toLocaleDateString(
                undefined,
                { weekday: "short" }
            ),
            minutes: 0
        });

    }


    /*
        Add session minutes to each day.
    */

    sessions.forEach(session => {

        const day = days.find(
            day => day.date === session.date
        );

        if (day) {
            day.minutes += session.duration;
        }

    });


    const maxMinutes = Math.max(
        ...days.map(day => day.minutes),
        25
    );


    let weekTotal = 0;


    days.forEach(day => {

        weekTotal += day.minutes;

        const dayElement = document.createElement("div");

        dayElement.className = "day";

        const barContainer =
            document.createElement("div");

        barContainer.className = "bar-container";

        const bar =
            document.createElement("div");

        bar.className = "bar";

        const height =
            (day.minutes / maxMinutes) * 130;

        bar.style.height =
            `${Math.max(height, 3)}px`;

        bar.title =
            `${day.minutes} minutes`;

        barContainer.appendChild(bar);


        const value =
            document.createElement("span");

        value.className = "day-value";

        value.textContent =
            day.minutes > 0
                ? formatTime(day.minutes)
                : "";


        const label =
            document.createElement("span");

        label.className = "day-label";

        label.textContent = day.name;


        dayElement.appendChild(value);
        dayElement.appendChild(barContainer);
        dayElement.appendChild(label);

        chart.appendChild(dayElement);

    });


    document.getElementById("weekTime").textContent =
        formatTime(weekTotal);
}


/* =========================
   PANELS
========================= */

const toolButtons =
    document.querySelectorAll(".tool-button");

const panels =
    document.querySelectorAll(".side-panel");

const closeButtons =
    document.querySelectorAll(".close-panel");


toolButtons.forEach(button => {

    button.addEventListener("click", () => {

        const panelId =
            button.dataset.panel;

        const panel =
            document.getElementById(panelId);

        panels.forEach(p => {
            p.classList.remove("open");
        });

        panel.classList.add("open");

        /*
            Refresh stats whenever the panel opens.
        */

        if (panelId === "statsPanel") {
            loadStats();
        }

    });

});


closeButtons.forEach(button => {

    button.addEventListener("click", () => {

        button
            .closest(".side-panel")
            .classList.remove("open");

    });

});


/* =========================
   NOTES
========================= */

const notes =
    document.getElementById("notes");

const savedNotes =
    localStorage.getItem("pomodoroNotes");

if (savedNotes) {
    notes.value = savedNotes;
}


document
    .getElementById("saveNotes")
    .addEventListener("click", () => {

        localStorage.setItem(
            "pomodoroNotes",
            notes.value
        );

        document.getElementById(
            "notesSaved"
        ).textContent = "Notes saved.";

        setTimeout(() => {

            document.getElementById(
                "notesSaved"
            ).textContent = "";

        }, 2000);

    });


/* =========================
   TASKS
========================= */

const taskInput =
    document.getElementById("taskInput");

const taskList =
    document.getElementById("taskList");

let tasks =
    JSON.parse(
        localStorage.getItem("pomodoroTasks") || "[]"
    );


function saveTasks() {

    localStorage.setItem(
        "pomodoroTasks",
        JSON.stringify(tasks)
    );

}


function renderTasks() {

    taskList.innerHTML = "";

    tasks.forEach((task, index) => {

        const li =
            document.createElement("li");

        li.className =
            "task";

        if (task.completed) {
            li.classList.add("completed");
        }


        const checkbox =
            document.createElement("input");

        checkbox.type = "checkbox";

        checkbox.checked =
            task.completed;


        checkbox.addEventListener(
            "change",
            () => {

                tasks[index].completed =
                    checkbox.checked;

                saveTasks();
                renderTasks();

            }
        );


        const text =
            document.createElement("span");

        text.textContent =
            task.text;


        const deleteButton =
            document.createElement("button");

        deleteButton.className =
            "delete-task";

        deleteButton.textContent =
            "×";


        deleteButton.addEventListener(
            "click",
            () => {

                tasks.splice(index, 1);

                saveTasks();
                renderTasks();

            }
        );


        li.appendChild(checkbox);
        li.appendChild(text);
        li.appendChild(deleteButton);

        taskList.appendChild(li);

    });

}


function addTask() {

    const text =
        taskInput.value.trim();

    if (!text) {
        return;
    }

    tasks.push({
        text: text,
        completed: false
    });

    taskInput.value = "";

    saveTasks();
    renderTasks();

}


document
    .getElementById("addTask")
    .addEventListener("click", addTask);


taskInput.addEventListener(
    "keydown",
    event => {

        if (event.key === "Enter") {
            addTask();
        }

    }
);


/* =========================
   SETTINGS
========================= */

document
    .getElementById("focusLength")
    .addEventListener("change", event => {

        DURATIONS.focus =
            Number(event.target.value) * 60;

        if (currentMode === "focus") {
            resetTimer();
        }

    });


document
    .getElementById("breakLength")
    .addEventListener("change", event => {

        DURATIONS.shortBreak =
            Number(event.target.value) * 60;

        if (currentMode === "shortBreak") {
            resetTimer();
        }

    });


document
    .getElementById("longBreakLength")
    .addEventListener("change", event => {

        DURATIONS.longBreak =
            Number(event.target.value) * 60;

        if (currentMode === "longBreak") {
            resetTimer();
        }

    });


/* =========================
   INITIALIZE
========================= */

updateDisplay();
updateStatus();
renderTasks();
loadStats();
