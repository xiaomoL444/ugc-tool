<template>
  <Toaster position="top-center" />
  <div class="topbar">
    <button style="width: 54px;height: 54px; background-color:  #6a5acdAA; border-radius: 15%;" id="menuBtn"
      :aria-label="t('app.openNavigation')" :aria-expanded="open" aria-controls="sidebar"
      v-on:click="OpenSidebar">☰</button>
    <PanelLayout class="title-panel">
      <div class="header"><img src="@/assets/logo.png" style="height: 36px; width: 36px; margin:0px,20px;"></img>
        <h2 class="title" style="color: white;">{{ pageTitle }}</h2>
      </div>
    </PanelLayout>
    <AnnouncementBell />
    <StorageSettings />
    <LanguageSwitcher />
  </div>
  <main class="background">
    <div class="content">
      <router-view />
    </div>
  </main>

  <div id="overlay" class="overlay" v-on:click="CloseSidebar" :class="{ show: open }"></div>

  <div id="sidebar" class="sidebar" :class="{ open }">
    <h2>{{ t('app.navigation') }}</h2>
    <nav v-if="isLocal">
      <h4>{{ t('app.testTools') }}</h4>
      <router-link to="/about">About</router-link>
      <router-link to="/debugpanel">debugpanle</router-link>
      <router-link to="/OverSeaUpload">海外上传工具</router-link>
    </nav>
    <nav class="sidebar-navigation" :aria-label="t('app.navigation')">
      <router-link to="/" @click="CloseSidebar">{{ t('app.home') }}</router-link>
      <section v-for="category in navigationCategories" :key="category.id" class="sidebar-category"
        :aria-labelledby="`sidebar-category-${category.id}`"
        :style="{ '--category-color': category.color, '--category-background': category.background }">
        <h3 :id="`sidebar-category-${category.id}`" class="sidebar-category-title">
          {{ displayText(category.title, category.titleKey) }}
        </h3>
        <template v-for="card in category.cards" :key="card.id">
          <a v-if="isExternalLink(card.href)" :href="card.href" target="_blank" rel="noopener noreferrer"
            @click="CloseSidebar">
            {{ displayText(card.title, card.titleKey) }}
          </a>
          <router-link v-else :to="card.href" @click="CloseSidebar">
            {{ displayText(card.title, card.titleKey) }}
          </router-link>
        </template>
      </section>
    </nav>
  </div>

</template>

<style>
@import "./assets/global.css";

html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  background-color: #E7E7FFFF;
  overflow: hidden;
  /* line-height: 1.5; */
  /* font-size: 90%; */
  /* 让所有 rem 缩小为原来的 0.9 倍 */
}

