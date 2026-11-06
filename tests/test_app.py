import os
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


if __name__ == "__main__":
    unittest.main()
