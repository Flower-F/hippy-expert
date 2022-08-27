# Root Node

这是 Hippy DOM 实现原理的第三节。打开 /dom/src/dom 目录下的 root_node.cc 文件。

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

- AddChildByRefInfo：这个函数在上一篇文章 DOM Node 解析里面有讲到，就是根据 ref_info 上的 relative_to_ref 属性，来决定从 children 数组的什么位置插入子节点
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

这里的重点是调用 DiffProps 方法比较前后的 style（样式） 和 extStyle（预处理完成后的样式），还有一个值得注意的点是 Update 结束之后并没有直接把 delete_props 删除，而是先通过 delete_props 属性暂时存储着。

# HandleEvent

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
