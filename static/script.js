// Teachable Machine model URL
const URL = "https://teachablemachine.withgoogle.com/models/-q6hHNGve/";
let model, webcam, labelContainer, maxPredictions;
let currentAnimal = "";

// Initialize webcam and model
async function init() {
    const modelURL = URL + "model.json";
    const metadataURL = URL + "metadata.json";

    model = await tmImage.load(modelURL, metadataURL);
    maxPredictions = model.getTotalClasses();

    // Setup webcam
    const flip = true;
    webcam = new tmImage.Webcam(200, 200, flip);
    await webcam.setup();
    await webcam.play();
    window.requestAnimationFrame(loop);

    document.getElementById("webcam-container").appendChild(webcam.canvas);

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
async function predict() {
    const prediction = await model.predict(webcam.canvas);
    for (let i = 0; i < maxPredictions; i++) {
        const classPrediction = prediction[i].className + ": " + prediction[i].probability.toFixed(2);
        labelContainer.childNodes[i].innerHTML = classPrediction;
        if (prediction[i].probability > 0.5) {
            currentAnimal = prediction[i].className;
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
const messages = document.getElementById('messages');

function sendMessage() {
    const userInput = document.getElementById('userInput').value;
    if (userInput.trim() === '') return;

    addMessage('User', userInput);
    document.getElementById('userInput').value = '';

    // Simulate bot response
    setTimeout(() => {
        const botResponse = getBotResponse(userInput);
        addMessage('Bot', botResponse);
    }, 1000);
}

function addMessage(sender, text) {
    const message = document.createElement('div');
    message.className = sender.toLowerCase();
    message.innerText = `${sender}: ${text}`;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
}

let step = 0;
let medicalHistory = {};

function getBotResponse(input) {
    if (step === 0) {
        step++;
        return 'Hello! Please tell me about any medical conditions you have.';
    } else if (step === 1) {
        medicalHistory.conditions = input;
        step++;
        return 'Thank you! Do you have any injuries or surgeries I should know about?';
    } else if (step === 2) {
        medicalHistory.injuries = input;
        step++;
        return 'Got it! Which muscle group would you like to train today? (e.g., chest, back, legs, arms)';
    } else if (step === 3) {
        const muscleGroup = input.toLowerCase();
        return getTrainingInfo(muscleGroup);
    } else {
        return 'I can help you with training information. Please specify a muscle group.';
    }
}

function getTrainingInfo(muscleGroup) {
    const trainingInfo = {
        chest: 'For chest exercises, you can do bench presses, push-ups, and chest flies. Make sure to keep your back flat and avoid locking your elbows.',
        back: 'For back exercises, try pull-ups, rows, and lat pulldowns. Keep your core tight and avoid swinging your body.',
        legs: 'For leg exercises, squats, lunges, and leg presses are great. Ensure your knees don’t go past your toes and keep your back straight.',
        arms: 'For arm exercises, bicep curls, tricep dips, and hammer curls are effective. Keep your elbows close to your body and avoid using momentum.'
    };

    return trainingInfo[muscleGroup] || 'Sorry, I don’t have information on that muscle group. Please choose from chest, back, legs, or arms.';
}
document.addEventListener('DOMContentLoaded', () => {
    addMessage('Bot', 'Hello! Please tell me about any medical conditions you have.');
});
