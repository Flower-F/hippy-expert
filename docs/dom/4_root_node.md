# Root Node

这是 Hippy DOM 实现原理的第四节。打开 /dom/src/dom 目录下的 root_node.cc 文件。这节本来安排的是 dom_event.cc 和 dom_event.h 的内容，但是因为关于 dom_event.cc 本身其实没什么好说的，内部不包含任何逻辑操作，所以我们直接开始讲解 Root Node。

这一节主要是涉及到 DOM 的创建、更新、删除、Diff 算法。

## CreateDomNodes

```cpp
void RootNode::CreateDomNodes(std::vector<std::shared_ptr<DomInfo>>&& nodes) {
  for (const auto& interceptor : interceptors_) {
    interceptor->OnDomNodeCreate(nodes);
  }
  std::vector<std::shared_ptr<DomNode>> nodes_to_create;
  for (const auto& node_info : nodes) {
    auto node = node_info->dom_node;
    std::shared_ptr<DomNode> parent_node = GetNode(node->GetPid());
    if (parent_node == nullptr) {
      continue;
    }
    nodes_to_create.push_back(node);
    node->ParseLayoutStyleInfo();
    parent_node->AddChildByRefInfo(node_info);
    auto event = std::make_shared<DomEvent>(kDomCreated, node, nullptr);
    node->HandleEvent(event);
    OnDomNodeCreated(node);
  }
  for(const auto& node: nodes_to_create) {
      node->SetRenderInfo({node->GetId(), node->GetPid(), node->GetSelfIndex()});
  }
  auto event = std::make_shared<DomEvent>(kDomTreeCreated, weak_from_this(), nullptr);
  HandleEvent(event);

  if (!nodes_to_create.empty()) {
    dom_operations_.push_back({DomOperation::kOpCreate, nodes_to_create});
  }
}
```

这个函数主要是进行 DOM 节点创建相关的操作。这里首先是对所有的 interceptor 执行了 OnDomNodeCreate 方法，这个方法里面是一些与 Animation，也就是动画相关的内容，这里先略过。接下来是遍历了每一个节点，对每一个节点依次执行三个方法：

- ParseLayoutStyleInfo：内部调用了 SetLayoutStyles 方法，SetLayoutStyles 方法内部再调用 Parser 方法（位于 taitank_layout_node.cc 文件）。而 Parser 内部的逻辑就是很简单地根据传入的 style_map 进行所有样式属性的初始化操作。

```cpp
void TaitankLayoutNode::Parser(std::unordered_map<std::string, std::shared_ptr<footstone::value::HippyValue>>& style_map) {
  if (style_map.find(kWidth) != style_map.end()) {
    SET_STYLE_VALUE(Width, 0)
  }
  if (style_map.find(kMinWidth) != style_map.end()) {
    SET_STYLE_VALUE(MinWidth, 0)
  }
  if (style_map.find(kMaxWidth) != style_map.end()) {
    SET_STYLE_VALUE(MaxWidth, 0)
  }
  ...
}
```

- AddChildByRefInfo：这个函数在之前的文章 DOM Node 解析里面有讲到，就是根据 ref_info 上的 relative_to_ref 属性，来决定从 children 数组的什么位置插入子节点
- HandleEvent：这个函数的讲解在下面，目前只需要知道它就是进行事件处理即可。这里是处理了一种类型叫做 DomCreated 的事件，也就是说 DOM 树的创建本身也是一种事件类型。

之后进行了 id、pid、index 的赋值操作，再触发事件 DomTreeCreated，然后再往 dom_operations_ 数组里面插入一个常量标记 kOpCreate 表示创建成功。

## UpdateDomNodes

