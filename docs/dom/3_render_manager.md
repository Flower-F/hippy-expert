# Render Manager

这是 Hippy DOM 实现原理的第三节。打开 /dom/src/dom 目录下的 layer_optimized_render_manager.cc 文件，以及 /renderer/native/android/src/main/jni/src/render/native_render_manager.cc 文件。

LayerOptimizedRenderManager 是一个继承于纯虚类 RenderManager 的类。RenderManager 就是用于定义了一个 render manager 所应该拥有的功能，比如节点的增删改查，布局的前后操作，事件的监听等等。然后其他具体的 RenderManager 就实现其中接口的具体功能，也就是继承与多态的概念。类似继承于 RenderManager 的还有 NativeRenderManager（下文会提到）、VoltronRenderManager（Flutter 相关，暂时略过）等。

## CreateRenderNode

```cpp
void LayerOptimizedRenderManager::CreateRenderNode(std::weak_ptr<RootNode> root_node,
                                                   std::vector<std::shared_ptr<DomNode>>&& nodes) {
  std::vector<std::shared_ptr<DomNode>> nodes_to_create;
  for (const auto& node : nodes) {
    node->SetLayoutOnly(ComputeLayoutOnly(node));
    if (!CanBeEliminated(node)) {
      UpdateRenderInfo(node);
      nodes_to_create.push_back(node);
    }
  }

  if (!nodes_to_create.empty()) {
    render_manager_->CreateRenderNode(root_node, std::move(nodes_to_create));
  }
}
```

这个函数封装的层级相对来说有一点多，我们来一步一步看。

```cpp
bool LayerOptimizedRenderManager::ComputeLayoutOnly(const std::shared_ptr<DomNode>& node) const {
  return node->GetViewName() == kTagNameView
         && CheckStyleJustLayout(node)
         && !node->HasEventListeners();
}
```

首先 GetViewName 这个函数作用就是返回映射后组件的名称，这个在 DOM Node 那节里面有讲到。kTagNameView 是字符串常量 View。在满足当前组件为 View 的情况下，会执行 CheckStyleJustLayout 函数，这个函数就是用于根据 style_map 值判断这到底是不是一个可以可以优化的 layout。那么什么是可以优化的 layout 呢？非常简单，在 kJustLayoutProps 属性中我们可以看到，只要是这其中所包含的属性都属于是纯粹的 layout。换言之，除了 opacity、background_color 或者 border 相关属性的改变外，一切的改变都是 **just layout**。当然也有例外，根据下面的条件判断语句就知道，比如当 background_color 为 0，opacity 为 1，borderWidth 为 0 这些情况下，也是属于 just layout。这也许会是一个性能优化可以探讨的方向。

```cpp
bool LayerOptimizedRenderManager::CheckStyleJustLayout(const std::shared_ptr<DomNode>& node) const {
  const auto &style_map = node->GetStyleMap();
  for (const auto &entry : *style_map) {
    const auto &key = entry.first;
    const auto &value = entry.second;

    if (key == kOpacity) {
      if (value->IsNull() || (value->IsNumber() && value->ToDoubleChecked() == 1)) {
        continue;
      }
    } else if (key == kBorderRadius) {
      const auto &background_color = style_map->find(kBackgroundColor);
      if (background_color != style_map->end() &&
          (*background_color).second->IsNumber() &&
          (*background_color).second->ToDoubleChecked() != 0) {
        return false;
      }
      const auto &border_width = style_map->find(kBorderWidth);
      if (border_width != style_map->end() &&
          (*border_width).second->IsNumber() &&
          (*border_width).second->ToDoubleChecked() != 0) {
        return false;
      }
    } else if (key == kBorderLeftColor) {
      if (value->IsNumber() && value->ToDoubleChecked() == 0) {
        continue;
      }
    } 
    ...
    return false;
  }
  return true;
}
```

## UpdateRenderNode

```cpp
void LayerOptimizedRenderManager::UpdateRenderNode(std::weak_ptr<RootNode> root_node,
                                                   std::vector<std::shared_ptr<DomNode>>&& nodes) {
  std::vector<std::shared_ptr<DomNode>> nodes_to_create;
  std::vector<std::shared_ptr<DomNode>> nodes_to_update;
  for (const auto& node : nodes) {
    bool could_be_eliminated = CanBeEliminated(node);
    node->SetLayoutOnly(ComputeLayoutOnly(node));
    if (!CanBeEliminated(node)) {
      if (could_be_eliminated) {
        UpdateRenderInfo(node);
        nodes_to_create.push_back(node);
      } else {
        nodes_to_update.push_back(node);
      }
    }
  }

  if (!nodes_to_create.empty()) {
    // step1: create child
    render_manager_->CreateRenderNode(root_node, std::vector<std::shared_ptr<DomNode>>(nodes_to_create));
    for (const auto& node : nodes_to_create) {
      // step2: move child
      std::vector<std::shared_ptr<DomNode>> moved_children;
      FindValidChildren(node, moved_children);
      if (!moved_children.empty()) {
        std::vector<int32_t> moved_ids;
        moved_ids.reserve(moved_children.size());
        for (const auto& moved_node : moved_children) {
          moved_ids.push_back(footstone::check::checked_numeric_cast<uint32_t, int32_t>(moved_node->GetId()));
        }
        MoveRenderNode(root_node, std::move(moved_ids),
                       footstone::check::checked_numeric_cast<uint32_t, int32_t>(node->GetRenderInfo().pid),
                       footstone::check::checked_numeric_cast<uint32_t, int32_t>(node->GetRenderInfo().id));
      }
    }
  }

  if (!nodes_to_update.empty()) {
    render_manager_->UpdateRenderNode(root_node, std::move(nodes_to_update));
  }
}
```

