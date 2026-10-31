import { createRouter, createWebHistory } from "vue-router";
import PracticeView from "../views/PracticeView.vue";
import MistakesView from "../views/MistakesView.vue";
import MockView from "../views/MockView.vue";
import DashboardView from "../views/DashboardView.vue";
import HomeView from "../views/HomeView.vue";
import AdminStatsView from "../views/AdminStatsView.vue";
import NotFoundView from "../views/NotFoundView.vue";

const SITE_NAME = "mctl academy";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView, meta: { title: "Home" } },
    { path: "/practice", name: "practice", component: PracticeView, meta: { title: "Practice" } },
    { path: "/mistakes", name: "mistakes", component: MistakesView, meta: { title: "Review mistakes" } },
    { path: "/mock", name: "mock", component: MockView, meta: { title: "Mock exam" } },
    { path: "/dashboard", name: "dashboard", component: DashboardView, meta: { title: "Progress" } },
    // Unlisted — no AppNav entry, same convention as the moderator-only
    // /api/reports route it reads from. Reachable by direct URL only.
    { path: "/admin/stats", name: "admin-stats", component: AdminStatsView, meta: { title: "Stats" } },
    {
      path: "/:pathMatch(.*)*",
      name: "not-found",
      component: NotFoundView,
      meta: { title: "Page not found" },
    },
  ],
  // A new page starts at the top; a query-only change (a practice domain
  // filter) or back/forward keeps the browser's own position.
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.path !== from.path) return { top: 0 };
    return false;
  },
});

export function pageTitle(title: unknown): string {
  return typeof title === "string" && title ? `${title} · ${SITE_NAME}` : SITE_NAME;
}

router.afterEach((to, from) => {
  if (typeof document === "undefined") return;
  document.title = pageTitle(to.meta.title);
  // After an in-app navigation (not the first load), move focus to the main
  // region so keyboard and screen-reader users start at the new page rather
  // than on the link they just activated. Query-only changes keep focus.
  if (from.matched.length > 0 && to.path !== from.path) {
    requestAnimationFrame(() => document.getElementById("main-content")?.focus({ preventScroll: true }));
  }
});
