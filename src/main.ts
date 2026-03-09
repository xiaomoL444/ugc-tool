import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { consola, LogLevels } from "consola";
import { StorageClass } from "./services/storage/storage";
import PrimeVue from "primevue/config";

consola.level = LogLevels.trace;
async function bootstrap() {
  const storage = StorageClass.getInstance().setProject("myProject");
  await storage.init(); // 等待完成
  const app = createApp(App).use(router).use(PrimeVue);
  app.provide("storage", storage); // 注入全局
  app.mount("#app");
}

bootstrap();