```cpp
void RootNode::UpdateDomNodes(std::vector<std::shared_ptr<DomInfo>>&& nodes) {
  for (const auto& interceptor : interceptors_) {
    interceptor->OnDomNodeUpdate(nodes);
  }
  std::vector<std::shared_ptr<DomNode>> nodes_to_update;
  for (const auto& node_info : nodes) {
    std::shared_ptr<DomNode> dom_node = GetNode(node_info->dom_node->GetId());
    if (dom_node == nullptr) {
      continue;
    }
    nodes_to_update.push_back(dom_node);

    auto style_diff_value = DiffUtils::DiffProps(*dom_node->GetStyleMap(), *node_info->dom_node->GetStyleMap());
    auto ext_diff_value = DiffUtils::DiffProps(*dom_node->GetExtStyle(), *node_info->dom_node->GetExtStyle());
    auto style_update = std::get<0>(style_diff_value);
    auto ext_update = std::get<0>(ext_diff_value);
    std::shared_ptr<DomValueMap> diff_value = std::make_shared<DomValueMap>();
    if (style_update) {
      diff_value->insert(style_update->begin(), style_update->end());
    }
    if (ext_update) {
      diff_value->insert(ext_update->begin(), ext_update->end());
    }
    dom_node->SetStyleMap(node_info->dom_node->GetStyleMap());
    dom_node->SetExtStyleMap(node_info->dom_node->GetExtStyle());
    dom_node->SetDiffStyle(diff_value);
    auto style_delete = std::get<1>(style_diff_value);
    auto ext_delete = std::get<1>(ext_diff_value);
    std::shared_ptr<std::vector<std::string>> delete_value = std::make_shared<std::vector<std::string>>();
    if (style_delete) {
      delete_value->insert(delete_value->end(), style_delete->begin(), style_delete->end());
    }
    if (ext_delete) {
      delete_value->insert(delete_value->end(), ext_delete->begin(), ext_delete->end());
    }
    dom_node->SetDeleteProps(delete_value);
    node_info->dom_node->SetDiffStyle(diff_value);
    node_info->dom_node->SetDeleteProps(delete_value);
    dom_node->ParseLayoutStyleInfo();
    auto event = std::make_shared<DomEvent>(kDomUpdated, dom_node, nullptr);
    dom_node->HandleEvent(event);
  }

  auto event = std::make_shared<DomEvent>(kDomTreeUpdated, weak_from_this(), nullptr);
  HandleEvent(event);

  if (!nodes_to_update.empty()) {
    dom_operations_.push_back({DomOperation::kOpUpdate, nodes_to_update});
  }
}
```

这里的重点是调用 DiffProps 方法比较前后的 style（样式） 和 extStyle（预处理完成后的样式）。记得之前所说的，DiffProps 最终返回的是一个 tuple，第一项是 update_props，第二项是 delete_props。所以这里 get<0>(style_diff_value) 就是拿出 update_props，get<1>(style_diff_value) 就是拿出 delete_props。然后，变量 diff_value（一张哈希表）会依次存储 style_update 的所有内容，以及 ext_update 的所有内容。接下来的删除操作也类似，只不过 delete_props 的数据结构从哈希表换成了 vector。这里使用不同数据结构的原因尚待进一步考究，猜测可能与顺序或者效率相关。最后，触发一个 DomUpdated 事件，并把对应的操作类型 kOpUpdate 加入 dom_operations_ 数组中。另外，这里还有一个值得注意的点是 Update 结束之后并没有直接把 delete_props 删除，而是先通过 delete_props 属性暂时存储着，后续才会执行真正的删除操作。

## DeleteDomNodes

```cpp
void RootNode::DeleteDomNodes(std::vector<std::shared_ptr<DomInfo>>&& nodes) {
  for (const auto& interceptor : interceptors_) {
    interceptor->OnDomNodeDelete(nodes);
  }
  std::vector<std::shared_ptr<DomNode>> nodes_to_delete;
  for (const auto & it : nodes) {
    std::shared_ptr<DomNode> node = GetNode(it->dom_node->GetId());
    if (node == nullptr) {
      continue;
    }
    nodes_to_delete.push_back(node);
    std::shared_ptr<DomNode> parent_node = node->GetParent();
    if (parent_node != nullptr) {
      parent_node->RemoveChildAt(parent_node->IndexOf(node));
    }
    auto event = std::make_shared<DomEvent>(kDomDeleted, node, nullptr);
    node->HandleEvent(event);
    OnDomNodeDeleted(node);
  }

  auto event = std::make_shared<DomEvent>(kDomTreeDeleted, weak_from_this(), nullptr);
  HandleEvent(event);

  if (!nodes_to_delete.empty()) {
    dom_operations_.push_back({DomOperation::kOpDelete, nodes_to_delete});
  }
}
```

这里就是使用 nodes_to_delete 数组来存储删除的 props 内容，然后跟前面一样，触发一个事件 DomDeleted。这里与前面不同的点是，前面的方法中触发事件即表明函数的结束，这里还需要执行 OnDomNodeDeleted 函数。原因可以从 OnDomNodeDeleted 函数中看出来。

