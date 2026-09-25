"""Local announcement files compatible with the website OSS index."""
from __future__ import annotations
import json
import re
import shutil
import tempfile
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path, PurePosixPath

FIELDS = ("id", "title", "date", "revision", "content")

def safe_path(root: Path, relative: str) -> Path:
    if not relative or any(c in relative for c in "\\:%?#") or relative.startswith("/"):
        raise ValueError("文件路径必须是公告目录内的相对路径")
    if any(p in ("", ".", "..") for p in relative.split("/")):
        raise ValueError("文件路径不能包含空目录或 . / ..")
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("文件路径越出了公告目录")
    return path

@dataclass
class Entry:
    metadata: dict[str, str]
    body: str = ""
    saved_body: str | None = None
    saved_revision: str | None = None

@dataclass
class Document:
    entries: list[Entry] = field(default_factory=list)
    root: Path | None = None
    assets: dict[str, bytes] = field(default_factory=dict)
    snapshots: dict[str, bytes] = field(default_factory=dict)
    extras: dict = field(default_factory=dict)

    @classmethod
    def load(cls, root: Path) -> "Document":
        root = root.resolve()
        raw = (root / "index.json").read_bytes()
        data = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(data, dict) or not isinstance(data.get("announcements"), list):
            raise ValueError("index.json 必须包含 announcements 数组")
        doc = cls(root=root, snapshots={"index.json": raw},
                  extras={k: v for k, v in data.items() if k != "announcements"})
        for meta in data["announcements"]:
            if not isinstance(meta, dict):
                raise ValueError("公告索引条目必须是对象")
            doc.entries.append(Entry(dict(meta)))
        doc.validate()
        for entry in doc.entries:
            raw = safe_path(root, entry.metadata["content"]).read_bytes()
            entry.body = raw.decode("utf-8-sig")
            entry.saved_body = entry.body
            entry.saved_revision = entry.metadata["revision"]
            doc.snapshots[entry.metadata["content"]] = raw
        return doc

    def validate(self) -> None:
        ids, paths = set(), set()
        for entry in self.entries:
            m = entry.metadata
            if any(not isinstance(m.get(k), str) or not m[k].strip() for k in FIELDS):
                raise ValueError("ID、标题、日期、版本号和文件路径都不能为空")
            if m["id"] in ids:
                raise ValueError("公告 ID 重复：" + m["id"])
            if m["content"].casefold() in paths:
                raise ValueError("公告正文路径重复：" + m["content"])
            safe_path(self.root or Path.cwd(), m["content"])
            if not m["content"].lower().endswith(".md"):
                raise ValueError("正文文件必须以 .md 结尾")
            # Supports the website's ISO date and ISO timestamp formats.
            datetime.fromisoformat(m["date"].replace("Z", "+00:00"))
            ids.add(m["id"])
            paths.add(m["content"].casefold())

    def add(self) -> Entry:
        key = date.today().isoformat() + "-" + uuid.uuid4().hex[:6]
        entry = Entry(dict(id=key, title="新公告", date=date.today().isoformat(),
                           revision="1", content=key + ".md"), "## 更新内容\n\n- 在这里编写公告正文。\n")
        self.entries.insert(0, entry)
        return entry

    def prepare(self) -> None:
        self.validate()
        for entry in self.entries:
            if (entry.saved_body is not None and entry.body != entry.saved_body
                    and entry.metadata["revision"] == entry.saved_revision):
                old = entry.metadata["revision"]
                if not re.fullmatch(r"[0-9]+", old):
                    raise ValueError("正文已修改，请手动更新版本号：" + entry.metadata["title"])
                entry.metadata["revision"] = str(int(old) + 1)

    def payloads(self) -> dict[str, bytes]:
        self.prepare()
        data = {**self.extras, "announcements": [e.metadata for e in self.entries]}
        result = {e.metadata["content"]: e.body.encode("utf-8") for e in self.entries}
        result.update(self.assets)
        result["index.json"] = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        return result

    def save(self, root: Path) -> None:
        root = root.resolve()
        payloads = self.payloads()
        root.mkdir(parents=True, exist_ok=True)
        # Detect files changed by another editor before replacing them.
        for name, data in payloads.items():
            target = safe_path(root, name)
            if target.exists():
                previous = target.read_bytes()
                if root == self.root and name in self.snapshots:
                    if previous != self.snapshots[name]:
                        raise ValueError("文件已被其他程序修改，请重新打开后再编辑：" + name)
                elif previous != data:
                    raise ValueError("目标存在不同内容的同名文件，请选择空目录：" + name)
        backup = root / ".backups" / (datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6])
        # Write all contents to staging first; publish the index last.
        with tempfile.TemporaryDirectory(prefix=".announcement-", dir=root) as staging:
            staged_root = Path(staging)
            for name, data in payloads.items():
                target = safe_path(staged_root, name)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            for name, data in payloads.items():
                target = safe_path(root, name)
                if target.exists() and target.read_bytes() != data:
                    old = safe_path(backup, name)
                    old.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(target, old)
                target.parent.mkdir(parents=True, exist_ok=True)
                safe_path(staged_root, name).replace(target)
        self.root = root
        self.snapshots = payloads
        self.assets.clear()
        for entry in self.entries:
            entry.saved_body = entry.body
            entry.saved_revision = entry.metadata["revision"]

    def import_image(self, source: Path, entry: Entry) -> str:
        if source.suffix.lower() not in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"):
            raise ValueError("请选择 PNG、JPG、GIF、WebP 或 AVIF 图片")
        name = "images/" + uuid.uuid4().hex[:12] + source.suffix.lower()
        self.assets[name] = source.read_bytes()
        depth = len(PurePosixPath(entry.metadata["content"]).parts) - 1
        return "../" * depth + name

    def export_zip(self, target: Path) -> None:
        payloads = self.payloads()
        # Keep local image assets, excluding backups, other Markdown and index files.
        if self.root:
            for file in self.root.rglob("*"):
                relative = file.relative_to(self.root)
                if any(part.startswith(".") for part in relative.parts) or file.is_symlink():
                    continue
                if file.is_file() and file.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"):
                    safe_path(self.root, relative.as_posix())
                    payloads.setdefault(relative.as_posix(), file.read_bytes())
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in payloads.items():
                archive.writestr("Announcements/" + name, data)
