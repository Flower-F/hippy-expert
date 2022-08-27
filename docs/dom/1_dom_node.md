# DOM Node

打开 /dom/src/dom 目录下的 dom_node.cc 文件，这将是 Hippy DOM 原理解析的开始。说明一下，为了得到更清晰的逻辑路径本文贴出的代码并不完整，基本都是我删减得到的版本。我主要是解读一些逻辑相关的部分，一些比较简单的工具函数就略过不讲了。

## IndexOf

顾名思义就是寻找子节点所在的下标，这里是调用了一个 `checked_numeric_cast` 的方法，我们可以看一下这个方法具体做了什么。

```cpp
template<typename SourceType, typename TargetType>
static constexpr bool numeric_cast(const SourceType& source, TargetType& target) {
  auto target_value = static_cast<TargetType>(source);
  if (static_cast<SourceType>(target_value) != source || (target_value < 0 && source > 0)
      || (target_value > 0 && source < 0)) {
    return false;
  }
  target = target_value;
  return true;
}
```

在 C++ 中，我们经常需要把不同类型的数字互相转换，如将一个数字在 long long 和 int 之间转换。但由于各数字的精度不同，当一个数字从**大类型到小类型**转换时就可能导致转换失败。numeric_cast 做的事情就是在转换失败的时候返回一个 false，成功的时候返回 true，使得我们可以人为把控转换的成功与否。

## AddChildByRefInfo

这个函数简化之后如下所示，核心逻辑也很简单，就是根据 ref_info 上的 relative_to_ref，来决定从 children 数组的什么位置插入子节点（根据 id 插入到某个 child 的左边或右边）。

```cpp
int32_t DomNode::AddChildByRefInfo(const std::shared_ptr<DomInfo>& dom_info) {
  std::shared_ptr<RefInfo> ref_info = dom_info->ref_info;
  if (ref_info) {
    for (uint32_t i = 0; i < children_.size(); ++i) {
      auto child = children_[i];
      if (ref_info->ref_id == child->GetId()) {
        if (ref_info->relative_to_ref == RelativeType::kFront) {
          children_.insert(
              children_.begin() + footstone::check::checked_numeric_cast<uint32_t, int32_t>(i),
              dom_info->dom_node);
        } else {
          children_.insert(
              children_.begin() + footstone::check::checked_numeric_cast<uint32_t, int32_t>(i + 1),
              dom_info->dom_node);
        }
        break;
      }
      if (i == children_.size() - 1) {
        children_.push_back(dom_info->dom_node);
        break;
      }
    }
  } else {
    children_.push_back(dom_info->dom_node);
  }
}
```

## DoLayout

这个函数主要是调用了 CalculateLayout 函数和 TransferLayoutOutputsRecursive 函数。

暂时只需要知道 CalculateLayout 里面执行的是一些关于 flex 布局的操作，与 Hippy Engine 相关。然后我们重点放在 TransferLayoutOutputsRecursive 函数中。

从 TransferLayoutOutputsRecursive 名字可以看出，这个函数一定是递归调用进行布局操作。这里 changed 表示的是布局是否发生了改变，只要任意几何属性发生改变即触发了页面布局的改变，比如 left、hight、margin 等等，这也符合我们对前端的认知。

这里无论 layout_param 还是 layout_obj 都是哈希表，紧接着我们可以看到执行了事件处理操作，具体的事件处理细节在 root_node 文件中，里面涉及到事件的捕获和冒泡，相关的内容我们下次再说。

**根据这里的逻辑我们可以知道，Hippy 的处理方式是先处理父级 DOM 树的渲染，再处理自己的事件，再递归处理子树的渲染，子树的事件，以此类推。**

```cpp
void DomNode::TransferLayoutOutputsRecursive(std::vector<std::shared_ptr<DomNode>>& changed_nodes) {
  render_layout_ = layout_;

  if (render_info_.pid != pid_) {
    // 计算最终坐标
    auto parent = GetParent();
    while (parent != nullptr && parent->GetId() != render_info_.pid) {
      render_layout_.left += parent->layout_.left;
      render_layout_.top += parent->layout_.top;
      parent = parent->GetParent();
    }
    changed |= true;
  }

  layout_node_->SetHasNewLayout(false);
  if (changed) {
    changed_nodes.push_back(shared_from_this());
    HippyValueObjectType layout_param;
    layout_param[kLayoutXKey] = HippyValue(layout_.left);
    layout_param[kLayoutYKey] = HippyValue(layout_.top);
    layout_param[kLayoutWidthKey] = HippyValue(layout_.width);
    layout_param[kLayoutHeightKey] = HippyValue(layout_.height);
    HippyValueObjectType layout_obj;
    layout_obj[kLayoutLayoutKey] = layout_param;
    auto event =
        std::make_shared<DomEvent>(kLayoutEvent,
                                   weak_from_this(),
                                   std::make_shared<HippyValue>(std::move(layout_obj)));
    HandleEvent(event);
  }
  for (auto& it: children_) {
    it->TransferLayoutOutputsRecursive(changed_nodes);
  }
}
```

