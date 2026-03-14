<template>
  <div style="height: 100%; display: flex; flex-direction: row; gap: 8px">
    <SectionLayout title="选择图片" style="flex: 1"
      ><div
        style="
          margin: 0.25rem;
          display: flex;
          flex-direction: column;
          gap: 12px; /* 子元素上下间距 */
          width: auto;
          justify-items: center;
          /* align-items: center; */
        "
      >
        <input
          ref="fileInput"
          type="file"
          style="display: none"
          accept="image/*"
          @change="onFileChange"
        />

        <!-- 原图显示 -->
        <!-- 原图：<img v-if="imgUrl" :src="imgUrl" class="preview" /> -->

        <!-- 像素画 canvas -->
        预览：
        <div>
          <canvas
            :style="{
              height: (200 * pixelHeight) / pixelWidth + 'px',
              width: '200px',
            }"
            ref="canvas"
            :width="pixelWidth"
            :height="pixelHeight"
          ></canvas>
        </div>

        <ActionButton
          v-on:update:selected="selectFile"
          style="height: 50px; font-size: 20px"
          >选择文件</ActionButton
        >
        <FormItemRow title="高度">
          <input
            class="input"
            type="number"
            v-model="pixelHeight"
            @blur="refreshImg"
            @keyup.enter="refreshImg"
        /></FormItemRow>
        <FormItemRow title="宽度">
          <input
            class="input"
            type="number"
            v-model="pixelWidth"
            @blur="refreshImg"
            @keyup.enter="refreshImg"
        /></FormItemRow>
        <FormItemRow title="每行最大像素宽：">
          <input
            class="input"
            type="number"
            v-model="maxPixelWidth"
            @blur="refreshImg"
            @keyup.enter="refreshImg"
        /></FormItemRow>
        <FormItemRow title="4bit输出"
          ><NSwitch v-model:value="isUse4bit"
        /></FormItemRow>
        <FormItemRow title="透明度"
          ><NSwitch v-model:value="isUseAlpha"
        /></FormItemRow>
        —————下载部分—————
        <FormItemRow title="结构体ID">
          <input class="input" type="number" v-model="structId" /></FormItemRow
        ><ActionButton
          v-on:update:selected="downloadJson"
          style="height: 50px; font-size: 20px"
          >下载JSON</ActionButton
        >
      </div> </SectionLayout
    ><SectionLayout title="分段输出" style="flex: 6">
      <NCollapse
        class="outputContainer"
        v-for="(line, index) in pixels"
        :key="index"
        :defaultExpandedNames="
          Array.from({ length: pixels.length }, (_, i) => i)
        "
      >
        <NCollapseItem :name="index">
          <template #header> 第{{ index }}行 </template>
          <div
            style="
              display: flex;
              flex-direction: column;
              gap: 10px;
              margin-top: 10px;
            "
          >
            <PanelLayout v-for="(item, i) in line" :key="i" class="output">
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
                <div style="width: 90%; margin-left: 10px">
                  <NEllipsis>第{{ i + 1 }}部分： {{ item }}</NEllipsis>
                </div>
                <div>字符:{{ item.length }}</div>
              </div>
            </PanelLayout>
          </div>
        </NCollapseItem>
      </NCollapse>
    </SectionLayout>
  </div>
  <!-- <pre class="output">
{{ pixels }}
    </pre> -->
</template>

<script setup lang="ts">
/* eslint-disable */

import { computed, ref, watch } from "vue";
import CopyBox from "./components/CopyBox.vue";
import "vue-sonner/style.css";
import SectionLayout from "@/components/Layout/SectionLayout.vue";
import ActionButton from "@/components/button/ActionButton.vue";
import FormItemRow from "@/components/Layout/form-item-row.vue";
import { Clipboard } from "@/utils/clipboard";
import PanelLayout from "@/components/Layout/PanelLayout.vue";
import { NCollapse, NCollapseItem, NEllipsis, NSwitch } from "naive-ui";
import { downloadJsonFile } from "@/utils/download";

const canvas = ref<HTMLCanvasElement>();
const imgUrl = ref("");
const pixelHeight = ref(20); //像素画高
const pixelWidth = ref(20); //像素画宽
const maxPixelWidth = ref(20); //每行最大像素画宽
const pixels = ref<string[][]>([]);

const isUse4bit = ref(false);
const isUseAlpha = ref(true);

watch(isUse4bit, () => {
  refreshImg();
});
watch(isUseAlpha, () => {
  refreshImg();
});

const structId = ref(1077936129);

const fileInput = ref<HTMLInputElement>();
function selectFile() {
  if (fileInput.value) fileInput.value.click();
}

const getLineContainPart = computed(
  () => Math.floor((pixelWidth.value - 1) / maxPixelWidth.value) + 1,
);

