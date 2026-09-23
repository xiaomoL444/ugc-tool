<template>
  <div style="height: 100%; display: flex; flex-direction: row; gap: 8px">
    <SectionLayout title="选择图片" style="flex: 1">
      <div style="
          margin: 0.25rem;
          display: flex;
          flex-direction: column;
          gap: 12px; /* 子元素上下间距 */
          width: auto;
          justify-items: center;
          /* align-items: center; */
        ">
        <input ref="fileInput" type="file" style="display: none" accept="image/*" @change="onFileChange" />

        <!-- 原图显示 -->
        <!-- 原图：<img v-if="imgUrl" :src="imgUrl" class="preview" /> -->

        <!-- 像素画 canvas -->
        预览：
        <div>
          <canvas :style="{
            height: (200 * pixelHeight) / pixelWidth + 'px',
            width: '200px',
          }" ref="canvas" :width="pixelWidth" :height="pixelHeight"></canvas>
          <div v-if="sourceImageSize" style="margin-top: 4px; font-size: 12px; opacity: 0.72">
            原图尺寸：{{ sourceImageSize }}
          </div>
        </div>

        <ActionButton v-on:update:selected="selectFile" style="height: 50px; font-size: 20px">选择文件</ActionButton>
        <FormItemRow title="高度">
          <input class="input" type="number" v-model="pixelHeight" @blur="refreshImg" @keyup.enter="refreshImg" />
        </FormItemRow>
        <FormItemRow title="宽度">
          <input class="input" type="number" v-model="pixelWidth" @blur="refreshImg" @keyup.enter="refreshImg" />
        </FormItemRow>
        <FormItemRow title="每行最大像素宽：">
          <input class="input" type="number" v-model="maxPixelWidth" @blur="refreshImg" @keyup.enter="refreshImg" />
        </FormItemRow>
        <FormItemRow title="4bit输出">
          <NSwitch v-model:value="isUse4bit" />
        </FormItemRow>
        <FormItemRow title="透明度">
          <NSwitch v-model:value="isUseAlpha" />
        </FormItemRow>
        <FormItemRow title="使用空格代替空白">
          <NSwitch v-model:value="isUseSpace" />
        </FormItemRow>
        —————下载部分—————
        <FormItemRow title="结构体ID">
          <input class="input" type="number" v-model="structId" />
        </FormItemRow>
        <ActionButton v-on:update:selected="downloadJson" style="height: 50px; font-size: 20px">下载JSON</ActionButton>
        <ActionButton v-on:update:selected="downloadLua" style="height: 50px; font-size: 20px">下载千星奇域 Lua</ActionButton>
        <div style="font-size: 12px; opacity: 0.72">
          Lua 会读取 ImagePrefebID、CenterOffsetX、CenterOffsetY 和 PixelSize；偏移默认 0，像素大小默认 1。
        </div>
      </div>
    </SectionLayout>
    <SectionLayout title="分段输出" style="flex: 6">
      <NCollapse class="outputContainer" v-for="(line, index) in pixels" :key="index" :defaultExpandedNames="Array.from({ length: pixels.length }, (_, i) => i)
        ">
        <NCollapseItem :name="index">
          <template #header> 第{{ index }}行 </template>
          <div style="
              display: flex;
              flex-direction: column;
              gap: 10px;
              margin-top: 10px;
            ">
            <PanelLayout v-for="(item, i) in line" :key="i" class="output">
              <div style="
                  display: flex;
                  flex-direction: row;
                  justify-items: center;
                  align-items: center;
                " v-on:click="Clipboard(item)">
                <div style="width: 24px; height: 24px; margin-left: 10px">
                  <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
                    viewBox="0 0 24 24">
                    <path
                      d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
                      fill="currentColor"></path>
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
import { downloadJsonFile, downloadTextFile } from "@/utils/download";

type PixelColor = [number, number, number, number];

interface PixelBlock {
  x: number;
  y: number;
  width: number;
  height: number;
  color: PixelColor;
}

const canvas = ref<HTMLCanvasElement>();
const imgUrl = ref("");
const sourceImageSize = ref("");
const pixelHeight = ref(20); //像素画高
const pixelWidth = ref(20); //像素画宽
const maxPixelWidth = ref(40); //每行最大像素画宽
const pixels = ref<string[][]>([]);
const pixelColors = ref<PixelColor[][]>([]);

const isUse4bit = ref(false);
const isUseAlpha = ref(true);
const isUseSpace = ref(true);

