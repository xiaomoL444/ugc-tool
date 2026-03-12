<template>
  <Toaster position="top-center" />

  <div class="header">
    <button id="menuBtn" v-on:click="OpenSidebar">☰</button>
    <img src="@/assets/logo.png" style="height: 2.5rem; width: 2.5rem; margin:0rem 1rem;"></img>
    <h2 class="title" style="color: white;">{{ pageTitle }}</h2>
  </div>
  <main class="background">
    <div class="content">
    <router-view />
  </div>
  </main>

<div id="overlay" class="overlay" v-on:click="CloseSidebar" :class="{ show: open }"></div>

<div id="sidebar" class="sidebar"     :class="{ open }">
  <h2>导航</h2>
<nav v-if="isLocal">
  <h4>测试工具</h4>
    <router-link to="/">Home</router-link>
    <router-link to="/about">About</router-link>
    <router-link to="/debugpanel">debugpanle</router-link>
</nav>
  <nav>
    <h3>线上工具</h3>
    <router-link to="/StructViewer">结构体编辑器</router-link>
    <router-link to="/SoundEffectPlayer">音效播放器</router-link>
    <router-link to="/TextGradient">文本渐变器</router-link>
        <router-link to="/PixelArt">图片转像素画</router-link>
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
background-color: #d9def3;
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

#app {
  font-family: StarRailFont, Avenir, Helvetica, Arial, sans-serif;
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

.header {
  display: flex;
  /* justify-content: center; */
  /* 水平居中 */
  align-items: center;
  padding-left: 2rem;
  background: linear-gradient(90deg, #6a5acd, #00bfff);
  height: 64px;
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
  overflow: hidden;
  height: 100%;
/* margin: 10px; */
}

.content>* {
  position: absolute;
  inset: 0;
}
</style>

<style scoped>
/* 按钮 */
#menuBtn{
  position:relative;
  /* top:20px;
  left:20px; */
  width: 60px;
  height: 60px;
  z-index:1001;
  font-size:22px;
  border: 0;
  border-radius: 10px;
font-size: 2rem;
color:white;
background-color: #0001;
}


/* 背景遮罩 */
.overlay{
  position:fixed;
  inset:0;

  background:rgba(0,0,0,0.2);
  backdrop-filter:blur(6px);

  opacity:0;
  pointer-events:none;

  transition:0.3s;
  z-index:1000;
}

.overlay.show{
  opacity:1;
  pointer-events:auto;
}

/* 侧边栏 */
.sidebar{
  position:fixed;
  top:0;
  left:0;

  width:250px;
  height:100%;

  padding:30px;

  background:rgba(255,255,255,0.55);
  backdrop-filter:blur(14px);

  border-radius:0 20px 20px 0;

  box-shadow:
    0 20px 60px rgba(0,0,0,0.25);

  transform:translateX(-110%);
  transition:transform .35s cubic-bezier(.2,.8,.2,1);

  z-index:1001;
}

/* 展开 */
.sidebar.open{
  transform:translateX(0);
}

/* 链接 */
.sidebar a{
  display:block;
  margin-top:14px;
  text-decoration:none;
  color:#333;
  font-size:16px;
}

/* hover */
.sidebar a:hover{
  opacity:.7;}
</style>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed, onBeforeMount, onMounted, provide, ref, watch } from 'vue'
import { Toaster } from 'vue-sonner'
import 'vue-sonner/style.css'

const route = useRoute()
const pageTitle = computed(() => route.meta.title ?? '默认标题')

const isLocal = process.env.NODE_ENV === "development"

const open = ref(false)
function OpenSidebar()
{  
open.value = true;
}

function CloseSidebar(){
open.value=false;
}

watch(() => route.fullPath, () => {
  open.value = false
})
</script>