const imgFile = ref<HTMLImageElement>(); // 缓存 File 或 Image
function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  imgUrl.value = URL.createObjectURL(file);

  const img = new Image();
  img.onload = () => {
    imgFile.value = img;
    drawToPixelCanvas(img);
  };
  img.src = imgUrl.value;
  target.value = "";
}

function refreshImg() {
  if (imgFile.value) {
    drawToPixelCanvas(imgFile.value);
  }
}

function drawToPixelCanvas(img: HTMLImageElement) {
  if (!canvas.value) return;
  const ctx = canvas.value.getContext("2d");

  if (!ctx) return;
  // 禁用平滑，确保“硬像素”
  ctx.imageSmoothingEnabled = false;

  // 清空画布
  ctx.clearRect(0, 0, pixelWidth.value, pixelHeight.value);
  if (!isUseAlpha.value) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, pixelWidth.value, pixelHeight.value);

    ctx.drawImage(img, 0, 0, pixelWidth.value, pixelHeight.value);
  }
  // 把原图压缩绘制到小 canvas
  ctx.drawImage(img, 0, 0, pixelWidth.value, pixelHeight.value);

  // 读取像素数据
  const imageData = ctx.getImageData(0, 0, pixelWidth.value, pixelHeight.value);
  const data = imageData.data;

  const result = [];

  let pixelIndex = 0;
  let pixelLineIndex = 0;

  let line = "";
  let lastColor = "";
  let lastIsSame = false;
  let isStart = true;
  for (let i = 0; i < data.length; i += 4) {
    pixelIndex++;
    pixelLineIndex++;

    let hexWithAlpha = rgbaToHex(
      data[i],
      data[i + 1],
      data[i + 2],
      data[i + 3],
    );

    const isSameColor = hexWithAlpha == lastColor;

    if (isSameColor) {
      line += "█";
    } else {
      line += `${isStart ? "" : "</color>"}<color=${hexWithAlpha}>█`;
      isStart = false;
    }

    // if (lastIsSame) {
    //   if (isSameColor) {
    //     line += "█";
    //   } else {
    //     line += `<color=${hexWithAlpha}>█`;
    //   }
    // } else {
    //   if (isSameColor) {
    //     line += `</color><color=${hexWithAlpha}>█</color>`;
    //   } else {
    //     line += `<color=${hexWithAlpha}>█</color>`;
    //   }
    // }
    lastColor = hexWithAlpha;
    lastIsSame = isSameColor;

    if (
      pixelIndex >= maxPixelWidth.value ||
      pixelLineIndex >= pixelWidth.value
    ) {
      pixelIndex = 0;
      if (pixelLineIndex >= pixelWidth.value) {
        pixelLineIndex = 0;
      }

      if (isSameColor) {
        line += "</color>";
      }

      result.push(line);
      line = ""; //清空line
      lastColor = "";
      lastIsSame = false;
      isStart = true;
    }
  }

  pixels.value = chunkStrings(result, getLineContainPart.value);
}

function chunkStrings(arr: string[], size: number): string[][] {
  const result: string[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function rgbaToHex(r: number, g: number, b: number, a = 255) {
  const toHex8 = (v: number) => v.toString(16).padStart(2, "0").toUpperCase();

  const toHex4 = (v: number) =>
    Math.round(v / 17)
      .toString(16)
      .toUpperCase(); // 255 / 15 ≈ 17

  if (!isUse4bit.value) {
    return `#${toHex8(r)}${toHex8(g)}${toHex8(b)}${
      isUseAlpha.value ? toHex8(a) : ""
    }`;
  } else {
    return `#${toHex4(r)}${toHex4(g)}${toHex4(b)}${
      isUseAlpha.value ? toHex4(a) : ""
    }`;
  }
}

function downloadJson() {
  const json = {
    structId: `${structId.value}`,
    type: "Struct",
    value: [
      {
        param_type: "StringList",
        value: pixels.value.flat(),
      },
    ],
  };
  downloadJsonFile(json, `${structId.value}.json`);
}
</script>

<style scoped>
.selectBtn {
  color: white;
  background-color: #4facfe;
  border: #000;
  border-radius: 10px;
  font-size: 1.2rem;
  padding: 1rem;
  cursor: pointer;
  transition: background-color 0.3s ease, transform 0.2s ease-out,
    color 0.3s ease;
}

.selectBtn:hover {
  background-color: #337ecc;
  /* 更深一点的颜色 */
}
.preview {
  max-width: 200px;
  border: 1px solid #ccc;
}

canvas {
  width: 200px;
  height: 200px;
  border: 1px solid #000;
  image-rendering: pixelated;
}

.output {
  overflow: auto;
  /* background: #111; */
  /* color: #0f0; */
  padding: 8px;
  font-size: 12px;
  cursor: default;
  user-select: none;
}

.outputContainer {
  /* margin: 0.5rem 0.5rem; */
  padding-bottom: 10px;
}
</style>