watch(isUse4bit, () => {
  refreshImg();
});
watch(isUseAlpha, () => {
  refreshImg();
});
watch(isUseSpace, () => {
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

  sourceImageSize.value = "";
  imgUrl.value = URL.createObjectURL(file);

  const img = new Image();
  img.onload = () => {
    sourceImageSize.value = `${img.naturalWidth} × ${img.naturalHeight} px`;
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

  pixelColors.value = Array.from({ length: pixelHeight.value }, (_, y) =>
    Array.from({ length: pixelWidth.value }, (_, x) => {
      const index = (y * pixelWidth.value + x) * 4;
      return [data[index], data[index + 1], data[index + 2], data[index + 3]] as PixelColor;
    }),
  );

  const result = [];

  let pixelIndex = 0;
  let pixelLineIndex = 0;

  let line = "";
  let lastColor = "";
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

    if (
      pixelIndex >= maxPixelWidth.value ||
      pixelLineIndex >= pixelWidth.value
    ) {
      pixelIndex = 0;
      if (pixelLineIndex >= pixelWidth.value) {
        pixelLineIndex = 0;
      }

      line += "</color>";

      function processColorTags(text: string): string {
        return text.replace(
          /<color=#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})>(.*?)<\/color>/gs,
          (full, rgb, alpha, content) => {
            // 完全透明
            if (Number(alpha.toUpperCase()) === 0) {
              return "　".repeat(content.length);
            }

            // 保留原标签
            return full;
          }
        );
      }
      if (isUseSpace.value) {
        result.push(processColorTags(line));

      }
      else {
        result.push(line)
      }
      line = ""; //清空line
      lastColor = "";
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
    return `#${toHex8(r)}${toHex8(g)}${toHex8(b)}${isUseAlpha.value ? toHex8(a) : ""
      }`;
  } else {
    return `#${toHex4(r)}${toHex4(g)}${toHex4(b)}${isUseAlpha.value ? toHex4(a) : ""
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

function sameColor(a: PixelColor, b: PixelColor) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function mergePixels(rows: PixelColor[][]): PixelBlock[] {
  const blocks: PixelBlock[] = [];
  let previousRuns = new Map<string, PixelBlock>();

  rows.forEach((row, y) => {
    const currentRuns = new Map<string, PixelBlock>();
    let x = 0;

    while (x < row.length) {
      const color = row[x];
      let width = 1;
      while (x + width < row.length && sameColor(row[x + width], color)) width++;

      if (color[3] > 0) {
        const key = `${x}:${width}:${color.join(":")}`;
        const previous = previousRuns.get(key);
        if (previous) {
          previous.height++;
          currentRuns.set(key, previous);
        } else {
          const block = { x, y, width, height: 1, color };
          blocks.push(block);
          currentRuns.set(key, block);
        }
      }
      x += width;
    }

    previousRuns = currentRuns;
  });

  return blocks;
}

function buildLua(blocks: PixelBlock[], width: number, height: number) {
  const data = blocks
    .map(({ x, y, width, height, color }) =>
      `  {${x},${y},${width},${height},${color.join(",")}},`,
    )
    .join("\n");

  return `-- 由 UGC Tools 图片转像素画生成
local W, H = ${width}, ${height}
local PIXELS = {
${data}
}
local controls = {}

function OnStart()
  local prefabId, parent = script:GetParam("ImagePrefebID"), script.object
  local OX, OY = script:GetParam("CenterOffsetX"), script:GetParam("CenterOffsetY")
  local pixelSize = script:GetParam("PixelSize")
  if type(pixelSize) ~= "number" or pixelSize <= 0 then pixelSize = 1 end
  if type(OX) ~= "number" then OX = 0 end
  if type(OY) ~= "number" then OY = 0 end
  if type(prefabId) ~= "number" or prefabId <= 0 or not parent or not parent.alive then
    printerr("PixelArt: ImagePrefebID 或脚本容器无效")
    return
  end

  for i = 1, #PIXELS do
    local p = PIXELS[i]
    local control = game.InstantiateClientUIControl(prefabId, parent)
    if control then
      controls[#controls + 1] = control
      control:SetAnchorMin(0.5, 0.5)
      control:SetAnchorMax(0.5, 0.5)
      control:SetPivot(0.5, 0.5)
      control:SetSizeDelta(p[3] * pixelSize, p[4] * pixelSize)
      control:SetAnchoredPosition((p[1] + p[3] / 2 - W / 2 - OX) * pixelSize, (H / 2 - p[2] - p[4] / 2 - OY) * pixelSize)
      control.imageType = Enum.ImageType.Stretch
      control.imageColor = Color.FromRGBA(p[5], p[6], p[7], p[8])
    end
  end
end

function OnDestroy()
  for i = #controls, 1, -1 do
    local control = controls[i]
    if control and control.alive then game.DestroyClientUIControl(control) end
  end
  controls = {}
end
`;
}

function downloadLua() {
  if (!pixelColors.value.length) return;
  const height = pixelColors.value.length;
  const width = pixelColors.value[0]?.length ?? 0;
  downloadTextFile(
    buildLua(mergePixels(pixelColors.value), width, height),
    `pixel-art-${width}x${height}.lua`,
    "text/x-lua;charset=utf-8",
  );
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
