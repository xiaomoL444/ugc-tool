"""Run with Python 3.10+; Tkinter is included in standard Windows Python."""
from __future__ import annotations
import argparse
import html
import json
import tempfile
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from pathlib import Path
import webbrowser
from model import Document, FIELDS

class Editor:
    def __init__(self, root: tk.Tk, directory: Path | None = None):
        self.root = root
        self.doc = Document()
        self.selected = None
        self.dirty = False
        self.loading = False
        self.temp = tempfile.TemporaryDirectory(prefix="announcement-preview-")
        root.title("工具集 · 公告编辑器")
        root.geometry("1160x760")
        root.minsize(850, 580)
        style = ttk.Style()
        if "vista" in style.theme_names():
            style.theme_use("vista")
        toolbar = ttk.Frame(root, padding=10)
        toolbar.pack(fill="x")
        for label, command in [("新建公告集", self.new_document), ("打开目录", self.open_directory),
                               ("保存", self.save), ("导出上传 ZIP", self.export), ("预览正文", self.preview)]:
            ttk.Button(toolbar, text=label, command=command).pack(side="left", padx=3)
        self.status = tk.StringVar(value="新建公告集，或打开包含 index.json 的目录")
        ttk.Label(root, textvariable=self.status, padding=(14, 5)).pack(side="bottom", fill="x")
        panels = ttk.Panedwindow(root, orient="horizontal")
        panels.pack(fill="both", expand=True, padx=12, pady=6)
        sidebar = ttk.Frame(panels, padding=5)
        panels.add(sidebar, weight=1)
        ttk.Label(sidebar, text="公告列表 · 首项默认展开", padding=(0, 8)).pack(anchor="w")
        self.list = tk.Listbox(sidebar, width=28, exportselection=False, activestyle="dotbox",
                              font=("Microsoft YaHei UI", 10), borderwidth=0, selectbackground="#887bd7")
        self.list.pack(fill="both", expand=True)
        self.list.bind("<<ListboxSelect>>", self.on_select)
        buttons = ttk.Frame(sidebar)
        buttons.pack(fill="x", pady=8)
        for label, command in [("新增", self.add), ("删除", self.remove), ("↑", lambda: self.move(-1)), ("↓", lambda: self.move(1))]:
            ttk.Button(buttons, text=label, width=5, command=command).pack(side="left", padx=2)
        self.detail = ttk.Frame(panels, padding=(14, 4))
        panels.add(self.detail, weight=4)
        self.variables = {key: tk.StringVar() for key in FIELDS}
        labels = dict(id="唯一 ID", title="标题", date="日期（ISO）", revision="版本号", content="Markdown 路径")
        for row, key in enumerate(FIELDS):
            ttk.Label(self.detail, text=labels[key]).grid(row=row, column=0, sticky="w", pady=5)
            field = ttk.Entry(self.detail, textvariable=self.variables[key])
            field.grid(row=row, column=1, sticky="ew", padx=8, pady=5)
            self.variables[key].trace_add("write", self.on_change)
        ttk.Button(self.detail, text="版本 +1", command=self.bump).grid(row=3, column=2)
        ttk.Label(self.detail, text="正文变更后保存时自动递增数字版本号；公告 ID 建议保持不变。",
                  foreground="#6c6880").grid(row=5, column=0, columnspan=3, sticky="w", pady=8)
        mdbar = ttk.Frame(self.detail)
        mdbar.grid(row=6, column=0, columnspan=3, sticky="ew", pady=4)
        for label, before, after in [("标题", "## ", ""), ("加粗", "**", "**"),
                                     ("列表", "- ", ""), ("链接", "[", "](https://)"),
                                     ("代码块", "\n```\n", "\n```\n")]:
            ttk.Button(mdbar, text=label, width=6,
                       command=lambda a=before, b=after: self.insert_markup(a, b)).pack(side="left", padx=2)
        ttk.Button(mdbar, text="插入图片", command=self.image).pack(side="left", padx=2)
        textframe = ttk.Frame(self.detail)
        textframe.grid(row=7, column=0, columnspan=3, sticky="nsew")
        self.body = tk.Text(textframe, wrap="word", undo=True, font=("Consolas", 11),
                            padx=12, pady=12, borderwidth=1, relief="solid")
        scrollbar = ttk.Scrollbar(textframe, command=self.body.yview)
        self.body.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.body.pack(fill="both", expand=True)
        self.body.bind("<<Modified>>", self.on_body_change)
        self.detail.columnconfigure(1, weight=1)
        self.detail.rowconfigure(7, weight=1)
        root.bind("<Control-s>", lambda event: self.save())
        root.protocol("WM_DELETE_WINDOW", self.close)
        self.display(None)
        if directory:
            self.load(directory)

    def show_error(self, error):
        messagebox.showerror("操作未完成", str(error), parent=self.root)

    def on_change(self, *_):
        if not self.loading and self.selected is not None:
            self.dirty = True
            self.root.title("工具集 · 公告编辑器 *")

    def on_body_change(self, _=None):
        if self.body.edit_modified():
            self.on_change()
            self.body.edit_modified(False)

    def commit(self):
        if self.selected is not None:
            entry = self.doc.entries[self.selected]
            entry.metadata.update({key: value.get().strip() for key, value in self.variables.items()})
            entry.body = self.body.get("1.0", "end-1c")

    def refresh_list(self):
        self.list.delete(0, "end")
        for entry in self.doc.entries:
            self.list.insert("end", entry.metadata.get("title") or "（未命名公告）")
        if self.selected is not None:
            self.list.selection_set(self.selected)
            self.list.see(self.selected)

    def display(self, index):
        self.loading = True
        self.selected = index
        entry = self.doc.entries[index] if index is not None else None
        for key, value in self.variables.items():
            value.set(entry.metadata.get(key, "") if entry else "")
        self.body.configure(state="normal")
        self.body.delete("1.0", "end")
        self.body.insert("1.0", entry.body if entry else "")
        self.body.edit_reset()
        self.body.edit_modified(False)
        if not entry:
            self.body.configure(state="disabled")
        self.refresh_list()
        self.loading = False

    def on_select(self, _=None):
        selection = self.list.curselection()
        if selection and selection[0] != self.selected:
            self.commit()
            self.display(selection[0])

    def confirm_discard(self):
        if not self.dirty:
            return True
        answer = messagebox.askyesnocancel("未保存的修改", "是否先保存当前公告集？", parent=self.root)
        return self.save() if answer is True else answer is False

    def new_document(self):
        if self.confirm_discard():
            self.doc = Document()
            self.dirty = False
            self.display(None)
            self.add()
            self.status.set("新公告集：首次保存请选择一个空目录")

    def open_directory(self):
        if not self.confirm_discard():
            return
        folder = filedialog.askdirectory(title="选择包含 index.json 的公告目录", parent=self.root)
        if folder:
            self.load(Path(folder))

    def load(self, folder):
        try:
            doc = Document.load(folder)
            self.doc = doc
            self.dirty = False
            self.display(0 if doc.entries else None)
            self.root.title("工具集 · 公告编辑器")
            self.status.set(str(folder))
        except Exception as error:
            self.show_error(error)

    def add(self):
        self.commit()
        self.doc.add()
        self.display(0)
        self.on_change()

    def remove(self):
        if self.selected is None:
            return
        if messagebox.askyesno("删除公告", "从索引移除此公告？磁盘上的旧正文会保留。", parent=self.root):
            self.doc.entries.pop(self.selected)
            self.display(0 if self.doc.entries else None)
            self.dirty = True
            self.root.title("工具集 · 公告编辑器 *")

    def move(self, direction):
        if self.selected is None:
            return
        target = self.selected + direction
        if 0 <= target < len(self.doc.entries):
            self.commit()
            self.doc.entries[self.selected], self.doc.entries[target] = self.doc.entries[target], self.doc.entries[self.selected]
            self.display(target)
            self.on_change()

    def bump(self):
        if self.selected is not None:
            try:
                self.variables["revision"].set(str(int(self.variables["revision"].get()) + 1))
            except ValueError:
                self.show_error("版本号不是整数，请手动输入新的版本号。")

    def insert_markup(self, before, after):
        if self.selected is None:
            return
        try:
            text = self.body.get("sel.first", "sel.last")
            self.body.delete("sel.first", "sel.last")
        except tk.TclError:
            text = ""
        self.body.insert("insert", before + text + after)
        self.body.focus_set()

    def image(self):
        if self.selected is None:
            return
        self.commit()
        filename = filedialog.askopenfilename(title="选择公告图片", parent=self.root,
            filetypes=[("图片", "*.png *.jpg *.jpeg *.gif *.webp *.avif")])
        if filename:
            try:
                relative = self.doc.import_image(Path(filename), self.doc.entries[self.selected])
                self.insert_markup("![图片](" + relative + ")", "")
            except Exception as error:
                self.show_error(error)

    def save(self):
        self.commit()
        directory = self.doc.root
        if directory is None:
            folder = filedialog.askdirectory(title="选择公告保存目录（建议空目录）", parent=self.root)
            if not folder:
                return False
            directory = Path(folder)
        try:
            self.doc.save(directory)
            self.dirty = False
            self.display(self.selected)
            self.root.title("工具集 · 公告编辑器")
            self.status.set("已保存：" + str(directory) + " · 原文件备份位于 .backups")
            return True
        except Exception as error:
            self.show_error(error)
            return False

    def export(self):
        # Saving first keeps exported revisions and future edits consistent.
        if not self.save():
            return
        target = filedialog.asksaveasfilename(title="导出 OSS 上传包", defaultextension=".zip",
            initialfile="Announcements.zip", filetypes=[("ZIP 压缩包", "*.zip")], parent=self.root)
        if target:
            try:
                self.doc.export_zip(Path(target))
                self.status.set("已导出：" + target + " · 上传正文和图片后，再上传 index.json")
            except Exception as error:
                self.show_error(error)

    def preview(self):
        if self.selected is None:
            return
        self.commit()
        try:
            from markdown_it import MarkdownIt
        except ImportError:
            self.show_error("预览需安装可选依赖：\npython -m pip install -r tools/announcement_editor/requirements.txt\n编辑、保存和导出不需要额外依赖。")
            return
        entry = self.doc.entries[self.selected]
        try:
            self.doc.validate()
            # Render against an isolated copy, never write preview HTML into the upload directory.
            base = Path(self.temp.name)
            if self.doc.root:
                for source in self.doc.root.rglob("*"):
                    relative = source.relative_to(self.doc.root)
                    if source.is_file() and not source.is_symlink() and not any(p.startswith(".") for p in relative.parts) and source.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"):
                        dest = base / relative
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        dest.write_bytes(source.read_bytes())
            for name, data in self.doc.assets.items():
                dest = base / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
            page = base / (entry.metadata["content"] + ".html")
            page.parent.mkdir(parents=True, exist_ok=True)
            rendered = MarkdownIt("commonmark", {"html": False}).enable("table").render(entry.body)
            page.write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\'; frame-src \'none\'"><title>公告预览</title><style>body{max-width:850px;margin:40px auto;padding:0 24px;font:16px/1.8 system-ui;color:#35415d}img{max-width:100%}pre{overflow:auto;background:#f0eef7;padding:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px}blockquote{border-left:3px solid #887bd7;padding-left:16px}</style><h1>' + html.escape(entry.metadata["title"]) + '</h1>' + rendered, encoding="utf-8")
            webbrowser.open(page.as_uri())
        except Exception as error:
            self.show_error(error)

    def close(self):
        if self.confirm_discard():
            self.temp.cleanup()
            self.root.destroy()

def main():
    parser = argparse.ArgumentParser(description="工具集公告编辑器")
    parser.add_argument("directory", nargs="?", type=Path, help="包含 index.json 的公告目录")
    args = parser.parse_args()
    root = tk.Tk()
    Editor(root, args.directory)
    root.mainloop()

if __name__ == "__main__":
    main()
