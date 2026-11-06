// Teachable Machine model, saved in this repo so the demo works without internet
const URL = "/static/model/";
const CAMERA_SIZE = 400;
const MIN_CONFIDENCE = 0.5;

// How sure PoseNet has to be about a body point before we trust it,
// and how many body points we need to say someone is actually in frame
const MIN_KEYPOINT_SCORE = 0.5;
const MIN_BODY_POINTS = 5;
const BODY_PARTS = ["leftShoulder", "rightShoulder", "leftElbow", "rightElbow", "leftWrist", "rightWrist",
    "leftHip", "rightHip", "leftKnee", "rightKnee", "leftAnkle", "rightAnkle"];

// The exercise only changes when it wins most of the last few frames, so the label does not flicker
const RECENT_FRAMES = 10;
const STEADY_FRAMES = 6;

// For each exercise: the three points that make the joint angle we watch,
// the angle when the body is at rest, and the angle at the working end of the move.
// One rep = the angle reaches the working angle and then comes back to the rest angle.
const REP_RULES = {
    "Bicep Curls":    { joints: ["Shoulder", "Elbow", "Wrist"], rest: 150, work: 70 },
    "Squats":         { joints: ["Hip", "Knee", "Ankle"],       rest: 160, work: 110 },
    "Pushups":        { joints: ["Shoulder", "Elbow", "Wrist"], rest: 155, work: 100 },
    "Dead Lift":      { joints: ["Shoulder", "Hip", "Knee"],    rest: 160, work: 110 },
    "Lateral Raises": { joints: ["Hip", "Shoulder", "Elbow"],   rest: 30,  work: 75 },
    "Leg raises":     { joints: ["Shoulder", "Hip", "Knee"],    rest: 160, work: 100 },
    "Pull Up":        { joints: ["Shoulder", "Elbow", "Wrist"], rest: 150, work: 70 },
};

let model, webcam, ctx, labelContainer, maxPredictions;
let currentExercise = "";
let recentLabels = [];
let repCounts = {};
let repState = { inRep: false };

// PoseNet normally downloads its weights from Google. Hand it the copy in this repo instead.
const POSENET_REMOTE = "https://storage.googleapis.com/tfjs-models/savedmodel/posenet/mobilenet/float/075/";
const POSENET_LOCAL = "/static/vendor/posenet/";
const realFetch = window.fetch;
window.fetch = function (url, options) {
    if (typeof url === "string" && url.startsWith(POSENET_REMOTE)) {
        url = POSENET_LOCAL + url.slice(POSENET_REMOTE.length);
    }
    return realFetch(url, options);
};

// Initialize webcam and model
async function init() {
    const startButton = document.getElementById("start-button");
    const cameraStatus = document.getElementById("camera-status");
    startButton.disabled = true;

    if (typeof tmPose === "undefined") {
        cameraStatus.textContent = "The pose model files did not load. Refresh the page and try again.";
        startButton.disabled = false;
        return;
    }

    try {
        cameraStatus.textContent = "Loading the model...";
        model = await tmPose.load(URL + "model.json", URL + "metadata.json");
        maxPredictions = model.getTotalClasses();

        // Setup webcam
        cameraStatus.textContent = "Starting the camera... click Allow if the browser asks.";
        const flip = true;
        webcam = new tmPose.Webcam(CAMERA_SIZE, CAMERA_SIZE, flip);
        await webcam.setup();
        await webcam.play();
    } catch (error) {
        console.error("Error:", error);
        cameraStatus.textContent = "Could not start the camera. Check that this page can use your webcam, then try again.";
        startButton.disabled = false;
        return;
    }

    document.getElementById("webcam-container").appendChild(webcam.canvas);
    ctx = document.getElementById("my-canvas").getContext("2d");
    document.getElementById("camera").classList.add("is-live");
    showExercise("");

    // Setup label container
    labelContainer = document.getElementById("label-container");
    for (const className of model.getClassLabels()) {
        const row = document.createElement("div");
        row.className = "label-row";
        row.innerHTML = '<span class="label-name"></span><div class="label-track"><div class="label-fill"></div></div><span class="label-value">0%</span>';
        row.querySelector(".label-name").textContent = className;
        labelContainer.appendChild(row);
    }

    window.requestAnimationFrame(loop);
}

// Main prediction loop
async function loop() {
    webcam.update();
    await predict();
    window.requestAnimationFrame(loop);
}

// Predict function
async function predict() {
    const { pose, posenetOutput } = await model.estimatePose(webcam.canvas);
    drawPose(pose);

    // Nobody in frame: the model would still guess an exercise, so stop here
    if (!personInFrame(pose)) {
        recentLabels = [];
        showExercise("No one in frame");
        for (const row of labelContainer.children) {
            row.classList.remove("is-current");
        }
        return;
    }

    const prediction = await model.predict(posenetOutput);

    let top = null;
    for (let i = 0; i < maxPredictions; i++) {
        const percent = Math.round(prediction[i].probability * 100) + "%";
        const row = labelContainer.children[i];
        row.querySelector(".label-fill").style.width = percent;
        row.querySelector(".label-value").textContent = percent;
        if (prediction[i].probability > MIN_CONFIDENCE) {
            top = prediction[i];
        }
        row.classList.toggle("is-current", prediction[i].probability > MIN_CONFIDENCE);
    }

    // Remember the last few winners and only switch when one of them is steady
    recentLabels.push(top ? top.className : "");
    if (recentLabels.length > RECENT_FRAMES) recentLabels.shift();
    const steady = steadyLabel(recentLabels);
    if (steady && steady !== currentExercise) {
        repState = { inRep: false };
    }
    showExercise(steady);

    if (currentExercise) {
        countReps(pose, currentExercise);
    }
}

