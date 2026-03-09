<template>
  <Splitter style="height: 100%; width: 100%">
    <SplitterPanel>
      <SectionLayout title="选择音效 ">
        <Splitter style="height: 100%; width: 100%" layout="vertical">
          <SplitterPanel :size="4">
            <div
              style="display: flex; flex-direction: row; align-items: center"
            >
              <div style="width: 200px">搜索（可搜索id）：</div>
              <input v-model="search" />
            </div>
          </SplitterPanel>

          <SplitterPanel :size="94">
            <VVirtualList :items="rows" :item-size="110" style="height: 100%">
              <template
                #default="{
                  item: row,
                  index,
                }: {
                  item: rowType,
                  index: number,
                }"
              >
                <div
                  :ref="(el) => {itemRefs[index] = el as HTMLDivElement}"
                  style="
                    display: flex;
                    flex-direction: row;
                    gap: 5px;
                    margin-bottom: 5px;
                    height: 100px;
                  "
                >
                  <ListButton
                    v-for="(id, index) in row.data"
                    :key="index"
                    :is-selected="id == selectedId"
                    v-on:update:selected="SelectSound(id)"
                  >
                    <div class="item">
                      <div class="title">
                        {{ dataJson[id].name }}
                      </div>
                      <div class="subtitle">
                        id:{{ id }} / {{ dataJson[id].duration }}s
                      </div>
                    </div>
                  </ListButton>
                </div>
              </template>
            </VVirtualList>
          </SplitterPanel></Splitter
        >
      </SectionLayout></SplitterPanel
    >
    <SplitterPanel>
      <SectionLayout title="播放器">
        <div class="player">
          <span>音效名称：{{ dataJson[selectedId]?.name }}</span
          ><span> 音效id：{{ selectedId }}</span>
          <ActionButton v-on:update:selected="togglePlay">{{
            playing ? "暂停" : "播放"
          }}</ActionButton>
          <ActionButton v-on:update:selected="prevTrack">上一首</ActionButton>
          <ActionButton v-on:update:selected="nextTrack">下一首</ActionButton>

          <!-- 时间进度 -->
          <div>
            <span v-if="!loading"
              >{{ formatTime(currentTime) }}/{{ formatTime(duration) }}</span
            >
            <span v-else>{{ formatTime(currentTime) }}/加载中...</span>
            <input
              type="range"
              :max="duration"
              step="0.1"
              v-model.number="currentTime"
              @input="seek"
            />
          </div>

          <!-- 播放速度 -->
          <div>
            <label>速度: {{ speed }}x</label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              v-model.number="speed"
              @input="changePlaybackRate"
            />
          </div>

          <!-- 音量 0~200% -->
          <div>
            <label>音量: {{ Math.round(volume * 100) }}%</label>
            <div v-if="volume > 1.0">
              (实际编辑器内音量不可大于100%，此处只为放大预览用)
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              v-model.number="volume"
              @input="changeVolume"
            />
          </div>

          <div
            style="
              text-align: center;
              align-items: center;
              display: flex;
              flex-direction: row;
            "
          >
            <!-- iOS风格开关 -->
            <label class="switch">
              <input
                type="checkbox"
                v-model="loopEnabled"
                @change="toggleLoop"
              />
              <span class="slider"></span>
            </label>
            <div>是否开启循环播放</div>
          </div>
          <div
            v-if="loopEnabled"
            style="margin-top: 10px; display: flex; flex-direction: row"
          >
            <div>循环间隔时间(s)</div>
            <input type="number" v-model="interval" />
          </div>

          <!-- 音频元素 -->
          <audio
            ref="audioRef"
            @timeupdate="updateTime"
            @loadedmetadata="loadMetadata"
            :src="audioSource"
            @ended="ended"
          ></audio>
        </div> </SectionLayout
    ></SplitterPanel>
  </Splitter>
</template>

<style scoped>
@import "./styles/iosCheckBoc.css";
.item {
  text-align: left;
  width: 100%;
  margin: 10px 6px;
}
.item .title {
  font-size: 1.2rem;
}

.item .subtitle {
  width: 10rem;
  word-wrap: break-word;
  /* 老方法 */
  overflow-wrap: break-word;
  /* 新方法 */

  border-radius: 10px;
  border: 1px solid #cdcdcd;

  padding: 10px;
  margin-top: 0.5rem;

  font-size: 0.8rem;

  display: flex;
  background-color: #f0f1f5cc;
}

input[type="range"] {
  width: 100%;
}

.player {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 400px;
  margin: 20px auto;
}
</style>

