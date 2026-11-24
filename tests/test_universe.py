import tempfile
import unittest
from pathlib import Path
import server
import universe

class UniverseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        old = server.DB
        self.addCleanup(setattr,server,"DB",old)
        server.DB = Path(self.tmp.name)/"data"/"memory.db"
        server.init()
        self.root = Path(self.tmp.name)/"Документы"
        self.root.mkdir()

    def test_scale_and_pagination(self):
        with server.connect() as db:
            db.executemany("INSERT INTO memory(category,label) VALUES (?,?)",
                [(server.CATEGORIES[i%4],f"Record {i}") for i in range(5000)])
            db.executemany("INSERT INTO memory_links(source,target) VALUES (?,?)",
                [(i,i+1) for i in range(1,5000)])
        for i in range(1000):
            (self.root/f"{i:04}.txt").write_text("local searchable source",encoding="utf-8")
        with server.connect() as db:
            self.assertEqual(universe.scan(db,self.root),{"seen":1000,"errors":0})
            universe.link_document(db,1,1)
            data=universe.overview(db)
            self.assertEqual((data["memory"],data["documents"],data["links"]),(5000,1000,5000))
            self.assertEqual(data["indexed"],1000)
            for g in data["groups"]:
                self.assertLessEqual(len(g["bins"]),16)
                self.assertEqual(sum(b["count"] for b in g["bins"]),g["count"])
                cursor=0
                ids=[]
                while True:
                    page=universe.page(db,g["name"],cursor)
                    self.assertLessEqual(len(page["items"]),80)
                    ids.extend(i["id"] for i in page["items"])
                    if page["next"] is None: break
                    cursor=page["next"]
                self.assertEqual(len(ids),g["count"])
                self.assertEqual(len(ids),len(set(ids)))
            self.assertTrue(universe.search_documents(db,"searchable"))
            self.assertEqual(universe.scan(db,self.root)["seen"],1000)
            self.assertEqual(universe.overview(db)["links"],5000)

    def test_chat_search_returns_local_matches_and_excerpts(self):
        document = self.root / "atlas.txt"
        document.write_text("Straße. Орбита проходит через центр.", encoding="utf-8")
        (self.root / "Карта.pdf").touch()
        with server.connect() as db:
            db.execute("INSERT INTO memory(category,label) VALUES (?,?)", ("Знания", "Орбита Земли"))
            universe.scan(db, self.root)
            memory, file = universe.chat_search(db, "ОРБИТА")
            self.assertEqual(memory["group"], "Знания")
            self.assertEqual(file["group"], "Документы")
            self.assertIn("Орбита проходит через центр.", file["excerpt"])
            self.assertEqual(universe.chat_search(db, "карта")[0]["label"], "Карта.pdf")
            document.unlink()
            universe.scan(db, self.root)
            self.assertEqual(universe.chat_search(db, "орбита"), [memory])

    def test_rescan_preserves_identity(self):
        p=self.root/"sample.txt"
        p.write_text("hello",encoding="utf-8")
        with server.connect() as db:
            universe.scan(db,self.root)
            ident=universe.page(db,"Документы")["items"][0]["id"]
            p.unlink()
            universe.scan(db,self.root)
            self.assertEqual(universe.overview(db)["documents"],0)
            p.write_text("updated",encoding="utf-8")
            universe.scan(db,self.root)
            self.assertEqual(universe.page(db,"Документы")["items"][0]["id"],ident)
            self.assertTrue(universe.search_documents(db,"updated"))
