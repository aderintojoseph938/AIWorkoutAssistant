from flask import Flask, render_template, request, jsonify, session
from flask_session import Session
import openai
import os

app = Flask(__name__)


# Session configuration
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
Session(app)

# Which OpenAI model answers the chat. Change it with OPENAI_MODEL if this one is ever retired.
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

# Only the last few messages go to the model so a long chat stays fast and cheap
MAX_HISTORY = 10

SYSTEM_MESSAGE = (
    "You are a friendly workout assistant at a busy event. "
    "Give short, practical advice on form and training. "
    "Answer in two or three plain sentences. No markdown, no bullet points."
)

# Home route
@app.route('/')
def home():
    return render_template('index.html')



def friendly_error(error):
    if not os.environ.get("OPENAI_API_KEY"):
        return "The chat needs an OpenAI key. Set OPENAI_API_KEY and restart the app."
    return f"The assistant could not answer: {error}"


# Chat route - handles the conversation with the LLM
@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json(silent=True) or {}
    user_message = str(data.get('message', '')).strip()
    exercise = data.get('exercise', '')

    if not user_message:
        return jsonify({'error': 'Type a message first.'}), 400

    if 'conversation' not in session:
        session['conversation'] = []

    session['conversation'].append({"role": "user", "content": user_message})
    session['conversation'] = session['conversation'][-MAX_HISTORY:]
    session.modified = True

    system_message = SYSTEM_MESSAGE
    if exercise:
        system_message += f" The camera currently sees the user doing: {exercise}."
    messages = [{
        "role": "system",
        "content": system_message
    }] + session['conversation']

    try:
        # Make a request to OpenAI API
        response = openai.chat.completions.create(model=MODEL,
                                                  messages=messages,
                                                  max_tokens=200)
        gpt_response = response.choices[0].message.content
        session['conversation'].append({
            "role": "assistant",
            "content": gpt_response
        })
        session.modified = True
        return jsonify({'response': gpt_response})
    except Exception as e:
        return jsonify({'error': friendly_error(e)}), 500


# Reset route - clears the chat so the next person starts fresh
@app.route('/reset', methods=['POST'])
def reset():
    session.pop('conversation', None)
    return jsonify({'ok': True})


if __name__ == '__main__':
    app.run(host="0.0.0.0", port=8080)
