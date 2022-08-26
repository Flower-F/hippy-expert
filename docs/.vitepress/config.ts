import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'en-US',
  title: 'Hippy Expert',
  description: 'Hippy 源码解析',

  lastUpdated: true,
  cleanUrls: 'without-subfolders',

  themeConfig: {
    sidebar: {
      '/dom/': sidebarDom(),
    },

    nav: nav(),

    editLink: {
      pattern: 'https://github.com/vuejs/vitepress/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/vuejs/vitepress' }
    ],

    footer: {
      message: 'MIT License',
      copyright: 'Built with VitePress | Flower-F'
    },
  }
})

function sidebarDom() {
  return [
    {
      text: 'DOM',
      collapsible: true,
      items: [
        { text: 'Hippy Dom 原理解析一', link: '/dom/dom-1' },
        { text: 'Hippy Dom 原理解析二', link: '/dom/dom-2' }
      ]
    }
  ]
}

function nav() {
  return [
    { text: 'DOM', link: '/dom/index', activeMatch: '/dom/' },
  ]
}