## AddEventListener

这个函数和 Web 里面 addEventListener 的定义类似。这里 event_listener_map_ 是一张用于记录事件 id 的哈希表，哈希表里面的每一个 key 就是一种事件类型，对应的 value 是一个大小为 2 的数组。为什么大小为 2 呢，相信你很容易就能猜到，因为事件分为冒泡和捕获两种类型，需要分开处理。

```cpp
void DomNode::AddEventListener(const std::string& name,
                               uint64_t listener_id,
                               bool use_capture,
                               const EventCallback& cb) {
  current_callback_id_ += 1;

  auto it = event_listener_map_->find(name);
  if (it == event_listener_map_->end()) {
    (*event_listener_map_)[name] = {};
    auto root_node = root_node_.lock();
    if (root_node) {
      root_node->AddEvent(GetId(), name);
    }
  }
  if (use_capture) {
    (*event_listener_map_)[name][kCapture].push_back(std::make_shared<EventListenerInfo>(
        listener_id,
        cb));
  } else {
    (*event_listener_map_)[name][kBubble].push_back(std::make_shared<EventListenerInfo>(
        listener_id,
        cb));
  }
}
```

然后再说明一下这里 lock() 的作用。这里 lock() 本质就是尝试获取这个对象的地址，但是不知道对象销毁了没，然后再通过一个条件语句判断，即可保证对象在未被销毁的情况下调用。

```cpp
auto root_node = root_node_.lock();
if (root_node) {
  root_node->AddEvent(GetId(), name);
}
```

## RemoveEventListener

这一步做的就是根据 id 和事件类型删除捕获和冒泡的事件。

```cpp
void DomNode::RemoveEventListener(const std::string& name, uint64_t listener_id) {
  auto it = event_listener_map_->find(name);

  // 根据 id 和事件类型删除捕获的事件
  auto capture_listeners = it->second[kCapture];
  auto capture_it = std::find_if(capture_listeners.begin(), capture_listeners.end(),
                                 [listener_id](const std::shared_ptr<EventListenerInfo>& item) {
                                   if (item->id == listener_id) {
                                     return true;
                                   }
                                   return false;
                                 });


  // 根据 id 和事件类型删除冒泡的事件
  auto bubble_listeners = it->second[kBubble];
  auto bubble_it = std::find_if(bubble_listeners.begin(), bubble_listeners.end(),
                                [listener_id](const std::shared_ptr<EventListenerInfo>& item) {
                                  if (item->id == listener_id) {
                                    return true;
                                  }
                                  return false;
                                });

  if (capture_listeners.empty() && bubble_listeners.empty()) {
    event_listener_map_->erase(it);
    auto root_node = root_node_.lock();
    if (root_node) {
      root_node->RemoveEvent(GetId(), name);
    }
  }
}
```

## EmplaceStyleMap

这个函数涉及到 Hippy 是如何根据指定的 key 插入新的 style：原来没有这个 key，直接尾部插入；原来有这个 key 了，就递归替换掉原来的样式。这个函数主要是调用了 ReplaceStyle 方法，递归进行了 style 的替换。首先我们可以知道这一过程分开处理了数组和对象这两种情况，这也符合 Hippy style 对象既可以是对象也可以是数组的特征。代码中 ToObjectChecked 也好，ToArrayChecked 也好，都只是做了一些类型转换和校验的操作。replaced 变量主要是标记是否完成了整个 style 的遍历，完成之后就会退出递归。

```cpp
void DomNode::EmplaceStyleMap(const std::string& key, const HippyValue& value) {
  auto iter = style_map_->find(key);
  if (iter != style_map_->end()) {
    // 原来没有这个 key，直接尾部插入
    iter->second = std::make_shared<HippyValue>(value);
  } else {
    // 递归替换掉原来的样式
    bool replaced = false;
    for (auto& style: *style_map_) {
      replaced = ReplaceStyle(*style.second, key, value);
      if (replaced) return;
    }
    style_map_->insert({key, std::make_shared<HippyValue>(value)});
  }
}
```

```cpp
bool DomNode::ReplaceStyle(HippyValue& style, const std::string& key, const HippyValue& value) {
  if (style.IsObject()) {
    auto& object = style.ToObjectChecked();
    if (object.find(key) != object.end()) {
      object.at(key) = value;
      return true;
    }

    bool replaced = false;
    for (auto& o: object) {
      replaced = ReplaceStyle(o.second, key, value);
      if (replaced) break;
    }
    return replaced;
  }

  if (style.IsArray()) {
    auto& array = style.ToArrayChecked();
    bool replaced = false;
    for (auto& a: array) {
      replaced = ReplaceStyle(a, key, value);
      if (replaced) break;
    }
    return replaced;
  }

  return false;
}
```

## UpdateStyle

