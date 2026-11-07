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
// All of these run on every frame, whatever the model's guess says. Pushups only count
// when the body is lying flat, and the others only count when it is upright.
// Squats are different: facing the camera, the knee angle barely changes on screen, so we
// watch how far the hips drop instead. Their rest and work numbers are torso lengths, not degrees.
const REP_RULES = {
    "Bicep Curls":    { joints: ["Shoulder", "Elbow", "Wrist"], rest: 150, work: 70 },
    "Squats":         { hipDrop: true,                          rest: 0.1, work: 0.25 },
    "Pushups":        { joints: ["Shoulder", "Elbow", "Wrist"], rest: 155, work: 100, lying: true },
    "Lateral Raises": { joints: ["Hip", "Shoulder", "Elbow"],   rest: 40,  work: 80 },
};

// Counting uses a lower bar than the skeleton does, because PoseNet is unsure of wrists and hips
// in a pushup. To make up for that, each angle is the middle of the last few frames, so one bad frame
// cannot count a rep.
const COUNT_KEYPOINT_SCORE = 0.15;
const ANGLE_FRAMES = 3;

// The standing hip height follows you up right away and sinks slowly, so it keeps up
// if you shift your feet or the camera gets bumped
const STANDING_DRIFT = 0.01;

// PoseNet follows one person, and with people nearby it can hop back and forth. Upright moves stay
// locked on one person, so a bystander cannot add reps. Hips this far sideways (in torso lengths) from where we last saw them are someone else.
// We only switch to them if they stay for this many frames, are clearly closer to the camera,
// or are nearer the middle of the picture, where a guest stands, and about the same size.
const PERSON_JUMP = 0.5;
const PERSON_SWITCH_FRAMES = 20;
const CLOSER_RATIO = 1.25;

// The body is lying flat when the shoulder to hip line is closer to sideways than to up and down
const LYING_RATIO = 0.8;

// How long the last counted exercise stays on screen when the person drops out of the picture.
// PoseNet often loses someone in a pushup, so this stops the count flashing away between reps.
const REP_HOLD_MS = 10000;

let model, webcam, ctx, labelContainer, maxPredictions;
let currentExercise = "";
let recentLabels = [];
let repCounts = {};
let repTrackers = {};
let repExercise = "";
let lastRepTime = 0;
let lockedPerson = null;

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
        cameraStatus.textContent = "The pose model didn't load. Refresh the page and try again.";
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
        cameraStatus.textContent = "Couldn't start the camera. Check that this page can use your webcam, then try again.";
        startButton.disabled = false;
        return;
    }

    document.getElementById("webcam-container").appendChild(webcam.canvas);
    ctx = document.getElementById("my-canvas").getContext("2d");
    document.getElementById("camera").classList.add("is-live");
    showExercise("");
    cameraReady();

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

    // Reps come from the joint angles, so they count even when the model's guess is wrong
    countReps(pose);

    // Nobody in frame: the model would still guess an exercise, so stop here
    if (!personInFrame(pose)) {
        recentLabels = [];
        const holdRep = repExercise && Date.now() - lastRepTime < REP_HOLD_MS;
        showExercise(holdRep ? repExercise : "No one in frame");
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

    // Once someone has finished a rep, what they actually did beats the model's guess
    showExercise(repExercise || steadyLabel(recentLabels));
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

// The middle value of a short list
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

// The point on one body part, or null if PoseNet is not sure enough about it
function keypoint(pose, part) {
    const point = pose.keypoints.find((k) => k.part === part);
    return point && point.score >= COUNT_KEYPOINT_SCORE ? point.position : null;
}

// The average position of a left and right body part, using whichever ones PoseNet can see
function middlePoint(pose, part) {
    const points = [keypoint(pose, "left" + part), keypoint(pose, "right" + part)].filter(Boolean);
    if (points.length === 0) return null;
    return {
        x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
        y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
}

// True when the shoulder to hip line is flat, false when upright, null when we cannot tell
function isLyingFlat(pose) {
    const shoulder = middlePoint(pose, "Shoulder");
    const hip = middlePoint(pose, "Hip");
    if (!shoulder || !hip) return null;
    return Math.abs(hip.x - shoulder.x) > Math.abs(hip.y - shoulder.y) * LYING_RATIO;
}

// Count a rep when the joint angle reaches the working angle and then returns to the rest angle
function countRep(angle, rule, tracker) {
    const closing = rule.work < rule.rest;
    const atWork = closing ? angle <= rule.work : angle >= rule.work;
    const atRest = closing ? angle >= rule.rest : angle <= rule.rest;
    if (atWork) tracker.inRep = true;
    if (atRest && tracker.inRep) {
        tracker.inRep = false;
        return true;
    }
    return false;
}

// Each exercise keeps a separate tracker for each side of the body, so an arm the camera
// loses for a moment does not break the rep on the other arm
function repTracker(exercise, side) {
    const key = exercise + " " + side;
    if (!repTrackers[key]) repTrackers[key] = { angles: [], hipHeights: [], inRep: false, reps: 0 };
    return repTrackers[key];
}

// Drop any half finished rep, but keep the reps already counted
function clearRepsInProgress() {
    for (const key in repTrackers) {
        const tracker = repTrackers[key];
        tracker.angles = [];
        tracker.hipHeights = [];
        tracker.standingY = undefined;
        tracker.inRep = false;
    }
}

// True when this frame shows the person we are locked on. Locks on to the first person seen.
function isLockedPerson(pose) {
    const shoulder = middlePoint(pose, "Shoulder");
    const hip = middlePoint(pose, "Hip");
    const torso = Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y);

    if (lockedPerson && Math.abs(hip.x - lockedPerson.hipX) > torso * PERSON_JUMP) {
        lockedPerson.framesAway++;
        const closer = torso >= lockedPerson.torso * CLOSER_RATIO;
        const middle = CAMERA_SIZE / 2;
        const moreCentral = Math.abs(hip.x - middle) < Math.abs(lockedPerson.hipX - middle) - torso * PERSON_JUMP
            && torso >= lockedPerson.torso / CLOSER_RATIO;
        if (lockedPerson.framesAway < PERSON_SWITCH_FRAMES && !closer && !moreCentral) return false;
        clearRepsInProgress();
    }
    lockedPerson = { hipX: hip.x, torso: torso, framesAway: 0 };
    return true;
}

// Update the hip drop for a squat. Returns true when a rep finishes.
function countHipDrop(pose, rule, tracker) {
    const shoulder = middlePoint(pose, "Shoulder");
    const hip = middlePoint(pose, "Hip");
    if (!shoulder || !hip) return false;

    tracker.hipHeights.push(hip.y);
    if (tracker.hipHeights.length > ANGLE_FRAMES) tracker.hipHeights.shift();
    const hipY = median(tracker.hipHeights);

    // On screen, y gets bigger as you go down. A smaller y means the hips are higher.
    if (tracker.standingY === undefined || hipY < tracker.standingY) {
        tracker.standingY = hipY;
        tracker.torso = Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y);
    } else {
        tracker.standingY += (hipY - tracker.standingY) * STANDING_DRIFT;
    }

    const drop = (hipY - tracker.standingY) / tracker.torso;
    if (!countRep(drop, rule, tracker)) return false;
    tracker.reps++;
    return true;
}

