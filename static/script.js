// Teachable Machine model URL
const URL = "https://teachablemachine.withgoogle.com/models/8PYrvj5U2/";
const CAMERA_SIZE = 400;
const MIN_CONFIDENCE = 0.5;
let model, webcam, ctx, labelContainer, maxPredictions;
let currentExercise = "";

// Initialize webcam and model
async function init() {
    const startButton = document.getElementById("start-button");
    const cameraStatus = document.getElementById("camera-status");
    startButton.disabled = true;
    cameraStatus.textContent = "Loading the model...";

    try {
        model = await tmPose.load(URL + "model.json", URL + "metadata.json");
        maxPredictions = model.getTotalClasses();

        // Setup webcam
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
    document.getElementById("current-exercise").textContent = "Waiting for a pose";

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

    if (top) {
        currentExercise = top.className;
        document.getElementById("current-exercise").textContent = currentExercise;
    }

    drawPose(pose);
}

function drawPose(pose) {
    if (ctx && webcam.canvas) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.drawImage(webcam.canvas, 0, 0);
        // draw the keypoints and skeleton
        if (pose) {
            const minPartConfidence = 0.5;
            tmPose.drawKeypoints(pose.keypoints, minPartConfidence, ctx);
            tmPose.drawSkeleton(pose.keypoints, minPartConfidence, ctx);
        }
    }
}

// Send message function
function sendMessage() {
    const input = document.getElementById("user-input");
    const userInput = input.value;
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

// Event listener for Enter key
document.getElementById("user-input").addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        sendMessage();
    }
});
