<script setup lang="ts">
import PanelLayout from "@/components/Layout/PanelLayout.vue";
import SectionLayout from "@/components/Layout/SectionLayout.vue";
import { consola } from "consola";
import chroma from "chroma-js";
import {
  NCollapse,
  NCollapseItem,
  NColorPicker,
  NEllipsis,
  NIcon,
  NRadio,
  NRadioGroup,
  NSpace,
  NSwitch,
} from "naive-ui";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";
import {
  computed,
  inject,
  onBeforeMount,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { toast } from "vue-sonner";
import ActionButton from "@/components/button/ActionButton.vue";
import { StorageClass } from "@/services/storage/storage";
import axios from "axios";
import { lcm } from "./utils/math";
import FormItemRow from "./components/form-item-row.vue";

const isSetColor = ref(true);
const isUse4bit = ref(false);
const isUseSize = ref(false);
const isSkipSpace = ref(false);

const displayBGClolrList = ["#333333", "#000000", "#7E7E7EFF", "#FFF", "#FFF0"];
const displayBGColorIndex = ref(0);

const colors = ref([RandomColor(), RandomColor()]);
const sizes = ref<number[]>([20, 20]);

const selectedColorStyle = ref<ColorStyleType>("normal");
const colorStyles = ref<ColorStyle[]>([
  { id: "normal", label: "普通" },
  { id: "ColorFlow1", label: "流动1" },
  { id: "ColorFlow2", label: "流动2" },
]);

const selectedSizeStyle = ref<SizeStyleType>("normal");
const sizeStyle = ref<SizeStyle[]>([
  { id: "normal", label: "普通" },
  { id: "Jump1", label: "跳字(没什么用)" },
]);
const gradientStyle = computed(
  () => `linear-gradient(to right, ${colors.value.join(",")})`,
);

//动效设置区
const colorJumpFrames = ref(0); //颜色跳帧
const sizeJumpFrames = ref(0); //大小跳帧

/**
 * 0:最小值
 * 1:最大值
 */
const sizeParams = ref([20, 40, 0, 0, 0, 0, 0, 0, 0, 0]); //大小的参数

const storage = inject<StorageClass>("storage")!.setProject("文本渐变器"); //储存区

const config = ref<config[]>([]);

async function AddConfig() {
  const name = prompt("输入一个配置名（不可重复）");
  const filePath = `/${name}.json`;
  if (!name) return;
  if (name == "") {
    toast.warning("名字为空，无法保存");
    return;
  }
  if (await storage.exists(filePath)) {
    toast.warning("存在同名的配置，无法添加");
    return;
  }
  const newConfig = {
    colors: colors.value,
    sizes: sizes.value,
    text: text.value,
    title: name,
    option: {
      isSetColor: isSetColor.value,
      isUse4bit: isUse4bit.value,
      isUseSize: isUseSize.value,
      isSkipSpace: isSkipSpace.value,
    } as option,
  } as config;
  consola.trace(JSON.stringify(newConfig));
  await storage.writeFile(filePath, JSON.stringify(newConfig));
  await RefreshConfig();
}

async function DeleteConfig(name: string) {
  consola.trace("123");
  if (!confirm(`是否要删除「${name}」配置`)) return;

  const path = `/${name}.json`;
  await storage.trash(path);
  await RefreshConfig();
}

//读取部分
async function SelectPresetCard(title: string) {
  const _config = config.value.find((q) => q.title == title);
  if (!_config) {
    toast.warning("数据不存在！");
    return;
  }
  toast.info(`读取预设「${title}」`);
  colors.value = _config.colors.slice();
  sizes.value = _config.sizes.slice();
  isSetColor.value = _config.option.isSetColor;
  isUse4bit.value = _config.option.isUse4bit;
  isUseSize.value = _config.option.isUseSize;
  isSkipSpace.value = _config.option.isSkipSpace;
  if (text.value == "") {
    text.value = _config.text;
  }
}
async function RefreshConfig() {
  const files = await storage.getFiles(`/`);
  config.value = await Promise.all(
    files
      .filter((q) => q.endsWith(`.json`))
      .map(async (name) => {
        return JSON.parse(await storage.readFile(`/${name}`)) as config;
      }),
  );
}

onBeforeMount(async () => {
  //如果是第一次来就添加预设配置
  if (!(await storage.exists("/"))) {
    const presetFiles = [
      "预设配置1.json",
      "预设配置2.json",
      "预设配置3.json",
      "预设配置4.json",
      "预设配置5.json",
    ];
    await Promise.all(
      await presetFiles.map(async (fileName) => {
        await storage.writeFile(
          `/${fileName}`,
          JSON.stringify(
            (
              await axios.get(`/data/TextGradient/${fileName}`)
            ).data,
          ),
        );
      }),
    );
  }
  await RefreshConfig();
});

function onColorChange(event: Event, index: number) {
  let value = (event.target as HTMLInputElement).value;
  try {
    colors.value[index] = chroma(value).hex();
  } catch (error) {
    colors.value[index] = "#FFFFFF";
  }
}

function MoveColorNumber(index1: number, index2: number) {
  consola.trace(index2);
  [colors.value[index1], colors.value[index2]] = [
    colors.value[index2],
    colors.value[index1],
  ];
}

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function RandomColor() {
  const color = chroma([
    getRandomInt(0, 255),
    getRandomInt(0, 255),
    getRandomInt(0, 255),
  ]);
  return color.hex();
}

function SetRandomColor(index: number) {
  colors.value[index] = RandomColor();
}

function AddColor(index: number) {
  colors.value.splice(index, 0, RandomColor());
}

function DeleteColor(index: number) {
  consola.trace(index);
  colors.value.splice(index, 1);
}
const text = ref(""); //用户输入的文字

const chars = computed(() => text.value.split("")); //拆分的字符

function to4Bit(v: number) {
  return Math.round((v / 255) * 15); // 0~15
}
/**
 * rgba -> hex，支持4bit/8bit，保留透明度
 * @param rgbaStr 'rgba(240,240,240,1.00)'
 * @param bitDepth 4 | 8
 * @returns 4bit: #RGBA, 8bit: #RRGGBBAA
 */
function applyColorChannels(chroma: chroma.Color): string {
  let r = chroma.rgb()[0];
  let g = chroma.rgb()[1];
  let b = chroma.rgb()[2];
  let a = chroma.alpha();

  r = to4Bit(r); // 255 -> 15 -> 'F'
  g = to4Bit(g);
  b = to4Bit(b);
  a = to4Bit(a * 255); // alpha 0~1 -> 0~15
  // 转单字符 hex
  const toHex = (v: number) => v.toString(16);

  return `#${toHex(r)}${toHex(g)}${toHex(b)}${a == 15 ? "" : toHex(a)}`;
}

// 线性插值
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

//这个是颜色的帧
const colorFrames = computed<chroma.Color[][]>(() => {
  let list: chroma.Color[][] = [];
  let frames: chroma.Color[] = [];

  let length = chars.value.length;
  let frameSpeed = Math.max(1, colorJumpFrames.value + 1);
  for (let i = 0; i < length; i++) {
    let t = i / (length - 1);
    t = Number.isNaN(t) ? 0 : t;

    frames.push(chroma.scale(colors.value)(t));
  }

  switch (selectedColorStyle.value) {
    case "normal":
      if (chars.value.length != 0) list.push(frames);
      break;
    case "ColorFlow1":
      const frames2 = [
        ...frames,
        ...frames.slice(1, frames.length).reverse(),
        ...frames.slice(1, frames.length),
      ];
      for (let i = 0; i < length * 2 - 2; i += frameSpeed) {
        list.push(frames2.slice(i, i + length));
      }
      break;
    case "ColorFlow2":
      const frames3 = [
        ...frames,
        ...frames.slice(1, frames.length).reverse(),
        ...frames.slice(1, frames.length),
      ];
      consola.trace(frames3.length);
      for (let i = length * 2 - 2; i > 0; i -= frameSpeed) {
        list.push(frames3.slice(i, i + length));
      }
      break;
  }
  return list;
});

//这个是size的帧
const sizeFrams = computed<number[][]>(() => {
  let list: number[][] = [];
  let frames: number[] = [];

  let length = chars.value.length;

  switch (selectedSizeStyle.value) {
    case "normal":
      for (let i = 0; i < length; i++) {
        let t = i / (length - 1);
        t = Number.isNaN(t) ? 0 : t;

        // 大小插值
        const sizeSegs = sizes.value.length - 1;
        const sSeg = Math.min(Math.floor(t * sizeSegs), sizeSegs - 1);
        const sT = t * sizeSegs;
        const size = lerp(
          sizes.value[sSeg],
          sizes.value[sSeg + 1] || sizes.value[sSeg],
          sT,
        );
        frames.push(size);
      }
      if (chars.value.length != 0) list.push(frames);
      break;
    case "Jump1":
      if (colorFrames) {
        for (let i = 0; i < colorFrames.value.length; i++) {
          const frame: number[] = [];
          for (let index = 0; index < length; index++) {
            frame.push(20);
          }
          for (let count = 0; count < 50; count++) {
            frame[getRandomInt(0, frame.length - 1)] = getRandomInt(
              sizeParams.value[0],
              sizeParams.value[1],
            );
          }
          list.push(frame);
        }
      }
      break;
  }
  consola.trace(list);
  return list;
});

//这个是循环的帧数
const frameCount = computed(() => {
  consola.trace(0);
  return lcm(colorFrames.value.length, sizeFrams.value.length);
});

const currentFrame = ref(0); //当前的帧，会在游戏开始后随时间自增
let timer: ReturnType<typeof setInterval>;
const interval = ref(50);
function startTimer() {
  clearInterval(timer);

  timer = setInterval(() => {
    currentFrame.value++;
  }, interval.value);
}

watch(interval, () => {
  startTimer();
});

onMounted(() => {
  startTimer();
});
onUnmounted(() => {
  if (timer) {
    clearInterval(timer);
  }
});

function getCharList(frame: number) {
  let result: string[] = [];
  let line: number = 0;
  chars.value.forEach((char, index) => {
    if (result.length <= line) {
      result.push("");
    }

    let word = char;

    if (isSetColor.value)
      //如果选择了颜色
      word = `<color=${
        isUse4bit.value
          ? applyColorChannels(
              colorFrames.value[frame % colorFrames.value.length][index],
            )
          : colorFrames.value[frame % colorFrames.value.length][index].hex()
      }>${char}</color>`;
    if (isUseSize.value) {
      //如果选择了使用大小
      word = `<size=${
        sizeFrams.value[frame % sizeFrams.value.length][index]
      }>${word}</size>`;
    }
    if (word.length + result[line].length > 999) {
      line++;
      result.push("");
    }
    result[line] += word;
  });

  return result;
}
function Clipboard(str: string) {
  navigator.clipboard
    .writeText(str)
    .then(() => {
      const length = 50;
      const text = str.length > length ? str.substring(0, length) + "..." : str;
      toast.success(` ${text} 复制成功`);
    })
    .catch((err) => {
      toast.error("复制失败" + err);
    });
}
</script>

<template>
  <Splitter style="height: 100%; width: 100%">
    <SplitterPanel :size="15">
      <SectionLayout title="预设">
        <ActionButton v-on:update:selected="AddConfig"
          ><div style="font-size: 1rem; color: white">
            添加预设
          </div></ActionButton
        >
        <div
          style="
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 10px;
          "
        >
          <div v-for="(item, index) in config" :key="index" style="width: 100%">
            <PanelLayout>
              <button class="preset-card" @click="SelectPresetCard(item.title)">
                <div class="delete-button">
                  <ActionButton
                    style="background-color: #ff7b7b"
                    v-on:update:selected="DeleteConfig(item.title)"
                  >
                    <!-- prettier-ignore -->
                    <NIcon :size="12">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512"><path d="M289.94 256l95-95A24 24 0 0 0 351 127l-95 95l-95-95a24 24 0 0 0-34 34l95 95l-95 95a24 24 0 1 0 34 34l95-95l95 95a24 24 0 0 0 34-34z" fill="currentColor"></path></svg></NIcon>
                  </ActionButton>
                </div>
                <div
                  ref="颜色"
                  :style="{
                    background: `linear-gradient(to right, ${item.colors.join(
                      ',',
                    )})`,
                  }"
                  style="
                    width: 120%;
                    height: 100%;
                    position: relative;
                    left: -10px;
                  "
                ></div>
              </button>
              <div
                style="
                  display: flex;
                  flex-direction: row;
                  justify-content: space-between;
                  justify-items: center;
                  align-items: center;
                "
              >
                <div
                  style="text-align: left; padding-left: 10px; font-size: 15px"
                >
                  {{ item.title }}
                </div>
              </div>
            </PanelLayout>
          </div>
        </div>
      </SectionLayout>
    </SplitterPanel>
    <SplitterPanel
      :size="15"
      style="display: flex; flex-direction: column; gap: 5px"
    >
      <SplitterPanel style="flex: 3">
        <SectionLayout title="选项卡">
          <FormItemRow title="颜色过渡"
            ><NSwitch v-model:value="isSetColor"
          /></FormItemRow>
          <FormItemRow title="4bit输出"
            ><NSwitch v-model:value="isUse4bit"
          /></FormItemRow>
          <FormItemRow title="缩放大小"
            ><NSwitch v-model:value="isUseSize"
          /></FormItemRow>
          <div v-if="isUseSize">
            <FormItemRow title="最小size">
              <input type="number" step="1" v-model="sizes[0]"
            /></FormItemRow>
            <FormItemRow title="最大size">
              <input type="number" step="1" v-model="sizes[1]"
            /></FormItemRow>
          </div>
          <!-- 是否忽略空格<NSwitch v-model:value="isSkipSpace" /> -->
        </SectionLayout>
      </SplitterPanel>
      <SplitterPanel style="flex: 7">
        <SectionLayout title="动效">
          <FormItemRow title="流速"
            ><input type="number" v-model="interval"
          /></FormItemRow>
          <div>—— 颜色 ——</div>
          <FormItemRow title="颜色跳帧"
            ><input type="number" v-model="colorJumpFrames"
          /></FormItemRow>
          <NRadioGroup
            v-model:value="selectedColorStyle"
            name="radiogroup"
            size="large"
          >
            <NSpace vertical align="start">
              <n-radio
                v-for="style in colorStyles"
                :key="style.id"
                :value="style.id"
              >
                {{ style.label }}
              </n-radio>
            </NSpace>
          </NRadioGroup>
          <div>—— 大小 ——</div>
          <FormItemRow title="大小跳帧"
            ><input type="number" v-model="sizeJumpFrames"
          /></FormItemRow>
          <FormItemRow
            title="最小值"
            v-if="['Jump1'].includes(selectedSizeStyle)"
            ><input type="number" v-model="sizeParams[0]"
          /></FormItemRow>
          <FormItemRow
            title="最大值"
            v-if="['Jump1'].includes(selectedSizeStyle)"
            ><input type="number" v-model="sizeParams[1]"
          /></FormItemRow>
          <NRadioGroup
            v-model:value="selectedSizeStyle"
            name="sizegroup"
            size="large"
          >
            <NSpace vertical align="start">
              <n-radio
                v-for="style in sizeStyle"
                :key="style.id"
                :value="style.id"
              >
                {{ style.label }}
              </n-radio>
            </NSpace>
          </NRadioGroup>
        </SectionLayout>
      </SplitterPanel>
    </SplitterPanel>
    <SplitterPanel :size="70">
      <SectionLayout title="预览、输出区域">
        <div style="display: flex; flex-direction: column; gap: 0">
          <div
            style="
              height: 250px;
              width: 100%;
              position: relative;
              border-radius: 10px;
            "
          >
            <div :hidden="colors.length >= 5">
              <button
                ref="左边的加号"
                class="addButton"
                style="left: 0; border-radius: 0 100% 100% 0"
                v-on:click="AddColor(0)"
              >
                < <img src="@/assets/svg/Add12Filled.svg" alt="svg图标" />>
              </button>
              <button
                ref="右边的加号"
                class="addButton"
                style="right: 0; border-radius: 100% 0 0 100%"
                v-on:click="AddColor(colors.length)"
              >
                <img src="@/assets/svg/Add12Filled.svg" alt="svg图标" />
              </button>
            </div>
            <div
              :style="{ background: gradientStyle }"
              style="
                width: 100%;
                height: 100%;
                align-items: center;
                display: flex;
                border-radius: 8px;
              "
            >
              <div class="color-select-list">
                <div
                  v-for="(value, index) in colors"
                  :key="index"
                  style="
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    width: 100%;
                  "
                >
                  <button
                    class="close"
                    :hidden="colors.length == 1"
                    v-on:click="DeleteColor(index)"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      xmlns:xlink="http://www.w3.org/1999/xlink"
                      viewBox="0 0 32 32"
                    >
                      <path
                        d="M24 9.4L22.6 8L16 14.6L9.4 8L8 9.4l6.6 6.6L8 22.6L9.4 24l6.6-6.6l6.6 6.6l1.4-1.4l-6.6-6.6L24 9.4z"
                        fill="#FFF"
                      ></path>
                    </svg>
                  </button>
                  <NColorPicker v-model:value="colors[index]">
                    <template #trigger="{ value, onClick, ref: triggerRef }">
                      <div
                        :ref="triggerRef"
                        :style="{
                          width: '44px',
                          height: '44px',
                          borderRadius: '50%',
                          backgroundColor: value || '#000',
                          cursor: 'pointer',
                          border: '2px solid #fff',
                          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                        }"
                        @click="onClick"
                      />
                    </template>
                  </NColorPicker>
                  <input
                    class="input"
                    :value="colors[index]"
                    @change="onColorChange($event, index)"
                    style="width: 120px"
                  />
                  <div ref="ChangeOrder">
                    <button
                      v-if="index != 0"
                      class="ChangeOrderButton"
                      v-on:click="MoveColorNumber(index, index - 1)"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        xmlns:xlink="http://www.w3.org/1999/xlink"
                        viewBox="0 0 28 28"
                      >
                        <g fill="none">
                          <path
                            d="M12.735 4.21a.75.75 0 0 1 1.04 1.08L5.5 13.25h18.753a.75.75 0 0 1 0 1.5H5.501l8.274 7.959a.75.75 0 0 1-1.04 1.08L3.307 14.72a1 1 0 0 1 0-1.441l9.428-9.07z"
                            fill="currentColor"
                          ></path>
                        </g>
                      </svg>
                    </button>
                    <button
                      v-if="index != colors.length - 1"
                      class="ChangeOrderButton"
                      v-on:click="MoveColorNumber(index, index + 1)"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        xmlns:xlink="http://www.w3.org/1999/xlink"
                        viewBox="0 0 20 20"
                      >
                        <g fill="none">
                          <path
                            d="M10.837 2.63a.5.5 0 0 0-.674.74L16.33 9H2.5a.5.5 0 0 0 0 1h13.828l-6.165 5.628a.5.5 0 0 0 .674.739l6.916-6.314a.747.747 0 0 0 0-1.108L10.837 2.63z"
                            fill="currentColor"
                          ></path>
                        </g>
                      </svg>
                    </button>
                  </div>
                  <button
                    style="background-color: transparent; border: 0"
                    v-on:click="SetRandomColor(index)"
                  >
                    <n-icon size="36" color="white">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        xmlns:xlink="http://www.w3.org/1999/xlink"
                        viewBox="0 0 512 512"
                      >
                        <path
                          d="M320 146s24.36-12-64-12a160 160 0 1 0 160 160"
                          fill="none"
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-miterlimit="10"
                          stroke-width="32"
                        ></path>
                        <path
                          fill="none"
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="32"
                          d="M256 58l80 80l-80 80"
                        ></path>
                      </svg>
                    </n-icon>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <textarea
            class="text-input"
            v-model="text"
            placeholder="请输入文本..."
          />
          <div
            class="display"
            :style="{
              background: displayBGClolrList[displayBGColorIndex],
            }"
            v-on:click="
              displayBGColorIndex =
                (displayBGColorIndex + 1) % displayBGClolrList.length
            "
          >
            <span
              v-for="(item, index) in chars"
              :key="index"
              :style="{
                color: `${
                  isSetColor
                    ? colorFrames[currentFrame % colorFrames.length][
                        index
                      ].hex()
                    : '#FFF'
                }`,
                fontSize:
                  `${
                    isUseSize
                      ? sizeFrams[currentFrame % sizeFrams.length][index]
                      : 20
                  }` + 'px',
              }"
            >
              {{ item }}
            </span>
          </div>
          <div
            style="
              display: flex;
              flex-direction: column;
              gap: 10px;
              margin-top: 10px;
            "
          >
            共计：{{ frameCount }}帧
            <NCollapse
              v-for="i in frameCount"
              :key="i"
              :defaultExpandedNames="
                Array.from({ length: frameCount }, (_, i) => `${i}`)
              "
            >
              <NCollapseItem :name="`${i - 1}`">
                <template #header> 第{{ i }}帧 </template>
                <div
                  style="
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    margin-top: 10px;
                  "
                >
                  <PanelLayout
                    v-for="(item, index) in getCharList(frameCount)"
                    :key="index"
                    class="output"
                  >
                    <div
                      style="
                        display: flex;
                        flex-direction: row;
                        justify-items: center;
                        align-items: center;
                      "
                      v-on:click="Clipboard(item)"
                    >
                      <div style="width: 24px; height: 24px; margin-left: 10px">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          xmlns:xlink="http://www.w3.org/1999/xlink"
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
                            fill="currentColor"
                          ></path>
                        </svg>
                      </div>
                      <div style="width: 85%; margin-left: 10px">
                        <NEllipsis> {{ item }}</NEllipsis>
                      </div>
                      <div>字符:{{ item.length }}</div>
                    </div>
                  </PanelLayout>
                </div>
              </NCollapseItem>
            </NCollapse>
          </div>
        </div>
      </SectionLayout>
    </SplitterPanel>
  </Splitter>