// Update one side of one exercise. Returns true when that side finishes a rep.
function countSide(pose, exercise, side) {
    const rule = REP_RULES[exercise];
    const points = rule.joints.map((joint) => keypoint(pose, side + joint));
    if (points.includes(null)) return false;

    const tracker = repTracker(exercise, side);
    tracker.angles.push(jointAngle(points[0], points[1], points[2]));
    if (tracker.angles.length > ANGLE_FRAMES) tracker.angles.shift();
    if (!countRep(median(tracker.angles), rule, tracker)) return false;
    tracker.reps++;
    return true;
}

// Save a new highest count for an exercise and put it on screen
function landRep(exercise, count) {
    if (count <= (repCounts[exercise] || 0)) return;
    repCounts[exercise] = count;
    repExercise = exercise;
    lastRepTime = Date.now();
    showExercise(exercise);
}

// Run every exercise's counter on this frame. Both arms curling together is one rep, not two,
// so the count is the higher of the two sides.
function countReps(pose) {
    if (!pose) return;
    const lying = isLyingFlat(pose);
    if (lying === null) return;
    if (!lying && !isLockedPerson(pose)) return;

    for (const exercise in REP_RULES) {
        const rule = REP_RULES[exercise];
        if (Boolean(rule.lying) !== lying) continue;

        if (rule.hipDrop) {
            const tracker = repTracker(exercise, "hips");
            if (countHipDrop(pose, rule, tracker)) landRep(exercise, tracker.reps);
        } else {
            const left = countSide(pose, exercise, "left");
            const right = countSide(pose, exercise, "right");
            if (left || right) {
                landRep(exercise, Math.max(repTracker(exercise, "left").reps, repTracker(exercise, "right").reps));
            }
        }
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
    showChat(true);
    sendMessage("Give me one quick form tip for " + currentExercise + ".");
}

// Only one chat request at a time. The guard clears when the reply or error lands.
let chatBusy = false;

// Send message function
function sendMessage(text) {
    if (chatBusy) return;
    const input = document.getElementById("user-input");
    const sendButton = document.getElementById("send-button");
    const userInput = text || input.value;
    if (userInput.trim() === "") return;

    addMessageToChat(userInput, "user");
    input.value = "";
    chatBusy = true;
    sendButton.disabled = true;
    const thinking = addMessageToChat("Thinking...", "bot");

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
        thinking.remove();
        if (data.error) {
            addMessageToChat(data.error, "error");
        } else {
            addMessageToChat(data.response, "bot");
        }
    })
    .catch((error) => {
        thinking.remove();
        console.error("Error:", error);
        addMessageToChat("Couldn't reach the app. Try again in a moment.", "error");
    })
    .finally(() => {
        chatBusy = false;
        sendButton.disabled = false;
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
    return messageElement;
}

// Start every rep count again from zero
function clearReps() {
    repCounts = {};
    repTrackers = {};
    repExercise = "";
    lastRepTime = 0;
    lockedPerson = null;
    recentLabels = [];
    document.getElementById("rep-count").textContent = "0";
}

// Clear the chat, the rep counts and the challenge so the next person starts fresh.
// The high score board stays.
function nextGuest() {
    clearReps();
    resetChallenge();
    document.getElementById("chat-container").innerHTML = '<p id="chat-empty">Ask about your form, reps or what to try next.</p>';
    document.getElementById("user-input").value = "";
    chatBusy = false;
    document.getElementById("send-button").disabled = false;
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