这个函数作用就是进行 style 的更新，UpdateObjectStyle 类似于上面的 ReplaceStyle，递归进行 style 的修改。

```cpp
void DomNode::UpdateStyle(const std::unordered_map<std::string,
                                                   std::shared_ptr<HippyValue>>& update_style) {
  if (update_style.empty()) return;

  for (const auto& v: update_style) {
    if (this->style_map_ == nullptr) {
      this->style_map_ =
          std::make_shared<std::unordered_map<std::string, std::shared_ptr<HippyValue>>>();
    }

    auto iter = this->style_map_->find(v.first);
    if (iter == this->style_map_->end()) {
      std::pair<std::string, std::shared_ptr<HippyValue>>
          pair = {v.first, std::make_shared<HippyValue>(*v.second)};
      this->style_map_->insert(pair);
      continue;
    }

    if (v.second->IsObject() && iter->second->IsObject()) {
      this->UpdateObjectStyle(*iter->second, *v.second);
    } else {
      iter->second = std::make_shared<HippyValue>(*v.second);
    }
  }
}
```

## Serialize & Deserialize

这两个函数做的就是树形结构的序列化和反序列化操作，但其实主要处理的是 style 和 extStyle。style 指的是原样式，extStyle 指的是预处理之后的样式内容。Serialize 做的就是一些纯粹的赋值操作，目的是将对象标准化；Deserialize 就是将 Serialize 后的对象还原回来。

```cpp
HippyValue DomNode::Serialize() const {
  HippyValueObjectType result;

  auto id = HippyValue(id_);
  result[kNodePropertyId] = id;

  auto pid = HippyValue(pid_);
  result[kNodePropertyPid] = pid;

  auto index = HippyValue(index_);
  result[kNodePropertyIndex] = index;

  auto tag_name = HippyValue(tag_name_);
  result[kNodePropertyTagName] = tag_name;

  auto view_name = HippyValue(view_name_);
  result[kNodePropertyViewName] = view_name;

  HippyValueObjectType style_map_value;
  if (style_map_) {
    for (const auto& value: *style_map_) {
      style_map_value[value.first] = *value.second;
    }
    auto style_map = HippyValue(std::move(style_map_value));
    result[kNodePropertyStyle] = style_map;
  }

  if (dom_ext_map_) {
    HippyValueObjectType dom_ext_map_value;
    for (const auto& value: *dom_ext_map_) {
      dom_ext_map_value[value.first] = *value.second;
    }
    auto dom_ext_map = HippyValue(std::move(dom_ext_map_value));
    result[kNodePropertyExt] = dom_ext_map;
  }

  return HippyValue(std::move(result));
}
```

```cpp
bool DomNode::Deserialize(HippyValue value) {
  HippyValueObjectType dom_node_obj = value.ToObjectChecked();

  // id
  uint32_t id;
  auto flag = dom_node_obj[kNodePropertyId].ToUint32(id);
  if (flag) {
    SetId(static_cast<uint32_t>(id));
  } else {
    return false;
  }

  // parent id
  uint32_t pid;
  flag = dom_node_obj[kNodePropertyPid].ToUint32(pid);
  if (flag) {
    SetPid(static_cast<uint32_t>(pid));
  } else {
    return false;
  }

  // 当前节点在父节点 children 数组中的索引位置
  int32_t index;
  flag = dom_node_obj[kNodePropertyIndex].ToInt32(index);
  if (flag) {
    SetIndex(index);
  } else {
    return false;
  }

  // 组件名称
  std::string tag_name;
  flag = dom_node_obj[kNodePropertyTagName].ToString(tag_name);
  if (flag) {
    SetTagName(tag_name);
  }

  // 映射的组件
  std::string view_name;
  flag = dom_node_obj[kNodePropertyViewName].ToString(view_name);
  if (flag) {
    SetViewName(view_name);
  } else {
    return false;
  }

  auto style_obj = dom_node_obj[kNodePropertyStyle];
  if (style_obj.IsObject()) {
    auto style = style_obj.ToObjectChecked();
    std::shared_ptr<std::unordered_map<std::string, std::shared_ptr<HippyValue>>>
        style_map = std::make_shared<std::unordered_map<std::string, std::shared_ptr<HippyValue>>>();
    for (const auto& p: style) {
      (*style_map)[p.first] = std::make_shared<HippyValue>(p.second);
    }
    SetStyleMap(std::move(style_map));
  }

  auto ext_obj = dom_node_obj[kNodePropertyExt];
  if (ext_obj.IsObject()) {
    auto ext = ext_obj.ToObjectChecked();
    std::shared_ptr<std::unordered_map<std::string, std::shared_ptr<HippyValue>>>
        ext_map = std::make_shared<std::unordered_map<std::string, std::shared_ptr<HippyValue>>>();
    for (const auto& p: ext) {
      (*ext_map)[p.first] = std::make_shared<HippyValue>(p.second);
    }
    SetExtStyleMap(std::move(ext_map));
  }

  return true;
}
```
