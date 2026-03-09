<template>
  <div class="Section">
    <div class="MainBox">
      <div class="title">
        {{ title }}
      </div>
    </div>
    <div class="panel">
      <slot />
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  title: { type: String, required: true },
});
</script>

<style scoped>
.Section {
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  border-radius: 5px;
  border: 1px solid #6a5acd;
  display: flex;
  flex-direction: column;
  min-height: 0; /* ⚠️ 必须 */

  /* 核心：模糊背景背后的内容 */
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);

  /* 半透明背景，建议使用带有微弱蓝紫色的白色 */
  background: rgba(255, 255, 255, 0.5);

  /* 玻璃边缘的高光感 */
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 12px;

  /* 柔和的阴影增强悬浮感 */
  border-radius: 16px;
  filter: drop-shadow(0 8px 32px rgba(0, 0, 0, 0.05));
  overflow: hidden; /* 关键：保证内部背景跟着圆角裁切 */
}

.MainBox {
  /* box-shadow: inset 0 0 0 0.01rem #00000050; */
  /* text-align: center; */
  display: flex;
  /* justify-content: center; */
  /* 水平居中 */
  align-items: center;
  /* height: 2.5rem; */
  /* padding-left: 0.5rem; */
  flex: 0 0 auto; /* 标题自然高度 */

}

.title {
  padding: 3px 12px;
  height: 2rem;
  width: 100%;
  color: white;
  display: flex;
  /* justify-content: center; */
  /* 水平居中 */
  align-items: center;
  /* 垂直居中 *

  /* font-weight: 700; */
  /* 粗体 */
  font-size: 1.5rem;
  /* 放大一点好看 */
  background-color: #0EA2E5;
  /* background: linear-gradient(225deg, #6a5acd, #00bfff); */
  /* 紫 → 蓝 */
  /* -webkit-background-clip: text; */
  /* 背景裁剪到文字 */
  /* color: transparent; */
  /* 隐藏文字颜色，让渐变显现 */
  /* -webkit-text-fill-color: transparent; */
}

.panel {
  /* border-top: 2px solid #6a5acd; */
  padding: 0.3rem;
  flex: 1; /* 吃掉剩余高度 */
  height: 100%;
  overflow-y: auto;

  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
