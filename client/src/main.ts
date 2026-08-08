import { createApp } from "vue";
import "@mctlhq/css/theme.css";
import "@mctlhq/css/global.css";
import "@mctlhq/ui/style.css";
import "./app.css";
import App from "./App.vue";
import { router } from "./router";
import { initTheme } from "./theme";

initTheme();

createApp(App).use(router).mount("#root");