@font-face {
  font-family: 'StarRailFont';
  /* 自定义字体名称 */
  src: url('@/assets/zh-cn.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}

:root {
  --app-font-family: StarRailFont, Avenir, Helvetica, Arial, sans-serif;
}

#app {
  font-family: var(--app-font-family);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
}

nav {
  padding: 30px;
}

nav a {
  font-weight: bold;
  color: #2c3e50;
}

nav a.router-link-exact-active {
  color: #42b983;
}

.topbar {
  display: flex;
  padding: 10px 10px 0 10px;
  gap: 10px;
  justify-items: center;
  align-items: center;
  height: 64px;
}

.topbar .header {
  display: flex;
  /* justify-content: center; */
  /* 水平居中 */
  align-items: center;
  height: 54px;
  /* padding-left: 2rem; */
  padding-left: 20px;
  padding-right: 12px;
  background: linear-gradient(90deg, #6a5acd, #00bfff);

}

.topbar .title {
  padding-left: 5px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar .title-panel {
  flex: 1;
  min-width: 0;
}

.topbar .header img {
  flex-shrink: 0;
}

@media (max-width: 480px) {
  .topbar {
    gap: 6px;
  }

  .topbar .header {
    padding-left: 8px;
  }

  .topbar .header img {
    display: none;
  }

  .topbar .title {
    font-size: 1.05rem;
  }

}

.background {
  position: relative;
  overflow: hidden;
  height: calc(100vh - 64px);
  box-sizing: border-box;
  padding: 10px;
}

.content {
  position: relative;
  overflow: auto;
  height: 100%;
  /* padding: 50px; */
  /* margin: 10px; */
}

.content>* {
  position: absolute;
  inset: 0;
}
</style>

<style scoped>
/* 按钮 */
#menuBtn {
  flex-shrink: 0;
  position: relative;
  /* top:20px;
  left:20px; */
  width: 60px;
  height: 60px;
  z-index: 1001;
  font-size: 22px;
  border: 0;
  border-radius: 10px;
  font-size: 2rem;
  color: white;
  background-color: #0001;
}


/* 背景遮罩 */
.overlay {
  position: fixed;
  inset: 0;

  background: rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(6px);

  opacity: 0;
  pointer-events: none;

  transition: 0.3s;
  z-index: 1000;
}

.overlay.show {
  opacity: 1;
  pointer-events: auto;
}

/* 侧边栏 */
.sidebar {
  position: fixed;
  top: 0;
  left: 0;

  box-sizing: border-box;
  width: min(310px, 100vw);
  height: 100%;

  padding: 30px;
  overflow-y: auto;
  scrollbar-width: none;
  overscroll-behavior: contain;

  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(14px);

  border-radius: 0 20px 20px 0;

  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.25);

  transform: translateX(-110%);
  transition: transform .35s cubic-bezier(.2, .8, .2, 1);

  z-index: 1001;
}

.sidebar::-webkit-scrollbar {
  display: none;
}

/* 展开 */
.sidebar.open {
  transform: translateX(0);
}

/* 链接 */
.sidebar a {
  display: block;
  margin-top: 14px;
  text-decoration: none;
  color: #333;
  font-size: 16px;
}

/* hover */
.sidebar a:hover {
  opacity: .7;
}

.sidebar-navigation {
  padding: 0;
}

.sidebar-category {
  margin-top: 22px;
}

.sidebar-category-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 8px;
  color: var(--category-color);
  font-size: 14px;
  line-height: 1.5;
}

.sidebar-category-title::before,
.sidebar-category-title::after {
  content: '';
  flex: 1;
  border-top: 1px solid currentColor;
  opacity: .35;
}

.sidebar-category a {
  margin-top: 0;
  padding: 8px 10px;
  border-radius: 8px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.sidebar-category a + a {
  margin-top: 6px;
}

.sidebar-category a:hover,
.sidebar-category a.router-link-exact-active {
  background: var(--category-background);
  color: var(--category-color);
  opacity: 1;
}

.sidebar a:focus-visible {
  outline: 2px solid var(--category-color, #6a5acd);
  outline-offset: 2px;
  border-radius: 8px;
}
</style>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed, onErrorCaptured, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LanguageSwitcher from './components/LanguageSwitcher.vue'
import AnnouncementBell from './components/AnnouncementBell.vue'
import { Toaster, toast } from 'vue-sonner'
import 'vue-sonner/style.css'
import PanelLayout from './components/Layout/PanelLayout.vue'
import StorageSettings from './components/StorageSettings.vue'
import { DesktopStorageError } from './services/storage/desktopStorage'
import { StorageSyncPausedError } from './services/storage/storage'
import homePageData from './configs/homePage.json'

interface NavigationCard {
  id: string;
  href: string;
  title: string;
  titleKey?: string;
}

interface NavigationCategory {
  id: string;
  title: string;
  titleKey?: string;
  color: string;
  background: string;
  cards: NavigationCard[];
}

const navigationCategories: NavigationCategory[] = homePageData.categories

const route = useRoute()
onErrorCaptured((error) => {
  if (error instanceof DesktopStorageError || error instanceof StorageSyncPausedError) {
    toast.error(error.message, { id: 'desktop-storage-error' })
    return false
  }
})
const { t, te } = useI18n({ useScope: 'global' })
const displayText = (value: string, key?: string) => key && te(key) ? t(key) : value
const isExternalLink = (href: string) => /^(?:https?:)?\/\//i.test(href)
const pageTitle = computed(() => typeof route.meta.titleKey === 'string'
  ? t(route.meta.titleKey)
  : String(route.meta.title || t('app.defaultTitle')))

watch(pageTitle, (title) => { document.title = title }, { immediate: true })

const isLocal = process.env.NODE_ENV === "development"

const open = ref(false)
function OpenSidebar() {
  open.value = true;
}

function CloseSidebar() {
  open.value = false;
}

watch(() => route.fullPath, () => {
  open.value = false
})
</script>
