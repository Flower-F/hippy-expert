import { SidebarConfig } from 'vuepress';

export const sidebar: SidebarConfig = {
  '/dom/': [
    {
      text: 'Hippy DOM 原理解析',
      children: [
        '/dom/README.md',
        '/dom/1_dom_node.md',
        '/dom/2_diff_utils.md',
        '/dom/3_render_manager.md',
        '/dom/4_root_node.md',
      ]
    }
  ],
  '/hippy-react/': [
    {
      text: 'Hippy React 原理解析',
      children: [
        '/hippy-react/README.md',
      ]
    }
  ],
}
