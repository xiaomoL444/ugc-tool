<script setup lang="ts">
import PanelLayout from "@/components/Layout/PanelLayout.vue";
import { onMounted, ref } from "vue";
import { AppRoute, appRoutes } from "@/configs/routes";
import axios from "axios";
import { useI18n } from "vue-i18n";
import { contactLinks } from "@/configs/contactLinks";

const { t } = useI18n({ useScope: "global" });

function jumpAddress(item: AppRoute) {
  window.location.href = item.path;
}
</script>

<template>
  <div
    class="home-page"
    style="
      padding-top: 30px;
      display: flex;
      flex-direction: column;
      justify-items: center;
      align-items: center;
      width: 100%;
      overflow-y: auto;
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
      <PanelLayout>
        <a
          href="http://ys.tewasa.com/"
          style="color: inherit; text-decoration: none"
        >
          <div
            class="card"
            style="
              background: -webkit-linear-gradient(
                90deg,
                #99f8ff,
                #d6feff
              ); /* Chrome 10-25, Safari 5.1-6 */
              background: linear-gradient(
                45deg,
                #99f8ff,
                #d6feff
              ); /* W3C, IE 10+/ Edge, Firefox 16+, Chrome 26+, Opera 12+, Safari 7+ */
            "
          >
            <div
              style="position: absolute; top: 0; left: 10px; font-size: 14px"
            >
              ✦───────
            </div>
            <div class="title">奇域？迷因？铁花洒！!</div>
            <div class="description">
              铁花洒到底是什么口牙！
              <p>
                <img
                  src="https://pinksheep-arc.cn-nb1.rains3.com/Xiaomol444/tewasa_icon.png"
                  style="border-radius: 100%"
                />
              </p>
            </div>

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
        </a>
      </PanelLayout>

<PanelLayout>
        <a
          href="https://wiki.miliastra.dev/"
          style="color: inherit; text-decoration: none"
        >
          <div
            class="card"
            style="
              background: -webkit-linear-gradient(
                90deg,
                #99f8ffCC,
                #d6feffCC
              ); /* Chrome 10-25, Safari 5.1-6 */
              background: linear-gradient(
                45deg,
                #99f8ffCC,
                #d6feffCC
              ); /* W3C, IE 10+/ Edge, Firefox 16+, Chrome 26+, Opera 12+, Safari 7+ */
            "
          >
            <div
              style="position: absolute; top: 0; left: 10px; font-size: 14px"
            >
              ✦───────
            </div>
            <div class="title">Miliastra Wonderland Community Wiki</div>
            <div class="description">
              <p>
                <img
                  src="https://wiki.miliastra.dev/system_miliastra_wonderland.webp"
                  style="border-radius: 100%;width: 70px;"
                />
              </p>
            </div>

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
        </a>
      </PanelLayout>

      <div v-for="(item, index) in appRoutes" :key="index">
        <PanelLayout>
          <div class="card" v-on:click="jumpAddress(item)">
            <div
              style="position: absolute; top: 0; left: 10px; font-size: 14px"
            >
              ✦───────
            </div>
            <div class="title" :style="{ color: item.titleColor ?? '#000' }">
              {{ item.titleKey ? t(item.titleKey) : item.title }}
            </div>
            <div class="description">{{ item.descriptionKey ? t(item.descriptionKey) : item.description }}</div>
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
    <section v-if="contactLinks.length" class="contact-section" aria-labelledby="contact-title">
      <h2 id="contact-title">{{ t('homePage.ui.contactTitle') }}</h2>
      <div class="contact-links">
        <a v-for="contact in contactLinks" :key="contact.href" class="contact-badge"
          :href="contact.href" target="_blank" rel="noopener noreferrer"
          :aria-label="`${contact.platform}: ${contact.label}`">
          <span class="contact-platform">
            <img :src="contact.image" alt="" width="16" height="16" loading="lazy" />
            {{ contact.platform }}
          </span>
          <span class="contact-label" :style="{ backgroundColor: contact.color }">{{ contact.label }}</span>
        </a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home-page {
  box-sizing: border-box;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.home-page::-webkit-scrollbar {
  display: none;
}
.contact-section {
  box-sizing: border-box;
  flex-shrink: 0;
  width: min(1140px, 100%);
  margin: 32px auto;
  padding: 0 20px;
}
.contact-section h2 {
  text-align: center;
  margin: 0 0 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #6a5acd30;
  font-size: 1.4rem;
}
.contact-links {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
.contact-badge {
  display: inline-flex;
  max-width: 100%;
  overflow: hidden;
  border-radius: 4px;
  color: #fff;
  text-decoration: none;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: 0 1px 2px #0002;
  transition: filter 0.15s;
}
.contact-badge:hover {
  filter: brightness(1.1);
}
.contact-badge:focus-visible {
  outline: 3px solid #6a5acd;
  outline-offset: 3px;
}
.contact-platform,
.contact-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
}
.contact-platform {
  flex-shrink: 0;
  background: #555;
}
.contact-platform img {
  object-fit: contain;
  flex-shrink: 0;
}
.contact-label {
  min-width: 0;
  overflow-wrap: anywhere;
}
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
  color: #000;
}
.card .description {
  position: relative;
  padding-top: 5px;
  padding-left: 10px;
  width: 100%;
  text-align: left;
  font-size: 15px;
  color: #0008;

  white-space: pre-wrap;
}
.bottom-line {
  position: fixed;
  height: auto;
  bottom: 0;
}
</style>
