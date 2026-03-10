<template>
  <div class="container">
    <button v-on:click="clear">删除数据</button>
    <FileTree :nodes="tree" />
  </div>
</template>

<script setup lang="ts">
import FileTree from "./components/FileTree.vue";

defineProps<{
  nodes: any[];
}>();

import fs, { configureSingle } from "@zenfs/core";
import { IndexedDB } from "@zenfs/dom";

type FileNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
};

import { inject, onMounted, ref } from "vue";

const tree = ref<FileNode[]>([]);
onMounted(async () => {
  await configureSingle({ backend: IndexedDB });

  const root = await buildFileTree("/");
  if (root.children) tree.value = root.children;
});

async function buildFileTree(path: string = "/"): Promise<FileNode> {
  const entries = await list(path);

  const node: FileNode = {
    name: path === "/" ? "/" : path.split("/").pop()!,
    path,
    type: "folder",
    children: [],
  };

  for (const entry of entries) {
    const fullPath = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`;

    if (entry.type === "folder") {
      const child = await buildFileTree(fullPath);
      node.children!.push(child);
    } else {
      node.children!.push({
        name: entry.name,
        path: fullPath,
        type: "file",
      });
    }
  }

  return node;
}

async function list(path: string) {
  const entries = await fs.promises.readdir(path, { withFileTypes: true });

  return entries.map((e) => ({
    name: e.name,
    type: e.isDirectory() ? "folder" : "file",
  }));
}

async function clear() {
 await  fs.promises.rm("/", { recursive: true });
}
</script>

<style lang="css" scoped>
.container {
  text-align: left;
  overflow-y: scroll;
}
</style>
