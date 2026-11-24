import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cloudru
import server


class CloudSettingsTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        db = patch.object(server, "DB", Path(folder.name) / "memory.db")
        db.start()
        self.addCleanup(db.stop)
        catalog = patch.object(cloudru, "models", return_value=["provider/chat"])
        self.catalog = catalog.start()
        self.addCleanup(catalog.stop)
        server.init()

    def test_connect_select_chat_and_disconnect(self):
        saved = server.update_cloud_settings({"action": "models", "apiKey": "example-key"})
        self.assertEqual(saved, {"hasKey": True, "model": "", "models": ["provider/chat"]})
        server.update_cloud_settings({"action": "select", "model": "provider/chat"})
        server.init()
        self.assertEqual(server.cloud_settings(), ("example-key", "provider/chat"))

        messages = [{"role": "user", "content": "Привет"}]
        with patch.object(cloudru, "chat", return_value="Ответ") as chat:
            self.assertEqual(server.cloud_chat({"messages": messages}), {"answer": "Ответ"})
            chat.assert_called_once_with("example-key", "provider/chat", messages, "")

        server.update_cloud_settings({"action": "disconnect"})
        self.assertEqual(server.cloud_settings(), ("", ""))
        with self.assertRaises(cloudru.CloudError):
            server.cloud_chat({"messages": messages})

    def test_rejected_replacement_keeps_settings(self):
        server.update_cloud_settings({"action": "models", "apiKey": "example-key"})
        server.update_cloud_settings({"action": "select", "model": "provider/chat"})
        self.catalog.side_effect = cloudru.CloudError("Rejected")
        with self.assertRaises(cloudru.CloudError):
            server.update_cloud_settings({"action": "models", "apiKey": "rejected-key"})
        self.assertEqual(server.cloud_settings(), ("example-key", "provider/chat"))
