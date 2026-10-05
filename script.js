// Timer durations in seconds
const DURATIONS = {
    focus: 25 * 60,
    shortBreak: 5 * 60,
    longBreak: 15 * 60
};

// Current timer state
let currentMode = "focus";
let timeRemaining = DURATIONS.focus;
let round = 1;
let timer = null;
let running = false;

// HTML elements
const timerDisplay = document.getElementById("timer");
const startButton = document.getElementById("startButton");
const statusDisplay = document.getElementById("status");
const roundDisplay = document.getElementById("roundNumber");

const focusMode = document.getElementById("focusMode");
const shortBreakMode = document.getElementById("shortBreakMode");
const longBreakMode = document.getElementById("longBreakMode");


// Update the timer text
function updateDisplay() {

    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;

    timerDisplay.textContent =
        String(minutes).padStart(2, "0") +
        ":" +
        String(seconds).padStart(2, "0");

    roundDisplay.textContent = round;
}


// Start or pause the timer
function toggleTimer() {

    if (running) {
        pauseTimer();
    } else {
        startTimer();
    }
}


// Start timer
function startTimer() {

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


// Pause timer
function pauseTimer() {

    running = false;
    startButton.textContent = "START";

    clearInterval(timer);
    timer = null;
}


// Finish the current session
function finishSession() {

    clearInterval(timer);
    timer = null;
    running = false;

    if (currentMode === "focus") {

        if (round === 4) {

            // Fourth focus session → long break
            currentMode = "longBreak";
            timeRemaining = DURATIONS.longBreak;

            statusDisplay.textContent = "Four rounds complete. Take a long break.";

        } else {

            // Normal focus session → short break
            currentMode = "shortBreak";
            timeRemaining = DURATIONS.shortBreak;

            statusDisplay.textContent = "Focus session complete. Take a short break.";
        }

    } else if (currentMode === "shortBreak") {

        // Break finished → next focus round
        round++;
        currentMode = "focus";
        timeRemaining = DURATIONS.focus;

        statusDisplay.textContent = "Break over. Time to focus.";

    } else if (currentMode === "longBreak") {

        // Long break finished → start a new cycle
        round = 1;
        currentMode = "focus";
        timeRemaining = DURATIONS.focus;

        statusDisplay.textContent = "Long break over. Start a new cycle.";
    }

    updateModeButtons();
    updateDisplay();

    // Automatically begin the next session
    startTimer();
}


// Change timer mode manually
function setMode(mode) {

    pauseTimer();

    currentMode = mode;

    if (mode === "focus") {
        timeRemaining = DURATIONS.focus;
        statusDisplay.textContent = "Time to focus.";

    } else if (mode === "shortBreak") {
        timeRemaining = DURATIONS.shortBreak;
        statusDisplay.textContent = "Take a short break.";

    } else if (mode === "longBreak") {
        timeRemaining = DURATIONS.longBreak;
        statusDisplay.textContent = "Take a long break.";
    }

    updateModeButtons();
    updateDisplay();
}


// Update which mode button is active
function updateModeButtons() {

    focusMode.classList.remove("active");
    shortBreakMode.classList.remove("active");
    longBreakMode.classList.remove("active");

    if (currentMode === "focus") {
        focusMode.classList.add("active");

    } else if (currentMode === "shortBreak") {
        shortBreakMode.classList.add("active");

    } else if (currentMode === "longBreak") {
        longBreakMode.classList.add("active");
    }
}


// Reset everything
function resetTimer() {

    pauseTimer();

    currentMode = "focus";
    timeRemaining = DURATIONS.focus;
    round = 1;

    statusDisplay.textContent = "Time to focus.";

    updateModeButtons();
    updateDisplay();
}


// Button events
startButton.addEventListener("click", toggleTimer);

focusMode.addEventListener("click", () => {
    setMode("focus");
});

shortBreakMode.addEventListener("click", () => {
    setMode("shortBreak");
});

longBreakMode.addEventListener("click", () => {
    setMode("longBreak");
});


// Add reset with double-click on timer for now
timerDisplay.addEventListener("dblclick", resetTimer);


// Initial display
updateDisplay();

