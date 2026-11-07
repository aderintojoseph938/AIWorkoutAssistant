// The 20 second challenge. A guest picks a move, gets a 3-2-1 countdown, then scores
// every rep of that move. Only the picked move scores, so the model's guess does not matter.
// The rep counting itself lives in script.js.
const COUNTDOWN_SECONDS = 3;
const CHALLENGE_SECONDS = 20;
const BOARD_SIZE = 5;

// Easiest first. Attendees are dressed up, so nothing here needs weights or the floor.
// "exercise" is the name of the rep rule in script.js.
const CHALLENGE_MOVES = [
    { name: "Arm Raises", exercise: "Lateral Raises", hint: "Arms at your sides. Lift them straight out to shoulder height, then back down." },
    { name: "Curls", exercise: "Bicep Curls", hint: "Elbows by your sides. Hands up to your shoulders, then all the way down." },
    { name: "Squats", exercise: "Squats", hint: "Sit back like there is a chair behind you, then stand all the way up." },
];

let highScores = {};
let challengeMove = null;
let challengeClock = null;
let challengeEnd = 0;
let finalScore = 0;

// Show one screen of the challenge: "pick", "play" or "result"
function showChallengeScreen(name) {
    document.getElementById("challenge-pick").hidden = name !== "pick";
    document.getElementById("challenge-play").hidden = name !== "play";
    document.getElementById("challenge-result").hidden = name !== "result";
    document.body.classList.toggle("in-challenge", name !== "pick");
}

// Swap the right side of the page between the chat and the challenge
function showChat(show) {
    document.getElementById("chat-panel").hidden = !show;
    document.getElementById("challenge-panel").hidden = show;
}

// Draw the top scores for one move into a list. textContent keeps names as plain text.
function drawBoard(list, moveName, newPlace) {
    list.innerHTML = "";
    (highScores[moveName] || []).forEach((row, place) => {
        const item = document.createElement("li");
        item.classList.toggle("is-new", place === newPlace);
        const line = document.createElement("div");
        line.className = "board-row";
        const name = document.createElement("span");
        name.className = "board-name";
        name.textContent = row.name;
        const score = document.createElement("span");
        score.className = "board-score";
        score.textContent = row.score;
        line.append(name, score);
        item.appendChild(line);
        list.appendChild(item);
    });
}

// Build the pick screen: a big button and a top five for each move
function drawMoves() {
    const moveList = document.getElementById("move-list");
    moveList.innerHTML = "";
    for (const move of CHALLENGE_MOVES) {
        const row = document.createElement("div");
        row.className = "move-row";

        const button = document.createElement("button");
        button.className = "move-button";
        button.disabled = !document.getElementById("camera").classList.contains("is-live");
        button.addEventListener("click", () => startChallenge(move));
        const name = document.createElement("span");
        name.className = "move-name";
        name.textContent = move.name;
        const hint = document.createElement("span");
        hint.className = "move-hint";
        hint.textContent = move.hint;
        button.append(name, hint);

        const board = document.createElement("ol");
        board.className = "board";
        drawBoard(board, move.name, null);
        row.append(button, board);
        if (!(highScores[move.name] || []).length) {
            const empty = document.createElement("p");
            empty.className = "board-empty";
            empty.textContent = "No scores yet. Be the first.";
            row.replaceChild(empty, board);
        }
        moveList.appendChild(row);
    }
}

function loadScores() {
    fetch("/scores")
        .then((response) => response.json())
        .then((data) => {
            highScores = data.scores;
            drawMoves();
        })
        .catch((error) => console.error("Error:", error));
}

// Called by script.js once the camera is running
function cameraReady() {
    document.getElementById("challenge-status").textContent = "Pick a move. You get 20 seconds.";
    drawMoves();
}

function startChallenge(move) {
    challengeMove = move;
    clearReps();
    showChat(false);
    showChallengeScreen("play");
    document.getElementById("play-move").textContent = move.name;
    document.getElementById("play-big").textContent = COUNTDOWN_SECONDS;
    document.getElementById("play-timer").textContent = "Get ready";
    document.getElementById("play-hint").textContent = "Stand in the middle, back far enough that the camera sees your whole body.";

    let left = COUNTDOWN_SECONDS;
    challengeClock = setInterval(() => {
        left--;
        if (left > 0) {
            document.getElementById("play-big").textContent = left;
        } else {
            clearInterval(challengeClock);
            startRun();
        }
    }, 1000);
}

function startRun() {
    // Anything the guest did during the countdown does not score
    clearReps();
    challengeEnd = Date.now() + CHALLENGE_SECONDS * 1000;
    document.getElementById("play-hint").textContent = challengeMove.hint;
    showRun();
    challengeClock = setInterval(showRun, 100);
}

// Update the big count and the clock, and stop when time is up
function showRun() {
    const secondsLeft = Math.max(0, Math.ceil((challengeEnd - Date.now()) / 1000));
    document.getElementById("play-big").textContent = repCounts[challengeMove.exercise] || 0;
    document.getElementById("play-timer").textContent = secondsLeft + "s";
    if (secondsLeft === 0) {
        clearInterval(challengeClock);
        finishChallenge();
    }
}

// True when this score would make the top five
function madeTheBoard(score, moveName) {
    const rows = highScores[moveName] || [];
    return score > 0 && (rows.length < BOARD_SIZE || score > rows[rows.length - 1].score);
}

function finishChallenge() {
    finalScore = repCounts[challengeMove.exercise] || 0;
    const onBoard = madeTheBoard(finalScore, challengeMove.name);
    document.getElementById("result-move").textContent = challengeMove.name;
    document.getElementById("result-score").textContent = finalScore;
    document.getElementById("result-message").textContent = onBoard ? "You made the board! Add your name."
        : finalScore > 0 ? "Nice work. Not quite the top five."
        : "No reps counted. Stand back so the camera sees your whole body, then try again.";
    document.getElementById("result-form").hidden = !onBoard;
    document.getElementById("result-save").disabled = false;
    document.getElementById("result-name").value = "";
    drawBoard(document.getElementById("result-board"), challengeMove.name, null);
    showChallengeScreen("result");
    if (onBoard) document.getElementById("result-name").focus();
}

function saveScore() {
    const saveButton = document.getElementById("result-save");
    if (saveButton.disabled) return;
    saveButton.disabled = true;

    fetch("/scores", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            move: challengeMove.name,
            name: document.getElementById("result-name").value,
            score: finalScore,
        }),
    })
    .then((response) => response.json())
    .then((data) => {
        if (data.error) throw new Error(data.error);
        highScores = data.scores;
        document.getElementById("result-form").hidden = true;
        document.getElementById("result-message").textContent = "You're on the board!";
        drawBoard(document.getElementById("result-board"), challengeMove.name, data.place);
    })
    .catch((error) => {
        console.error("Error:", error);
        saveButton.disabled = false;
        document.getElementById("result-message").textContent = "Could not save that. Try again.";
    });
}

// Stop any run in progress and go back to the pick screen. The board stays.
function resetChallenge() {
    clearInterval(challengeClock);
    challengeMove = null;
    finalScore = 0;
    showChat(false);
    showChallengeScreen("pick");
    loadScores();
}

document.getElementById("result-name").addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        saveScore();
    }
});

loadScores();
