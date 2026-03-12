<script setup lang="ts">
import PanelLayout from "@/components/Layout/PanelLayout.vue";
import { onMounted, ref } from "vue";
import { AppRoute, appRoutes } from "@/configs/routes";
import axios from "axios";

function jumpAddress(item: AppRoute) {
  window.location.href = item.path;
}
</script>

<template>
  <div
    style="
      padding-top: 30px;
      display: flex;
      flex-direction: column;
      justify-items: center;
      align-items: center;
      width: 100%;
    "
  >
    <img
      alt="Vue logo"
      style="height: 30%; border-radius: 10%"
      src="@/assets/HomePage/avatar.jpg"
    />
    <h1>欢迎来到晓末L444的工具集</h1>
    <h2>客官想要什么下面请</h2>
    <div class="Grid">
      <div v-for="(item, index) in appRoutes" :key="index">
        <PanelLayout>
          <div class="card" v-on:click="jumpAddress(item)">
            <div
              style="position: absolute; top: 0; left: 10px; font-size: 14px"
            >
              ✦───────
            </div>
            <div class="title" :style="{ color: item.titleColor ?? '#000' }">
              {{ item.title }}
            </div>
            <div class="description">{{ item.description }}</div>
            <div
              style="
                position: absolute;
                bottom: 0;
                right: 10px;
                font-size: 14px;
              "
            >
              ───────✦
            </div>
          </div>
        </PanelLayout>
      </div>
    </div>
    <!-- <div class="bottom-line">发现这个头像有点欲迎还拒的感觉，很可爱</div> -->
  </div>
</template>

<style scoped>
.Grid {
  position: relative;
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(270px, 270px));
  gap: 20px;
  place-items: center;
  justify-content: center;
  box-sizing: content-box;
}
.card {
  /* padding: 50px; */
  width: 250px;
  height: 143.6px;

  padding: 10px;

  cursor: pointer;
  user-select: none;
  box-sizing: content-box;

  background-color: #fff5;
}
.container {
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.container:hover {
  transform: scale(1.05); /* 放大 */
  border-color: #4fa3ff; /* 边框亮起 */
  box-shadow: 0 0 12px #4fa3ff50; /* 发光效果 */
}
.card .title {
  position: relative;
  padding-top: 10px;
  padding-left: 10px;
  width: 100%;
  text-align: left;
  font-size: 20px;
  color: #000a;
}
.card .description {
  position: relative;
  padding-top: 5px;
  padding-left: 10px;
  width: 100%;
  text-align: left;
  font-size: 15px;
  color: #0008;
}
.bottom-line {
  position: fixed;
  height: auto;
  bottom: 0;
}
</style>
