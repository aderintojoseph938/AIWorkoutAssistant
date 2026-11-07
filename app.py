from flask import Flask, redirect, render_template, request, jsonify, session
from flask_session import Session
import hmac
import json
import openai
import os
import threading

app = Flask(__name__)


# Session configuration
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY")
Session(app)

# Which OpenAI model answers the chat. Change it with OPENAI_MODEL if this one is ever retired.
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

# Only the last few messages go to the model so a long chat stays fast and cheap
MAX_HISTORY = 10

# Give up on a chat reply after this many seconds, with no retries, so a slow
# connection shows an error instead of leaving the guest waiting
CHAT_TIMEOUT_SECONDS = 15
openai.max_retries = 0

SYSTEM_MESSAGE = (
    "You are a friendly workout assistant at a busy event. "
    "Give short, practical advice on form and training. "
    "Answer in two or three plain sentences. No markdown, no bullet points."
)

# When the app is hosted, STATION_KEY keeps strangers out. Open the site once with
# ?key=... and a cookie remembers that station. With no STATION_KEY, like on a
# laptop, the app is open.
KEY_COOKIE = "station_key"
KEY_COOKIE_SECONDS = 7 * 24 * 60 * 60

# High score board. Hosted, it lives in the database, because a hosted app loses its
# files on every restart. On a laptop it lives in a small file, which survives a
# page refresh or a restart.
BOARD_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "high_scores.json")
BOARD_MOVES = ["Arm Raises", "Curls", "Squats", "Pushups"]
BOARD_SIZE = 5
MAX_NAME_LENGTH = 16
# Nobody does more than this in 20 seconds, so anything higher is not a real score
MAX_SCORE = 60
board_lock = threading.Lock()


def empty_board():
    return {move: [] for move in BOARD_MOVES}


def open_database():
    # Imported here so a laptop without a database does not need psycopg installed
    import psycopg
    connection = psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=5)
    connection.execute(
        "CREATE TABLE IF NOT EXISTS high_scores (id INTEGER PRIMARY KEY, board TEXT NOT NULL)")
    return connection


def read_saved_board():
    # A database error is not caught on purpose. Treating it as an empty board
    # would let the next score wipe the real one.
    if os.environ.get("DATABASE_URL"):
        with open_database() as connection:
            row = connection.execute("SELECT board FROM high_scores WHERE id = 1").fetchone()
        return json.loads(row[0]) if row else None
    try:
        with open(BOARD_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def read_board():
    saved = read_saved_board()
    board = empty_board()
    if isinstance(saved, dict):
        for move in BOARD_MOVES:
            if isinstance(saved.get(move), list):
                board[move] = saved[move]
    return board


def write_board(board):
    if os.environ.get("DATABASE_URL"):
        with open_database() as connection:
            connection.execute(
                "INSERT INTO high_scores (id, board) VALUES (1, %s) "
                "ON CONFLICT (id) DO UPDATE SET board = EXCLUDED.board",
                (json.dumps(board),))
        return
    # Write a new file and swap it in, so a crash can never leave half a board
    temp_file = BOARD_FILE + ".tmp"
    with open(temp_file, "w") as f:
        json.dump(board, f)
    os.replace(temp_file, BOARD_FILE)


def clean_name(name):
    # Keep letters, numbers and simple name punctuation, then squeeze the spaces
    kept = "".join(ch for ch in str(name) if ch.isalnum() or ch in " '-.")
    return " ".join(kept.split())[:MAX_NAME_LENGTH].strip() or "Guest"


# Runs before every page, API call and static file
@app.before_request
def check_station_key():
    key = os.environ.get("STATION_KEY", "").encode()
    if not key:
        return None
    if hmac.compare_digest(request.cookies.get(KEY_COOKIE, "").encode(), key):
        return None
    if hmac.compare_digest(request.args.get("key", "").encode(), key):
        # Remember this station, then reload without the key in the address
        response = redirect(request.path)
        response.set_cookie(KEY_COOKIE, key.decode(), max_age=KEY_COOKIE_SECONDS,
                            httponly=True, secure=True, samesite="Lax")
        return response
    return "This station needs its key link. Use the C2C Pushup or C2C Pushup Board shortcut on the desktop.", 403


# Home route
@app.route('/')
def home():
    return render_template('index.html')


# High scores - read the board
@app.route('/scores', methods=['GET'])
def get_scores():
    with board_lock:
        return jsonify({'scores': read_board()})


# High scores - add one score. Ties stay below the older score.
@app.route('/scores', methods=['POST'])
def add_score():
    data = request.get_json(silent=True) or {}
    move = data.get('move')
    score = data.get('score')

    if move not in BOARD_MOVES:
        return jsonify({'error': 'Unknown move.'}), 400
    if type(score) is not int or not 1 <= score <= MAX_SCORE:
        return jsonify({'error': 'Score is out of range.'}), 400

    entry = {'name': clean_name(data.get('name', '')), 'score': score}
    with board_lock:
        board = read_board()
        ranked = sorted(board[move] + [entry], key=lambda row: -row['score'])
        place = next(i for i, row in enumerate(ranked) if row is entry)
        board[move] = ranked[:BOARD_SIZE]
        write_board(board)
    return jsonify({'scores': board, 'place': place if place < BOARD_SIZE else None})


# Scoreboard for the second monitor - description and high scores, no controls
@app.route('/board')
def board():
    return render_template('board.html')


# Staff page - not linked from the guest screen
@app.route('/staff')
def staff():
    return render_template('staff.html')


# High scores - wipe the board. The staff page has to send the word CLEAR.
@app.route('/scores/clear', methods=['POST'])
def clear_scores():
    data = request.get_json(silent=True) or {}
    if data.get('confirm') != 'CLEAR':
        return jsonify({'error': 'Type CLEAR to wipe the board.'}), 400
    with board_lock:
        write_board(empty_board())
    return jsonify({'ok': True})



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
                                                  max_tokens=200,
                                                  timeout=CHAT_TIMEOUT_SECONDS)
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