```cpp
void RootNode::OnDomNodeDeleted(const std::shared_ptr<DomNode> &node) {
  if (node) {
    for (const auto &child : node->GetChildren()) {
      if (child) {
        OnDomNodeDeleted(child);
      }
    }
    nodes_.erase(node->GetId());
  }
}
```

这个函数很简单，作用就是递归删除该节点下的所有子节点。

## SyncWithRenderManager

先从函数名称说起，这里的含义是将 RenderManager 的内容进行同步。

```cpp
void RootNode::SyncWithRenderManager(const std::shared_ptr<RenderManager>& render_manager) {
  FlushDomOperations(render_manager);
  FlushEventOperations(render_manager);
  DoAndFlushLayout(render_manager);
  render_manager->EndBatch(GetWeakSelf());
}
```

函数内部调用了三个函数，分别表示批处理 DOM 节点、批处理事件、批处理布局（样式）。我们依次解析一下这三个函数。

```cpp
void RootNode::FlushDomOperations(const std::shared_ptr<RenderManager>& render_manager) {
  for (auto& dom_operation : dom_operations_) {
    switch (dom_operation.op) {
      case DomOperation::kOpCreate:
        render_manager->CreateRenderNode(GetWeakSelf(), std::move(dom_operation.nodes));
        break;
      case DomOperation::kOpUpdate:
        render_manager->UpdateRenderNode(GetWeakSelf(), std::move(dom_operation.nodes));
        break;
      case DomOperation::kOpDelete:
        render_manager->DeleteRenderNode(GetWeakSelf(), std::move(dom_operation.nodes));
        break;
      case DomOperation::kOpMove:
        render_manager->MoveRenderNode(GetWeakSelf(), std::move(dom_operation.nodes));
        break;
      default:
        break;
    }
  }
  dom_operations_.clear();
}
```

这里就是根据前面一直多次提到的 dom_operations_ 数组里面所记录的操作，统一执行**增删移查**操作。函数以 Flush 开头，相信你一定会马上想到 React 中大名鼎鼎的批处理函数 flushBatchedUpdates。flush 的意思就是一股脑、一次性处理掉的意思，这里也就是一次性集中处理掉 dom_operations_ 数组中的操作。具体的 CreateRenderNode、DeleteRenderNode 都没有进行重写，可以看前面 Render Manager 那节的内容。UpdateRenderNode 是进行了重写，内容如下。

```cpp
void RootNode::UpdateRenderNode(const std::shared_ptr<DomNode>& node) {
  auto dom_manager = dom_manager_.lock();
  if (!dom_manager) {
    return;
  }
  auto render_manager = dom_manager->GetRenderManager().lock();
  if (!render_manager) {
    return;
  }

  // 更新 layout tree
  node->ParseLayoutStyleInfo();

  // 更新属性
  std::vector<std::shared_ptr<DomNode>> nodes;
  nodes.push_back(node);
  render_manager->UpdateRenderNode(GetWeakSelf(), std::move(nodes));
  SyncWithRenderManager(render_manager);
}
```

这里是通过递归调用 UpdateRenderNode 函数，不断更新，然后再一次性通过 SyncWithRenderManager 同步前面的操作。

```cpp
void RootNode::FlushEventOperations(const std::shared_ptr<RenderManager>& render_manager) {
  for (auto& event_operation : event_operations_) {
    const auto& node = GetNode(event_operation.id);
    if (node == nullptr) {
      continue;
    }

    switch (event_operation.op) {
      case EventOperation::kOpAdd:
        render_manager->AddEventListener(GetWeakSelf(), node, event_operation.name);
        break;
      case EventOperation::kOpRemove:
        render_manager->RemoveEventListener(GetWeakSelf(), node, event_operation.name);
        break;
      default:
        break;
    }
  }
  event_operations_.clear();
}
```

FlushEventOperations 这个函数比较简单，就是做一些事件监听和移除，这里不多做解析。