这个函数里面调用的 CanBeEliminated 函数，表示的是可以被淘汰的/排除在外的节点，它的内容是

```cpp
bool LayerOptimizedRenderManager::CanBeEliminated(const std::shared_ptr<DomNode>& node) {
  return node->IsLayoutOnly() || node->IsVirtual();
}
```

这里 IsLayoutOnly 的含义前面已经介绍过了，但是这个 IsVirtual 到底是什么意思呢，到底是不是众所周知的那个虚拟 DOM 的意思呢，目前还不太清楚，后面等我看到相对应的部分后再回来更新。知道的朋友可以在评论区回复一下或者到 Github 给我提一个 issue。

这里的逻辑就是处理未被淘汰的节点，装入 nodes_to_create 数组中，然后集中处理更新的节点。这里调用的是 NativeRenderManager 中的 CreateRenderNode 节点。这里面其实也就是涉及一些样式的操作，无非再特殊处理了一下 Text 类型的节点，所以这里不再详细展开。

## DeleteRenderNode

```cpp
void LayerOptimizedRenderManager::DeleteRenderNode(std::weak_ptr<RootNode> root_node,
                                                   std::vector<std::shared_ptr<DomNode>>&& nodes) {
  std::vector<std::shared_ptr<DomNode>> nodes_to_delete;
  for (const auto& node : nodes) {
    if (!CanBeEliminated(node)) {
      nodes_to_delete.push_back(node);
    } else {
      FindValidChildren(node, nodes_to_delete);
    }
  }
  if (!nodes_to_delete.empty()) {
    render_manager_->DeleteRenderNode(root_node, std::move(nodes_to_delete));
  }
}
```

函数内部会先查看节点是否是一个有效的节点，如果是就将其添加到 nodes_to_delete 数组中，如果不是的话会调用 FindValidChildren 方法。

```cpp
void LayerOptimizedRenderManager::FindValidChildren(const std::shared_ptr<DomNode>& node,
                                                    std::vector<std::shared_ptr<DomNode>>& valid_children_nodes) {
  for (size_t i = 0; i < node->GetChildCount(); i++) {
    auto child_node = node->GetChildAt(i);
    if (CanBeEliminated(child_node)) {
      FindValidChildren(child_node, valid_children_nodes);
    } else {
      valid_children_nodes.push_back(child_node);
    }
  }
}
```

这个方法就是通过递归调用找出所有有效的子节点，也就是说 DeleteRenderNode 目标就是删除所有的节点，只不过过滤掉了无效节点。

## UpdateRenderInfo

```cpp
void LayerOptimizedRenderManager::UpdateRenderInfo(const std::shared_ptr<DomNode>& node) {
  DomNode::RenderInfo render_info = node->GetRenderInfo();
  auto render_parent = GetRenderParent(node);
  if (render_parent) {
    int32_t index = CalculateRenderNodeIndex(render_parent, node);
    render_info.pid = render_parent->GetId();
    render_info.index = index;
  }
  node->SetRenderInfo(render_info);
}
```

render_info 这个东西在 DOM Node 的那一节我就有所提及。指的主要就是 id、pid、index 这三者。这里关注一下 CalculateRenderNodeIndex 方法，看看是怎么找到节点的 index 的。

```cpp
LayerOptimizedRenderManager::CalculateRenderNodeIndex(const std::shared_ptr<DomNode>& parent,
                                                      const std::shared_ptr<DomNode> &node,
                                                      int32_t index) {
  for (size_t i = 0; i < parent->GetChildCount(); i++) {
    std::shared_ptr<DomNode> child_node = parent->GetChildAt(i);
    if (child_node == node) {
      return std::make_pair(true, index);
    }

    if (CanBeEliminated(child_node)) {
      auto view_index = CalculateRenderNodeIndex(child_node, node, index);
      if (view_index.first) {
        return view_index;
      } else {
        index = view_index.second;
      }
    } else {
      index++;
    }
  }
  return std::make_pair(false, index);
}
```

这里哈希的结构是 key 为 bool 类型，value 为 int 类型。通过递归调用函数 CalculateRenderNodeIndex，最终找到传入的 node 的 index 值。