<script setup lang="ts">
import SectionLayout from "@/components/Layout/SectionLayout.vue";

import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";

import { computed, onMounted, ref, watch } from "vue";

const itemRefs = ref<HTMLDivElement[]>([]); // 存每个 div 的 DOM 元素

import data from "@/assets/SoundEffectPlayer/SoundEffectData.json";
import { SoundEffectData } from "./types/SoundEffectData";
import { VVirtualList } from "vueuc";
import ListButton from "@/components/button/ListButton.vue";
import { toast } from "vue-sonner";
import ActionButton from "@/components/button/ActionButton.vue";
import axios from "axios";
import { consola } from "consola";

const ProjectName = "SoundEffectPlayer";

const selectedId = ref("未选择"); //选择的音效id

const search = ref("");

const audioSource = ref("");

const loading = ref(false);

const loopEnabled = ref(false);
const interval = ref(0);

const keys = computed(() =>
  Object.keys(dataJson).filter((key) => {
    const value = dataJson[key];
    return value.name.includes(search.value) || value.id.includes(search.value);
  }),
);

const count = 4;

const rows = computed(() => {
  let result = [];
  for (let i = 0; i < keys.value.length; i += count) {
    result.push(keys.value.slice(i, i + count));
  }
  result = result.map((r, i) => ({ id: i.toString(), data: r }));
  return result;
});

interface rowType {
  id: string;
  data: string[];
}

const dataJson: SoundEffectData = data;

onMounted(async () => {
  dataJson.value = (await axios.get(`/data/${ProjectName}/data.json`)).data;
});

const musicList = computed(() =>
  keys.value.map((x) => `${process.env.BASE_URL}sound/${x}.mp3`),
);

const currentID = ref("");
const current_index = ref(0);

// 监听 currentId 变化，滚动到可视
watch(currentID, (newId) => {
  const index = Math.floor(keys.value.indexOf(newId) / 3);
  console.log(index);
  if (index !== -1 && itemRefs.value[index]) {
    itemRefs.value[index].scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }
});

watch(current_index, (new_index) => {
  currentID.value = keys.value[new_index];
});

function SelectSound(id: string) {
  console.log(`选择了${id}`);
  selectedId.value = id;
  audioSource.value = "";
  audioSource.value = `/data/${ProjectName}/audio/${id}.mp3`;
  loading.value = true;
  audioRef.value?.load();
}

// const currentIndex = defineModel();
const audioRef = ref<HTMLAudioElement | null>(null);
const playing = ref(false);
const volume = ref(1);
const speed = ref(1);

const currentTrack = defineModel();
const currentTime = ref(0);
const duration = ref(0);

let timer: ReturnType<typeof setTimeout> | null = null;

function toggleLoop() {
  if (!audioRef.value) return;

  if (!loopEnabled.value) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
}

// 播放 / 暂停
function togglePlay() {
  if (playing.value) {
    stop();
  } else {
    start();
  }
}

function start() {
  if (!audioRef.value) return;
  audioRef.value.play().catch(() => {
    toast.warning(`播放失败`);
  });
  playing.value = true;
}
function stop() {
  if (!audioRef.value) return;
  audioRef.value.pause();
  playing.value = false;
}

// 上一首 / 下一首
function prevTrack() {
  const index = keys.value.indexOf(selectedId.value);

  selectedId.value =
    keys.value[(index - 1 + keys.value.length) % keys.value.length];
}

function nextTrack() {
  const index = keys.value.indexOf(selectedId.value);

  selectedId.value = keys.value[(index + 1) % keys.value.length];
}

// 时间控制
function seek() {
  if (!audioRef.value) return;
  audioRef.value.currentTime = currentTime.value;
}

function updateTime() {
  if (!audioRef.value) return;
  currentTime.value = audioRef.value.currentTime;
}

function loadMetadata() {
  if (!audioRef.value) return;
  duration.value = audioRef.value.duration;
  loading.value = false;
  changePlaybackRate();
  start();
}

// 播放速度
function changePlaybackRate() {
  if (!audioRef.value) return;
  audioRef.value.playbackRate = speed.value;
}

// 音量 0~2，通过 GainNode
function changeVolume() {
  if (!audioRef.value) return;
  const v = Number(volume.value);
  if (isNaN(v) || !isFinite(v)) return;
  audioRef.value.volume = volume.value;
}

// 格式化时间 mm:ss
function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function ended() {
  if (!audioRef.value) return;
  audioRef.value.currentTime = 0;
  playing.value = false;
  if (!loopEnabled.value) return;

  timer = setTimeout(() => {
    start();
  }, interval.value * 1000);
}
</script>
