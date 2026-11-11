import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  // hash 模式不依赖服务器把未知路径回退到 index.html
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'editor',
      component: () => import('../App.vue'),
      meta: { title: '场馆白膜 · Grid Massing Studio' },
    },
    {
      path: '/multiplayer',
      name: 'multiplayer',
      component: () => import('../multiplayer/MultiplayerApp.vue'),
      meta: { title: '多人漫游 · Grid Massing Studio' },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const title = to.meta.title
  document.title = typeof title === 'string' ? title : 'Grid Massing Studio'
})

export default router
