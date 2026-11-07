import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

# The OpenAI client refuses to build without a key. Tests never call OpenAI, so a placeholder is enough.
os.environ.setdefault("OPENAI_API_KEY", "placeholder-for-tests")

import app as workout_app


def fake_reply(text):
    response = MagicMock()
    response.choices = [MagicMock(message=MagicMock(content=text))]
    return response


class ChatTests(unittest.TestCase):
    def setUp(self):
        workout_app.app.config["TESTING"] = True
        self.client = workout_app.app.test_client()

    def test_home_page_loads(self):
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        self.assertIn(b"AI Workout Assistant", page.data)
        self.assertIn(b"vendor/tf.min.js", page.data)
        self.assertIn(b"Next guest", page.data)

    def test_static_model_files_are_served(self):
        for path in ["/static/model/model.json", "/static/model/metadata.json",
                     "/static/vendor/posenet/model-stride16.json"]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            response.close()

    def test_chat_uses_mock_model_and_exercise(self):
        with patch.object(workout_app.openai.chat.completions, "create",
                          return_value=fake_reply("Keep your elbows in.")) as create:
            reply = self.client.post("/chat", json={"message": "How is my form?", "exercise": "Bicep Curls"})
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(reply.get_json()["response"], "Keep your elbows in.")
        sent = create.call_args.kwargs
        self.assertEqual(sent["model"], workout_app.MODEL)
        self.assertIn("Bicep Curls", sent["messages"][0]["content"])
        self.assertEqual(sent["messages"][-1], {"role": "user", "content": "How is my form?"})

    def test_empty_message_is_rejected(self):
        reply = self.client.post("/chat", json={"message": "   "})
        self.assertEqual(reply.status_code, 400)
        self.assertIn("error", reply.get_json())

    def test_history_is_trimmed(self):
        with patch.object(workout_app.openai.chat.completions, "create",
                          return_value=fake_reply("ok")) as create:
            for i in range(12):
                self.client.post("/chat", json={"message": f"message {i}"})
        sent = create.call_args.kwargs["messages"]
        # system message plus at most MAX_HISTORY conversation messages
        self.assertLessEqual(len(sent), 1 + workout_app.MAX_HISTORY)
        self.assertEqual(sent[-1]["content"], "message 11")

    def test_reset_clears_conversation(self):
        with patch.object(workout_app.openai.chat.completions, "create",
                          return_value=fake_reply("ok")) as create:
            self.client.post("/chat", json={"message": "first"})
            self.assertEqual(self.client.post("/reset").status_code, 200)
            self.client.post("/chat", json={"message": "second"})
        sent = create.call_args.kwargs["messages"]
        self.assertEqual([m["content"] for m in sent[1:]], ["second"])

    def test_missing_key_gives_friendly_error(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}), \
             patch.object(workout_app.openai.chat.completions, "create",
                          side_effect=RuntimeError("no key")):
            reply = self.client.post("/chat", json={"message": "hi"})
        self.assertEqual(reply.status_code, 500)
        self.assertIn("OPENAI_API_KEY", reply.get_json()["error"])


class HighScoreTests(unittest.TestCase):
    def setUp(self):
        workout_app.app.config["TESTING"] = True
        self.client = workout_app.app.test_client()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.board_file = os.path.join(folder.name, "scores.json")
        patcher = patch.object(workout_app, "BOARD_FILE", self.board_file)
        patcher.start()
        self.addCleanup(patcher.stop)

    def add(self, name, score, move="Arm Raises"):
        return self.client.post("/scores", json={"move": move, "name": name, "score": score})

    def test_board_starts_empty_for_each_guest_move(self):
        scores = self.client.get("/scores").get_json()["scores"]
        self.assertEqual(scores, {"Arm Raises": [], "Curls": [], "Squats": [], "Pushups": []})

    def test_keeps_the_top_five_in_order(self):
        for i, score in enumerate([3, 9, 5, 7, 1, 8]):
            self.add(f"guest {i}", score)
        rows = self.client.get("/scores").get_json()["scores"]["Arm Raises"]
        self.assertEqual([row["score"] for row in rows], [9, 8, 7, 5, 3])

    def test_each_move_has_its_own_board(self):
        self.add("arms", 5)
        self.add("floor", 7, move="Pushups")
        scores = self.client.get("/scores").get_json()["scores"]
        self.assertEqual([row["name"] for row in scores["Pushups"]], ["floor"])
        self.assertEqual([row["name"] for row in scores["Arm Raises"]], ["arms"])

    def test_place_is_reported_and_ties_stay_below(self):
        self.add("first", 5)
        reply = self.add("second", 5).get_json()
        self.assertEqual(reply["place"], 1)
        self.assertEqual(self.add("top", 6).get_json()["place"], 0)

    def test_names_are_cleaned_and_shortened(self):
        self.add("<b>Ann</b>   O'Neil-Smith Junior", 4)
        name = self.client.get("/scores").get_json()["scores"]["Arm Raises"][0]["name"]
        self.assertLessEqual(len(name), workout_app.MAX_NAME_LENGTH)
        self.assertNotIn("<", name)
        self.assertEqual(self.add("   ", 3).get_json()["scores"]["Arm Raises"][1]["name"], "Guest")

    def test_bad_scores_and_moves_are_rejected(self):
        for score in [0, -1, 61, 2.5, "5", True, None]:
            self.assertEqual(self.add("x", score).status_code, 400, score)
        self.assertEqual(self.add("x", 5, move="Dead Lift").status_code, 400)
        self.assertFalse(os.path.exists(self.board_file))

    def test_board_survives_reset_and_a_broken_file_is_empty(self):
        self.add("stays", 5)
        self.client.post("/reset")
        with open(self.board_file) as f:
            self.assertEqual(json.load(f)["Arm Raises"][0]["name"], "stays")
        with open(self.board_file, "w") as f:
            f.write("{broken")
        self.assertEqual(self.client.get("/scores").get_json()["scores"]["Curls"], [])

    def test_clear_needs_the_word_clear(self):
        self.add("stays", 5)
        self.assertEqual(self.client.post("/scores/clear", json={"confirm": "yes"}).status_code, 400)
        self.assertEqual(self.client.post("/scores/clear").status_code, 400)
        self.assertEqual(len(self.client.get("/scores").get_json()["scores"]["Arm Raises"]), 1)
        self.assertEqual(self.client.post("/scores/clear", json={"confirm": "CLEAR"}).status_code, 200)
        self.assertEqual(self.client.get("/scores").get_json()["scores"]["Arm Raises"], [])

    def test_scoreboard_page_loads_and_is_not_linked_from_the_guest_page(self):
        self.assertEqual(self.client.get("/board").status_code, 200)
        self.assertNotIn(b"/board", self.client.get("/").data)

    def test_staff_page_is_not_linked_from_the_guest_page(self):
        self.assertEqual(self.client.get("/staff").status_code, 200)
        self.assertNotIn(b"/staff", self.client.get("/").data)


