import { createRouter, createWebHistory } from 'vue-router'

/**
 * 从入口脚本位置推导部署目录：
 * 根目录得到 /，子目录部署得到 /app/，不受当前路由影响。
 */
function appBase(): string {
  const scripts = [
    ...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'),
  ]
  const paths = scripts.map(
    (script) => new URL(script.src, window.location.href).pathname,
  )
  // 开发环境优先匹配 Vite 注入的真实入口 /src/main.ts，忽略 /@vite/client
  for (const path of paths) {
    const srcAt = path.indexOf('/src/')
    if (srcAt >= 0) return path.slice(0, srcAt + 1) || '/'
  }
  for (const path of paths) {
    const assetsAt = path.indexOf('/assets/')
    if (assetsAt >= 0) return path.slice(0, assetsAt + 1) || '/'
  }
  return '/'
}

const router = createRouter({
  history: createWebHistory(appBase()),
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
