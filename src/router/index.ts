import { createRouter, createWebHistory, RouteRecordRaw } from "vue-router";
import HomeView from "../views/HomeView.vue";
import StructViewer from "@/views/StructViewer/StructViewer.vue";
import DebugView from "@/views/DebugView/DebugView.vue";
import TextGradient from "@/views/TextGradient/TextGradient.vue";
import NotFound from "@/views/NotFound/NotFound.vue";
import PixelArt from "@/views/PixelArt/PixelArt.vue";
import HomePage from "@/views/HomePage/HomePage.vue";
import SoundEffectPlayer from "@/views/SoundEffectPlayer/SoundEffectPlayer.vue";
import { appRoutes } from "@/configs/routes";

const routes = [
  ...appRoutes.map((r) => ({
    path: r.path,
    name: r.name,
    component: () => import(`@/views/${r.name}/${r.name}.vue`),
    meta: {
      title: r.title,
    },
  })),
  {
    path: "/",
    name: "home",
    component: HomePage,
    meta: {
      title: "标题页",
    },
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
    path: "/UGCPixelArt",
    redirect: "/PixelArt",
  },
  // 404 路由
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
