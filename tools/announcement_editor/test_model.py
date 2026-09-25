import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from model import Document, safe_path

class DocumentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "Announcements"
    def tearDown(self):
        self.temp.cleanup()
    def test_roundtrip_revision_backup_and_export(self):
        doc = Document()
        entry = doc.add()
        entry.metadata["title"] = "中文公告"
        entry.body = "## 第一版\n"
        doc.save(self.root)
        loaded = Document.load(self.root)
        self.assertEqual(loaded.entries[0].body, entry.body)
        loaded.entries[0].body = "## 第二版\n"
        loaded.save(self.root)
        self.assertEqual(loaded.entries[0].metadata["revision"], "2")
        loaded.save(self.root)
        self.assertEqual(loaded.entries[0].metadata["revision"], "2")
        self.assertTrue(list((self.root / ".backups").rglob("index.json")))
        target = self.root.parent / "export.zip"
        loaded.export_zip(target)
        with zipfile.ZipFile(target) as archive:
            data = json.loads(archive.read("Announcements/index.json"))
            self.assertEqual(data["announcements"][0]["revision"], "2")
            self.assertFalse(any(".backups" in name for name in archive.namelist()))
    def test_validation_and_external_edit(self):
        doc = Document()
        entry = doc.add()
        doc.save(self.root)
        (self.root / entry.metadata["content"]).write_text("外部修改", encoding="utf-8")
        entry.body = "编辑器修改"
        with self.assertRaisesRegex(ValueError, "其他程序"):
            doc.save(self.root)
        self.assertEqual((self.root / entry.metadata["content"]).read_text(encoding="utf-8"), "外部修改")
        for name in ("../x.md", "/x.md", "x/../../y.md", "x\\y.md", "x/%2e.md"):
            with self.assertRaises(ValueError):
                safe_path(self.root, name)
    def test_duplicate_and_missing_file(self):
        doc = Document()
        first = doc.add()
        second = doc.add()
        second.metadata["id"] = first.metadata["id"]
        with self.assertRaises(ValueError):
            doc.save(self.root)
        second.metadata["id"] = "other"
        doc.save(self.root)
        (self.root / first.metadata["content"]).unlink()
        with self.assertRaises(FileNotFoundError):
            Document.load(self.root)
    def test_images_nested_body_and_empty_index(self):
        doc = Document()
        entry = doc.add()
        entry.metadata["content"] = "posts/test.md"
        image = self.root.parent / "photo.png"
        image.write_bytes(b"test image")
        relative = doc.import_image(image, entry)
        self.assertTrue(relative.startswith("../images/"))
        doc.save(self.root)
        target = self.root.parent / "images.zip"
        doc.export_zip(target)
        with zipfile.ZipFile(target) as archive:
            self.assertTrue(any(name.startswith("Announcements/images/") for name in archive.namelist()))
        doc.entries.clear()
        doc.save(self.root)
        self.assertEqual(Document.load(self.root).entries, [])
        self.assertTrue((self.root / "posts/test.md").exists())
    def test_custom_revision_and_metadata_preserved(self):
        doc = Document()
        entry = doc.add()
        entry.metadata["revision"] = "v1"
        entry.metadata["custom"] = "keep"
        doc.extras["custom"] = {"enabled": True}
        doc.save(self.root)
        entry.body += "changed"
        with self.assertRaisesRegex(ValueError, "手动更新"):
            doc.save(self.root)
        entry.metadata["revision"] = "v2"
        doc.save(self.root)
        loaded = Document.load(self.root)
        self.assertEqual(loaded.entries[0].metadata["custom"], "keep")
        self.assertEqual(loaded.extras["custom"], {"enabled": True})
    def test_new_folder_collision(self):
        doc = Document()
        doc.add()
        self.root.mkdir()
        (self.root / "index.json").write_text("existing", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "同名文件"):
            doc.save(self.root)

if __name__ == "__main__":
    unittest.main()
