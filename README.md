# AIWorkoutAssistant
This super advanced AI uses multiple LLMS and libraries to have an accurate response to any input workout related.

The camera spots which exercise you are doing (Teachable Machine pose model), counts your reps from the joint angles PoseNet sees, and a chat assistant answers questions about your form.

## Run it

1. Install the packages: `poetry install` (or without Poetry: `pip install -r requirements.txt`)
2. Set your OpenAI key: `export OPENAI_API_KEY=your_key` (Windows PowerShell: `$env:OPENAI_API_KEY="your_key"`)
3. Start the app: `poetry run python app.py` (or `python app.py`)
4. Open http://localhost:8080 in Chrome and click Start Webcam, then Allow when the browser asks for the camera

Do not commit your key.

The chat uses `gpt-4o-mini`. If OpenAI retires it, set `OPENAI_MODEL` to another chat model before starting the app.

## Demo day notes

- The pose model, PoseNet and TensorFlow.js are saved in `static/`, so the camera side works with no internet. Only the chat needs a connection.
- Stand about two meters back so your whole body is in frame. The page says "No one in frame" until it can see enough of a person.
- Reps come from body movement, not the model's guess, so curls, arm raises, squats and pushups all count at once. One rep is the joint angle reaching the working end of the move and coming back to rest. Squats watch how far the hips drop, because knee angle barely changes when you face the camera. The numbers are in `REP_RULES` in `static/script.js`.
- The 20 second challenge is in `static/challenge.js`. Only the picked move scores. Pushups are the last option. Turn sideways so the camera sees your whole body.
- High scores are saved in `high_scores.json` next to `app.py`. To wipe them, go to `/staff` and type CLEAR.
- "Ask for a tip on ..." sends the detected exercise to the assistant for a one line form tip.
- "Next guest" clears the chat, the rep counts and the challenge for the next person. The high scores stay.
- Once the browser has allowed the camera, a page refresh starts it again without clicking.

## Tests

`python -m unittest tests.test_app` runs the chat, reset and high score routes with a mocked OpenAI call. No key is needed.
