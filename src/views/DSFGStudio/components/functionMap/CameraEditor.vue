<script setup lang="ts">
import { downloadJsonFile } from "@/utils/download";
import { CameraClipValue, Clip } from "../../types/clip";
import { consola } from "consola";
import { Track } from "../../types/track";
import interact from "interactjs";
import { computed, onMounted, provide, reactive, ref } from "vue";
import { getEditor } from "../../utils/getEditorMap";

const SelectedClip = ref<Clip<any>>();

provide("SelectClip", SelectClip);

async function SelectClip(clip: Clip<any>) {
  SelectedClip.value = clip;
}

const editorWidth = 700;

const timelineDuration = computed(() => {
  let max = 0;

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const end = clip.start + clip.duration;

      if (end > max) max = end;
    }
  }

  // 给一点余量（可选）
  return Math.max(max, 20);
});

const timeline = reactive({
  duration: timelineDuration,

  viewStart: 0,
  viewEnd: 20,

  tracks: [
    {
      id: "Camera",
      name: "镜头轨道",
      clips: [
        { id: "a", start: 1, duration: 3, value: {} },
        { id: "b", start: 6, duration: 1, value: {} },
        { id: "c", start: 10, duration: 4, value: {} },
      ],
      type: "Camera",
    },
  ] as Track[],
});

const pxPerSecond = computed(() => {
  return editorWidth / (timeline.viewEnd - timeline.viewStart);
});

const nav = ref();
const leftHandle = ref();
const rightHandle = ref();

onMounted(() => {
  // 拖动视窗
  interact(nav.value).draggable({
    listeners: {
      move(event) {
        const deltaTime = (event.dx / editorWidth) * timeline.duration;

        timeline.viewStart += deltaTime;
        timeline.viewEnd += deltaTime;

        clampView();
      },
    },
  });

  // 左缩放
  interact(leftHandle.value).draggable({
    listeners: {
      move(event) {
        const delta = (event.dx / editorWidth) * timeline.duration;

        timeline.viewStart += delta;

        if (timeline.viewStart < 0) timeline.viewStart = 0;

        if (timeline.viewStart > timeline.viewEnd - 1)
          timeline.viewStart = timeline.viewEnd - 1;
      },
    },
  });

  // 右缩放
  interact(rightHandle.value).draggable({
    listeners: {
      move(event) {
        const delta = (event.dx / editorWidth) * timeline.duration;

        timeline.viewEnd += delta;

        if (timeline.viewEnd > timeline.duration)
          timeline.viewEnd = timeline.duration;

        if (timeline.viewEnd < timeline.viewStart + 1)
          timeline.viewEnd = timeline.viewStart + 1;
      },
    },
  });
});

function clampView() {
  if (timeline.viewStart < 0) {
    const diff = -timeline.viewStart;
    timeline.viewStart += diff;
    timeline.viewEnd += diff;
  }

  if (timeline.viewEnd > timeline.duration) {
    const diff = timeline.viewEnd - timeline.duration;
    timeline.viewStart -= diff;
    timeline.viewEnd -= diff;
  }
}

function createClip(track: Track, e: MouseEvent) {
  const time = timeline.viewStart + e.x / pxPerSecond.value;

  const newClip = {
    id: crypto.randomUUID(),
    start: time,
    duration: 1,
    value: {},
  } as Clip<any>;

  track.clips.push(newClip);
}

async function DelectClip() {
  for (const track of timeline.tracks) {
    const index = track.clips.findIndex((c) => c.id === SelectedClip.value?.id);
    if (index !== -1) {
      track.clips.splice(index, 1);
      return;
    }
  }
}

function clipsToStruct(clips: Clip<CameraClipValue>[]) {
  clips.sort((a, b) => a.start - b.start);
  return clips.map((clip, i, arr) => {
    const prev = arr[i - 1];

    const delay =
      i === 0 ? clip.start : clip.start - (prev.start + prev.duration);

    return {
      param_type: "Struct",
      value: {
        structId: "1077936156",
        type: "Struct",
        value: [
          { param_type: "Float", value: delay.toFixed(2) }, // 1 delay
          { param_type: "Float", value: clip.duration.toFixed(2) }, // 2 duration
          { param_type: "Int32", value: "0" }, // 3
          { param_type: "Vector3", value: "0,0,0" }, // 4
          { param_type: "Vector3", value: "0,0,0" }, // 5
          { param_type: "Vector3", value: "0,0,0" }, // 6
          { param_type: "Vector3", value: "0,0,0" }, // 7
          { param_type: "Entity", value: "0" }, // 8
          {
            param_type: "Float",
            value: clip.value.distance?.toString() ?? "0.00",
          }, // 9 distance
          { param_type: "Int32", value: clip.value.pointA?.toString() ?? "0" }, // 10 pointA
          { param_type: "Int32", value: clip.value.pointB?.toString() ?? "0" }, // 11 pointB
          {
            param_type: "Bool",
            value: clip.value?.isFollowRot ?? false ? "True" : "False",
          }, // 12
        ],
      },
    };
  });
}

async function Download() {
  consola.trace(timeline.tracks);
  const cameraTrack = timeline.tracks.find((q) => q.type == "Camera")!;

  const json = {
    structId: "1077936155",
    type: "Struct",
    value: [
      {
        param_type: "StructList",
        value: {
          structId: "1077936156",
          value: clipsToStruct(cameraTrack.clips as Clip<CameraClipValue>[]),
        },
      },
    ],
  };
  downloadJsonFile(json, "testfile.josn");
}
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 10px">
    <SectionLayout>
      <ActionButton v-on:update:selected="Download">下载</ActionButton>

      <ActionButton v-on:update:selected="DelectClip">删除片段</ActionButton>
      <div v-if="SelectedClip">
        <FormItemRow title="名称"
          ><input type="text" v-model="SelectedClip.name"
        /></FormItemRow>
        <FormItemRow title="开始时间"
          ><input type="number" v-model="SelectedClip.start" /></FormItemRow
        ><FormItemRow title="持续时间"
          ><input type="number" v-model="SelectedClip.duration"
        /></FormItemRow>
        <component
          :is="
            getEditor(
              timeline.tracks.find((q) =>
                q.clips.find((c) => c == SelectedClip),
              )?.type ?? 'Default',
            )
          "
          :clip="SelectedClip"
        /></div
    ></SectionLayout>
    <SectionLayout title="轨道区">
      <div class="timeline-editor">
        <!-- navigator -->
        <div style="display: flex">
          <div class="track-label-space"></div>
          <div class="navigator">
            <div class="bar" />

            <div
              ref="nav"
              class="view-window"
              :style="{
                left: (timeline.viewStart / timeline.duration) * 100 + '%',
                width:
                  ((timeline.viewEnd - timeline.viewStart) / timeline.duration >
                  1
                    ? 1
                    : (timeline.viewEnd - timeline.viewStart) /
                      timeline.duration) *
                    100 +
                  '%',
              }"
            >
              <div ref="leftHandle" class="handle left" />
              <div ref="rightHandle" class="handle right" />
            </div>
          </div>
        </div>

        <!-- tracks -->
        <TrackRow
          v-for="track in timeline.tracks"
          :key="track.id"
          :track="track"
          :viewStart="timeline.viewStart"
          :pxPerSecond="pxPerSecond"
          @createClip="createClip(track, $event)"
        /></div
    ></SectionLayout>
  </div>
</template>
