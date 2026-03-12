import { createRouter, createWebHistory, RouteRecordRaw } from "vue-router";
import HomeView from "../views/HomeView.vue";
import StructViewer from "@/views/StructViewer/StructViewer.vue";
import DebugView from "@/views/DebugView/DebugView.vue";
import SoundEffectPlayer from "@/views/SoundEffectPlayer/SoundEffectPlayer.vue";
import TextGradient from "@/views/TextGradient/TextGradient.vue";
import NotFound from "@/views/NotFound/NotFound.vue";
import PixelArt from "@/views/PixelArt/PixelArt.vue";

const routes = [
  {
    path: "/",
    name: "home",
    component: HomeView,
  },
  {
    path: "/about",
    name: "about",
    // route level code-splitting
    // this generates a separate chunk (about.[hash].js) for this route
    // which is lazy-loaded when the route is visited.
    component: () =>
      import(/* webpackChunkName: "about" */ "../views/AboutView.vue"),
  },
  {
    path: "/UGCStructViewer",
    redirect: "/StructViewer",
  },
  {
    path: "/StructViewer",
    name: "千星奇域·结构体编辑器",
    component: StructViewer,
    meta: {
      title: "结构体编辑器",
    },
  },
  {
    path: "/DebugPanel",
    name: "嗯，这是一个用来Debug的页面，你是怎么找到这里的？",
    component: DebugView,
    meta: {
      title: "嗯，这是一个用来Debug的页面，你是怎么找到这里的？",
    },
  },
  {
    path: "/UGCSoundEffectPlayer",
    redirect: "/SoundEffectPlayer",
  },
  {
    path: "/SoundEffectPlayer",
    name: "音效播放器",
    component: SoundEffectPlayer,
    meta: {
      title: "音效播放器",
    },
  },
    {
    path: "/UGCPixelArt",
    redirect: "/PixelArt",
  },
  {
    path: "/PixelArt",
    name: "音效播放器",
    component: PixelArt,
    meta: {
      title: "图片转像素画",
    },
  },
  {
    path: "/TextGradient",
    name: "文本渐变器",
    component: TextGradient,
    meta: {
      title: "文本渐变器",
    },
  }, // 404 路由
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: NotFound,
    meta: {
      title: "4~0~4~N~o~t~F~o~u~n~d~",
    },
  },
];

const router = createRouter({
  history: createWebHistory(process.env.BASE_URL),
  routes,
});

export default router;
