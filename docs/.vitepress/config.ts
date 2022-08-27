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
      pattern: 'https://github.com/Flower-F/hippy-expert/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Flower-F/hippy-expert' }
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
        { text: 'DOM Node', link: '/dom/1_dom_node' },
        { text: 'Root Node', link: '/dom/2_root_node' }
      ]
    }
  ]
}

function nav() {
  return [
    { text: 'DOM', link: '/dom/index', activeMatch: '/dom/' },
    { text: 'Hippy React', link: '/hippy-react/index', activeMatch: '/hippy-react/' },
  ]
}
