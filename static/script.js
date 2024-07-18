// Teachable Machine model URL
//const URL = "https://teachablemachine.withgoogle.com/models/-q6hHNGve/";
const URL = "https://teachablemachine.withgoogle.com/models/8PYrvj5U2/";
let model, webcam, ctx, labelContainer, maxPredictions;
let currentAnimal = "";

// Initialize webcam and model
async function init() {
    const modelURL = URL + "model.json";
    const metadataURL = URL + "metadata.json";

    model = await tmPose.load(modelURL, metadataURL);
    maxPredictions = model.getTotalClasses();

    // Setup webcam
    const flip = true;
    webcam = new tmPose.Webcam(200, 200, flip);
    await webcam.setup();
    await webcam.play();
    window.requestAnimationFrame(loop);


    const webcamContainer = document.getElementById("webcam-container");
    webcamContainer.innerHTML = '';

    document.getElementById("webcam-container").appendChild(webcam.canvas);
    document.getElementById("webcam-container").style.display="none";
    canvas = document.getElementById("my-canvas");
    //canvas.width = webcam.width;
    //canvas.height = webcam.height;
    
    ctx = canvas.getContext("2d");

    // Setup label container
    labelContainer = document.getElementById("label-container");
    for (let i = 0; i < maxPredictions; i++) {
        labelContainer.appendChild(document.createElement("div"));
    }
}

// Main prediction loop
async function loop() {
    webcam.update();
    await predict();
    window.requestAnimationFrame(loop);
}

// Predict function
//async function predict() {
    //const prediction = await model.predict(webcam.canvas);
    //for (let i = 0; i < maxPredictions; i++) {
        //const classPrediction = prediction[i].className + ": " + prediction[i].probability.toFixed(2);
        //labelContainer.childNodes[i].innerHTML = classPrediction;
        //if (prediction[i].probability > 0.5) {
            //currentAnimal = prediction[i].className;
        //}
    //}
//}
async function predict(){
    const { pose, posenetOutput} = await model.estimatePose(webcam.canvas);
    const prediction = await model.predict(posenetOutput);

    for (let i = 0; i < maxPredictions; i++) {
        const classPrediction =
            prediction[i].className + ": " + prediction[i].probability.toFixed(2);
        labelContainer.childNodes[i].innerHTML = classPrediction;

        if (prediction[i].probability > 0.5) {
            currentAnimal = prediction[i].className;
        }
    }

    drawPose(pose);
}

function drawPose(pose) {
    if (ctx && webcam.canvas) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height );
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
    const userInput = document.getElementById("user-input").value;
    if (userInput.trim() === "") return;

    addMessageToChat(userInput, 'user');

    fetch('/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: userInput,
            animalType: currentAnimal
        }),
    })
    .then(response => response.json())
    .then(data => {
        addMessageToChat(data.response, 'bot');
    })
    .catch((error) => {
        console.error('Error:', error);
    });

    document.getElementById("user-input").value = "";
}

// Add message to chat
function addMessageToChat(message, sender) {
    const chatContainer = document.getElementById("chat-container");
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