class StationKeyTests(unittest.TestCase):
    def setUp(self):
        workout_app.app.config["TESTING"] = True
        self.client = workout_app.app.test_client()
        patcher = patch.dict(os.environ, {"STATION_KEY": "test-station-key"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_no_key_is_refused_everywhere(self):
        for path in ["/", "/board", "/staff", "/scores", "/static/script.js", "/static/model/model.json"]:
            self.assertEqual(self.client.get(path).status_code, 403, path)
        self.assertEqual(self.client.post("/scores", json={}).status_code, 403)
        self.assertEqual(self.client.post("/chat", json={"message": "hi"}).status_code, 403)

    def test_wrong_key_is_refused(self):
        self.assertEqual(self.client.get("/?key=wrong").status_code, 403)
        self.assertEqual(self.client.get("/?key=caf\u00e9").status_code, 403)

    def test_key_link_sets_a_safe_cookie_and_drops_the_key_from_the_address(self):
        page = self.client.get("/board?key=test-station-key")
        self.assertEqual(page.status_code, 302)
        self.assertEqual(page.headers["Location"], "/board")
        cookie = page.headers["Set-Cookie"]
        for part in ("HttpOnly", "Secure", "SameSite=Lax"):
            self.assertIn(part, cookie)

    def test_cookie_opens_everything(self):
        self.client.set_cookie(workout_app.KEY_COOKIE, "test-station-key")
        for path in ["/", "/board", "/staff", "/static/script.js"]:
            self.assertEqual(self.client.get(path).status_code, 200, path)

    def test_no_station_key_leaves_the_app_open(self):
        with patch.dict(os.environ, {"STATION_KEY": ""}):
            self.assertEqual(self.client.get("/").status_code, 200)


class FakeCursor:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row


class FakeConnection:
    """Stands in for Postgres: one table with one row."""

    def __init__(self, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, values=None):
        if sql.startswith("INSERT"):
            self.rows[1] = values[0]
        if sql.startswith("SELECT"):
            return FakeCursor((self.rows[1],) if 1 in self.rows else None)
        return FakeCursor(None)


class DatabaseBoardTests(unittest.TestCase):
    def setUp(self):
        workout_app.app.config["TESTING"] = True
        self.client = workout_app.app.test_client()
        self.rows = {}
        self.fake_psycopg = MagicMock()
        self.fake_psycopg.connect.side_effect = lambda *a, **k: FakeConnection(self.rows)
        for patcher in (patch.dict(sys.modules, {"psycopg": self.fake_psycopg}),
                        patch.dict(os.environ, {"DATABASE_URL": "postgres://not-real"}),
                        patch.object(workout_app, "BOARD_FILE", "/nonexistent/folder/scores.json")):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_scores_save_to_the_database_and_never_touch_the_file(self):
        self.client.post("/scores", json={"move": "Curls", "name": "Ana", "score": 9})
        rows = self.client.get("/scores").get_json()["scores"]["Curls"]
        self.assertEqual(rows, [{"name": "Ana", "score": 9}])
        self.assertIn("Ana", self.rows[1])

    def test_clear_empties_the_database_board(self):
        self.client.post("/scores", json={"move": "Curls", "name": "Ana", "score": 9})
        self.client.post("/scores/clear", json={"confirm": "CLEAR"})
        self.assertEqual(self.client.get("/scores").get_json()["scores"]["Curls"], [])

    def test_a_database_failure_never_overwrites_the_board(self):
        self.client.post("/scores", json={"move": "Curls", "name": "Ana", "score": 9})
        self.fake_psycopg.connect.side_effect = OSError("database down")
        workout_app.app.config["TESTING"] = False
        self.addCleanup(workout_app.app.config.update, TESTING=True)
        answer = self.client.post("/scores", json={"move": "Curls", "name": "Bo", "score": 2})
        self.assertEqual(answer.status_code, 500)
        self.assertIn("Ana", self.rows[1])


if __name__ == "__main__":
    unittest.main()