```cpp

void RootNode::DoAndFlushLayout(const std::shared_ptr<RenderManager>& render_manager) {
  // Before Layout
  render_manager->BeforeLayout(GetWeakSelf());
  // 触发布局计算
  std::vector<std::shared_ptr<DomNode>> layout_changed_nodes;
  DoLayout(layout_changed_nodes);
  // After Layout
  render_manager->AfterLayout(GetWeakSelf());

  if (!layout_changed_nodes.empty()) {
    render_manager->UpdateLayout(GetWeakSelf(), layout_changed_nodes);
  }
}
```

这里调用的是 DOM Node 的 DoLayout 函数，在  DOM Node 那一节我也有介绍。

## HandleEvent

这个函数其实挺重要的，但是源码里面注释非常详细了，我也就不打算多做解释。

```cpp
void RootNode::HandleEvent(const std::shared_ptr<DomEvent>& event) {
  auto weak_target = event->GetTarget();
  auto event_name = event->GetType();
  auto target = weak_target.lock();
  if (target) {
    std::stack<std::shared_ptr<DomNode>> capture_list = {};
    // 执行捕获流程，注：target节点event.StopPropagation并不会阻止捕获流程
    if (event->CanCapture()) {
      // 获取捕获列表
      auto parent = target->GetParent();
      while (parent) {
        capture_list.push(parent);
        parent = parent->GetParent();
      }
    }
    auto capture_target_listeners = target->GetEventListener(event_name, true);
    auto bubble_target_listeners = target->GetEventListener(event_name, false);
    // 捕获列表反过来就是冒泡列表，不需要额外遍历生成
    auto runner = delegate_task_runner_.lock();
    if (runner) {
      auto func = [capture_list = std::move(capture_list),
                   capture_target_listeners = std::move(capture_target_listeners),
                   bubble_target_listeners = std::move(bubble_target_listeners),
                   dom_event = std::move(event),
                   event_name]() mutable {
        // 执行捕获流程
        std::stack<std::shared_ptr<DomNode>> bubble_list = {};
        while (!capture_list.empty()) {
          auto capture_node = capture_list.top();
          capture_list.pop();
          dom_event->SetCurrentTarget(capture_node);  // 设置当前节点，cb里会用到
          auto listeners = capture_node->GetEventListener(event_name, true);
          for (const auto& listener : listeners) {
            dom_event->SetEventPhase(EventPhase::kCapturePhase);
            listener->cb(dom_event);  // StopPropagation并不会影响同级的回调调用
          }
          if (dom_event->IsPreventCapture()) {  // cb 内部调用了 event.StopPropagation 会阻止捕获
            return;  // 捕获流中StopPropagation不仅会导致捕获流程结束，后面的目标事件和冒泡都会终止
          }
          bubble_list.push(std::move(capture_node));
        }
        // 执行本身节点回调
        dom_event->SetCurrentTarget(dom_event->GetTarget());
        for (const auto& listener : capture_target_listeners) {
          dom_event->SetEventPhase(EventPhase::kAtTarget);
          listener->cb(dom_event);
        }
        if (dom_event->IsPreventCapture()) {
          return;
        }
        for (const auto& listener : bubble_target_listeners) {
          dom_event->SetEventPhase(EventPhase::kAtTarget);
          listener->cb(dom_event);
        }
        if (dom_event->IsPreventBubble()) {
          return;
        }
        // 执行冒泡流程
        while (!bubble_list.empty()) {
          auto bubble_node = bubble_list.top();
          bubble_list.pop();
          dom_event->SetCurrentTarget(bubble_node);
          auto listeners = bubble_node->GetEventListener(event_name, false);
          for (const auto& listener : listeners) {
            dom_event->SetEventPhase(EventPhase::kBubblePhase);
            listener->cb(dom_event);
          }
          if (dom_event->IsPreventBubble()) {
            break;
          }
        }
      };
      runner->PostTask(std::move(func));
    }
  }
}
```

## Traverse

```cpp
void RootNode::Traverse(const std::function<void(const std::shared_ptr<DomNode>&)>& on_traverse) {
  std::stack<std::shared_ptr<DomNode>> stack;
  stack.push(shared_from_this());
  while(!stack.empty()) {
    auto top = stack.top();
    stack.pop();
    on_traverse(top);
    auto children = top->GetChildren();
    if (!children.empty()) {
      for (auto it = children.rbegin(); it != children.rend(); ++it) {
        stack.push(*it);
      }
    }
  }
}
```

这个函数就是大家所非常熟悉的前序遍历，只不过是用栈的方式改写了而已。
