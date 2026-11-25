import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cloudru
import map_chat
import server
import universe


class MapChatTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        database = patch.object(server, "DB", root / "memory.db")
        database.start()
        self.addCleanup(database.stop)
        server.init()
        documents = root / "docs"
        for folder, text in (
            ("разрешено/подпапка", "Орбита. Открытый фрагмент."),
            ("личное", "Орбита. Закрытый фрагмент."),
        ):
            path = documents / folder / "Орбита.txt"
            path.parent.mkdir(parents=True)
            path.write_text(text, encoding="utf-8")
        with server.connect() as db:
            universe.scan(db, documents)
            db.execute("INSERT INTO memory VALUES (1,'Знания','Орбита')")
            db.execute("INSERT INTO document_links SELECT id,1 FROM documents")

    def preferences(self, action, **data):
        with server.connect() as db:
            return map_chat.update_preferences(db, {"action": action, **data})

    def ask(self, prompt, **data):
        return map_chat.answer(server.connect, lambda: ("key", "model"), {"prompt": prompt, **data})

    def test_local_routes_and_saved_view(self):
        with patch.object(cloudru, "chat") as cloud:
            stats = self.ask("Сколько у меня документов?")
            self.assertIn("Документов: 2", stats["turns"][-1]["reply"])
            linked = self.ask("Что с этим связано?", session=stats["active"], selection={"id": 1, "group": "Знания"})
            self.assertEqual(len(linked["turns"][-1]["sources"]), 2)
            search = self.ask("Найди документы об орбитах", session=stats["active"])
            self.assertTrue(search["turns"][-1]["sources"])
            cloud.assert_not_called()

        view = {"scale": 2, "x": 15, "y": 4, "focus": None, "after": 0, "chosen": 0, "history": []}
        self.preferences("view", view=view)
        self.preferences("new")
        server.init()
        previous = self.preferences("open", session=stats["active"])
        self.assertEqual(len(previous["turns"]), 3)
        self.assertEqual(previous["view"], view)

    def test_map_display_is_restored_without_replacing_legacy_view_fields(self):
        view = {"scale": 1.28, "x": 0, "y": 0, "focus": None, "chosen": 0, "after": 0, "history": [],
                "display": {"layout": "sectors", "theme": "paper", "routes": False, "labels": True}}
        self.preferences("view", view=view)
        with self.assertRaises(ValueError):
            self.preferences("view", view={**view, "display": {**view["display"], "routes": "false"}})
        server.init()
        with server.connect() as db:
            self.assertEqual(map_chat.conversations(db)["view"], view)

    def test_cloud_context_is_folder_scoped_and_citations_open_local_sources(self):
        self.preferences("folders", folders=["разрешено"])
        with patch.object(cloudru, "chat", return_value="По данным документа [1].") as cloud:
            data = self.ask("Расскажи подробнее про орбиту")
        _, _, messages, context = cloud.call_args.args
        self.assertIn("Открытый фрагмент", context)
        self.assertNotIn("Закрытый фрагмент", context)
        self.assertNotIn("личное/", context)
        references = json.loads(context.split("Источники: ", 1)[1])
        expected = references[0]["name"]
        self.assertEqual(data["turns"][-1]["sources"][0]["label"], expected)
        self.assertEqual(data["turns"][-1]["sources"][0]["citation"], 1)
        self.assertEqual(messages[-1]["role"], "user")

    def test_default_privacy_and_cloud_fallback(self):
        with patch.object(cloudru, "chat", side_effect=cloudru.TransientCloudError("Сеть недоступна")) as cloud:
            data = self.ask("Объясни орбиту")
        self.assertEqual(cloud.call_count, 2)
        self.assertNotIn(".txt", cloud.call_args.args[3])
        self.assertEqual(data["turns"][-1]["mode"], "fallback")
        self.assertTrue(data["turns"][-1]["sources"])
        with patch.object(cloudru, "chat", side_effect=cloudru.CloudError("Ошибка ключа")) as cloud:
            self.ask("Объясни орбиту", session=data["active"])
        self.assertEqual(cloud.call_count, 1)