</template>

<style scoped>
.preset-card {
  height: 75px;
  width: 100%;
  background-color: transparent;
  border-radius: 10px 10px 0 0;
  border: 0;
  overflow: hidden;
}

.delete-button {
  display: none;
  position: absolute;
  z-index: 99;
  left: 2px;
  top: 2px;
  width: 6px;
  height: 6px;
  border-radius: 100%;
}

.preset-card:hover .delete-button {
  display: block;
}

.color-picker {
  width: 60px;
  height: 60px;
  border-radius: 100%;

  padding: 10px 20px;
  border: none; /* 去掉默认边框 */
  cursor: pointer;
  outline: none; /* 取消默认焦点黑框 */
  transition: box-shadow 0.2s;
  box-shadow: 0 0 0 1px #fffa;
}
.color-select-list {
  display: flex;
  flex-direction: row;
  justify-content: center;
  position: relative;
  width: 100%;
}
.addButton {
  position: absolute;
  width: 50px;
  height: 50px;
  justify-items: center;
  align-items: center;
  text-align: center; /* 核心：水平居中 */
  position: absolute; /* 脱离文档流，基于父容器定位 */
  top: 50%; /* 先让元素顶部对齐父容器垂直中点 */
  transform: translateY(-75%);
  background-color: #00000020;
  border: 0;
  z-index: 999;
}

/* SVG：绝对定位 + 居中 */
.addButton img {
  position: absolute;
  top: 50%; /* 垂直中点对齐 */
  left: 50%; /* 水平中点对齐 */
  transform: translate(-50%, -50%); /* 自身位移实现真正居中 */
  max-width: 100%;
  max-height: 100%;
}

.color-select-list .close {
  width: 50px;
  height: 50px;
  background-color: transparent;
  border: 0;
}

.color-select-list .input {
  background: transparent;
  border: 0;
  justify-items: center;
  color: white;
  font-size: 20px;
}

.text-input {
  height: 50px;
  text-align: center; /* 水平居中 */
  overflow-y: hidden;
}

.display {
  position: relative;
  width: 100%;
  height: max-content;
  min-height: 75px;
  /* background-color: #333333; */
  justify-items: center;
  align-items: center;
  border-radius: 10px;
  word-break: break-all;
  padding: 20px;
}

.output {
  font-size: 15px;
  padding: 10px 0;
}

.ChangeOrderButton {
  width: 40px;
  background-color: transparent;
  border: 0;
  color: white;
}
</style>
