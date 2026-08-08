import { createRouter, createWebHistory } from "vue-router";
import PracticeView from "../views/PracticeView.vue";
import MistakesView from "../views/MistakesView.vue";
import MockView from "../views/MockView.vue";
import DashboardView from "../views/DashboardView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/practice" },
    { path: "/practice", name: "practice", component: PracticeView },
    { path: "/mistakes", name: "mistakes", component: MistakesView },
    { path: "/mock", name: "mock", component: MockView },
    { path: "/dashboard", name: "dashboard", component: DashboardView },
  ],
});
