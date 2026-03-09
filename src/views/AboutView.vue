<script setup lang="ts">
import { VVirtualList } from "vueuc"

type Row = {
  id: string
  data: string[]
}

const rows: Row[] = [
  { id: "1", data: ["a", "b", "c"] },
  { id: "2", data: ["d", "e"] }
]

const itemHeight = 120
</script>

<template>
  <VVirtualList
    :items="rows"
    :item-size="itemHeight"
    style="height: 400px"
  >
    <template #default="{ item, index }">
      <div class="selectBox">
        {{ item.id }}
      </div>
    </template>
  </VVirtualList>
</template>