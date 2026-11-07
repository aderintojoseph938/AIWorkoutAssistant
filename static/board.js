// Scoreboard for the second monitor. Asks for the scores every few seconds,
// so a new high score shows up on its own and nobody has to touch this page.
const REFRESH_MS = 3000;
const MOVES = ["Arm Raises", "Curls", "Squats", "Pushups"];

function moveColumn(move, scores) {
    const column = document.createElement("section");
    column.className = "board-move";

    const title = document.createElement("h2");
    title.textContent = move;
    column.appendChild(title);

    if (scores.length === 0) {
        const empty = document.createElement("p");
        empty.className = "board-empty";
        empty.textContent = "Be the first";
        column.appendChild(empty);
        return column;
    }

    const list = document.createElement("ol");
    scores.forEach((entry, index) => {
        const row = document.createElement("li");
        for (const [className, text] of [
            ["board-rank", index + 1],
            ["board-name", entry.name],
            ["board-score", entry.score],
        ]) {
            const cell = document.createElement("span");
            cell.className = className;
            cell.textContent = text;
            row.appendChild(cell);
        }
        list.appendChild(row);
    });
    column.appendChild(list);
    return column;
}

function showBoard(data) {
    const board = document.getElementById("board");
    board.replaceChildren(...MOVES.map((move) => moveColumn(move, data.scores[move] || [])));
}

// If a refresh fails the last scores stay on screen and the next try fixes it
function refresh() {
    fetch("/scores")
        .then((response) => response.json())
        .then(showBoard)
        .catch((error) => console.error("Error:", error));
}

refresh();
setInterval(refresh, REFRESH_MS);
