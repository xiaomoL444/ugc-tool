<template>
  <ul>
    <li v-for="node in nodes" :key="node.path">
      
      <span v-if="node.type === 'folder'">
        📁 {{ node.name }}
      </span>

      <span v-else>
        📄 {{ node.name }}
      </span>

      <FileTree
        v-if="node.children && node.children.length"
        :nodes="node.children"
      />
      
    </li>
  </ul>
</template>

<script setup lang="ts">
defineProps<{
  nodes: any[]
}>()
</script>