// Count how many body points PoseNet is confident about
function personInFrame(pose) {
    if (!pose) return false;
    let confident = 0;
    for (const point of pose.keypoints) {
        if (BODY_PARTS.includes(point.part) && point.score >= MIN_KEYPOINT_SCORE) {
            confident++;
        }
    }
    return confident >= MIN_BODY_POINTS;
}

// The label that appears in enough of the recent frames, or "" if none does
function steadyLabel(labels) {
    const counts = {};
    for (const label of labels) {
        if (label) counts[label] = (counts[label] || 0) + 1;
    }
    for (const label in counts) {
        if (counts[label] >= STEADY_FRAMES) return label;
    }
    return "";
}

// Update the big exercise label, the rep count and the tip button
function showExercise(name) {
    const isExercise = Boolean(name) && name !== "No one in frame";
    currentExercise = isExercise ? name : "";

    const label = document.getElementById("current-exercise");
    label.textContent = name || "Watching...";
    label.classList.toggle("is-waiting", !isExercise);

    document.getElementById("rep-count").textContent = repCounts[currentExercise] || 0;
    document.getElementById("reps").classList.toggle("is-hidden", !REP_RULES[currentExercise]);

    const tipButton = document.getElementById("tip-button");
    tipButton.disabled = !isExercise;
    tipButton.textContent = isExercise ? "Ask for a tip on " + name : "Ask for a form tip";
}

// Angle in degrees at point b, between the lines b-a and b-c
function jointAngle(a, b, c) {
    const ab = Math.atan2(a.y - b.y, a.x - b.x);
    const cb = Math.atan2(c.y - b.y, c.x - b.x);
    let angle = Math.abs((ab - cb) * 180 / Math.PI);
    if (angle > 180) angle = 360 - angle;
    return angle;
}

// Pick the side of the body (left or right) that the camera sees best, and return its three points
function bestSidePoints(pose, joints) {
    let best = null;
    for (const side of ["left", "right"]) {
        const points = joints.map((joint) => pose.keypoints.find((k) => k.part === side + joint));
        if (points.some((p) => !p || p.score < MIN_KEYPOINT_SCORE)) continue;
        const score = points.reduce((sum, p) => sum + p.score, 0);
        if (!best || score > best.score) best = { score, points };
    }
    return best ? best.points.map((p) => p.position) : null;
}

// Count a rep when the joint angle reaches the working angle and then returns to the rest angle
function countRep(angle, rule, state) {
    const closing = rule.work < rule.rest;
    const atWork = closing ? angle <= rule.work : angle >= rule.work;
    const atRest = closing ? angle >= rule.rest : angle <= rule.rest;
    if (atWork) state.inRep = true;
    if (atRest && state.inRep) {
        state.inRep = false;
        return true;
    }
    return false;
}

function countReps(pose, exercise) {
    const rule = REP_RULES[exercise];
    if (!rule) return;
    const points = bestSidePoints(pose, rule.joints);
    if (!points) return;
    const angle = jointAngle(points[0], points[1], points[2]);
    if (countRep(angle, rule, repState)) {
        repCounts[exercise] = (repCounts[exercise] || 0) + 1;
        document.getElementById("rep-count").textContent = repCounts[exercise];
    }
}

function drawPose(pose) {
    if (ctx && webcam.canvas) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.drawImage(webcam.canvas, 0, 0);
        // draw the keypoints and skeleton
        if (pose) {
            tmPose.drawKeypoints(pose.keypoints, MIN_KEYPOINT_SCORE, ctx);
            tmPose.drawSkeleton(pose.keypoints, MIN_KEYPOINT_SCORE, ctx);
        }
    }
}

// Ask the assistant about the exercise the camera sees
function askForTip() {
    if (!currentExercise) return;
    sendMessage("Give me one quick form tip for " + currentExercise + ".");
}

// Send message function
function sendMessage(text) {
    const input = document.getElementById("user-input");
    const userInput = text || input.value;
    if (userInput.trim() === "") return;

    addMessageToChat(userInput, "user");
    input.value = "";

    fetch("/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            message: userInput,
            exercise: currentExercise,
        }),
    })
    .then((response) => response.json())
    .then((data) => {
        if (data.error) {
            addMessageToChat(data.error, "error");
        } else {
            addMessageToChat(data.response, "bot");
        }
    })
    .catch((error) => {
        console.error("Error:", error);
        addMessageToChat("Could not reach the app. Is it still running?", "error");
    });
}

// Add message to chat
function addMessageToChat(message, sender) {
    const chatContainer = document.getElementById("chat-container");
    const emptyMessage = document.getElementById("chat-empty");
    if (emptyMessage) emptyMessage.remove();

    const messageElement = document.createElement("div");
    messageElement.classList.add("message", sender + "-message");
    messageElement.textContent = message;
    chatContainer.appendChild(messageElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Clear the chat and the rep counts so the next person starts fresh
function nextGuest() {
    repCounts = {};
    repState = { inRep: false };
    recentLabels = [];
    document.getElementById("rep-count").textContent = "0";
    document.getElementById("chat-container").innerHTML = '<p id="chat-empty">Ask about your form, reps or what to try next.</p>';
    document.getElementById("user-input").value = "";
    fetch("/reset", { method: "POST" }).catch((error) => console.error("Error:", error));
}

// Event listener for Enter key
document.getElementById("user-input").addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        sendMessage();
    }
});

// Skip the Start button when the browser already allows the camera (handy between guests)
if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "camera" })
        .then((result) => { if (result.state === "granted") init(); })
        .catch(() => {});
}
