<script setup lang="ts">
import { computed, ref, onMounted, inject } from "vue";
import interact from "interactjs";
import { Clip } from "../types/clip";
import { Track } from "../types/track";
import { consola } from "consola";

const props = defineProps<{
  clip: Clip<any>;
  track: Track;
  viewStart: number;
  pxPerSecond: number;
}>();

// 发射事件给外部
const SelectClip = inject<(clip: Clip<any>) => void>("SelectClip")!;

function onClick() {
  if (SelectClip) {
    SelectClip(props.clip);
  }
}

const el = ref();
const leftHandle = ref();
const rightHandle = ref();

const left = computed(
  () => (props.clip.start - props.viewStart) * props.pxPerSecond + "px",
);
const width = computed(() => props.clip.duration * props.pxPerSecond + "px");

// 计算 Clip 可移动范围（不会碰到前后 Clip）
function computeRange() {
  let prev = null;
  let next = null;
  for (const c of props.track.clips) {
    if (c.id === props.clip.id) continue;

    // 找前邻居
    if (c.start <= props.clip.start) {
      if (!prev || c.start > prev.start + prev.duration) prev = c;
    }

    // 找后邻居
    if (c.start >= props.clip.start) {
      if (!next || c.start < next.start) next = c;
    }
  }

  return {
    min: prev ? prev.start + prev.duration : 0,
    max: next ? next.start : Infinity,
  };
}

onMounted(() => {
  // 拖动 Clip
  interact(el.value).draggable({
    listeners: {
      move(event) {
        const newStart = props.clip.start + event.dx / props.pxPerSecond;
        const range = computeRange();
        props.clip.start = Math.max(
          range.min,
          Math.min(range.max - props.clip.duration, newStart),
        );
      },
    },
  });

  // 左侧缩放
  interact(leftHandle.value).draggable({
    listeners: {
      move(event) {
        let delta = event.dx / props.pxPerSecond;
        let newStart = props.clip.start + delta;
        let newDuration = props.clip.duration - delta;

        if (newStart < 0) {
          newStart = 0;
          newDuration = props.clip.start + props.clip.duration;
        }

        // 限制不会穿透前面的 clip
        const range = computeRange();
        if (newStart < range.min) {
          newDuration -= range.min - newStart;
          newStart = range.min;
        }

        if (newDuration < 0.1) newDuration = 0.1;

        props.clip.start = newStart;
        props.clip.duration = newDuration;
      },
    },
  });

  // 右侧缩放
  interact(rightHandle.value).draggable({
    listeners: {
      move(event) {
        let delta = event.dx / props.pxPerSecond;
        let newDuration = props.clip.duration + delta;
        props.clip.duration = newDuration;
        // 限制不会穿透下一个 clip
        const range = computeRange();
        const maxDur = range.max - props.clip.start;
        consola.trace(maxDur);
        if (newDuration > maxDur) newDuration = maxDur;
        if (newDuration < 0.1) newDuration = 0.1;

        props.clip.duration = newDuration;
      },
    },
  });
});
</script>

<template>
  <div
    ref="el"
    class="clip"
    :style="{ left, width }"
    @click.stop="onClick"
  >
    {{ clip.name }}
    <div ref="leftHandle" class="handle left"></div>
    <div ref="rightHandle" class="handle right"></div>
  </div>
</template>

<style scoped>
.clip {
  position: absolute;
  top: 7px;
  height: 36px;
  background: #f5c842;
  color: black;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: move;
  user-select: none;
  box-sizing: border-box;
}

.handle {
  position: absolute;
  width: 6px;
  top: 0;
  bottom: 0;
  background: #ff9900;
  cursor: ew-resize;
}

.left {
  left: 0;
}

.right {
  right: 0;
}
</style>
