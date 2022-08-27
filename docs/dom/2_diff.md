# Diff

这是 Hippy DOM 实现原理的第二节。打开 /dom/src/dom 目录下的 diff_utils.cc 文件。

Diff 对于前端来说是一个非常重要的操作，目标是比较新旧对象，找到可复用的部分，然后比对着进行增删改操作。这里 DiffProps 比对的对象是两个哈希表。

```cpp
DiffValue DiffUtils::DiffProps(const DomValueMap& old_props_map, const DomValueMap& new_props_map) {
  std::shared_ptr<DomValueMap> update_props = std::make_shared<DomValueMap>();
  std::shared_ptr<std::vector<std::string>> delete_props = std::make_shared<std::vector<std::string>>();

  // delete props
  for (const auto& kv : old_props_map) {
    auto iter = new_props_map.find(kv.first);
    if (iter == new_props_map.end()) {
      delete_props->push_back(kv.first);
    }
  }

  // update props (update old prop)
  for (const auto& old_prop : old_props_map) {
    auto key = old_prop.first;
    auto new_prop_iter = new_props_map.find(key);

    if (new_prop_iter == new_props_map.end()) {
      continue;
    }

    if (old_prop.second == nullptr || old_prop.second.get() != new_prop_iter->second.get()) {
      (*update_props)[key] = new_prop_iter->second;
    }
  }

  // update props (insert new prop)
  for (const auto& new_prop : new_props_map) {
    auto key = new_prop.first;
    if (old_props_map.find(key) != old_props_map.end()) {
      continue;
    }
    (*update_props)[key] = new_prop.second;
  }

  if (delete_props->empty()) {
    delete_props = nullptr;
  }
  if (update_props->empty()) {
    update_props = nullptr;
  }
  DiffValue diff_props = std::make_tuple(update_props, delete_props);
  return diff_props;
}
```

分开讲解 delete props、update old props、insert new props 三种情况。

## Delete props

```cpp
for (const auto& kv : old_props_map) {
  auto iter = new_props_map.find(kv.first);
  if (iter == new_props_map.end()) {
    delete_props->push_back(kv.first);
  }
}
```

delete props 官方示例：

```
old_props_map = { 
  a: 1, 
  b: 2, 
  c: 3 
}
new_props_map = { 
  a: 1 
}
delete_props = [b, c]
```

直接遍历 old_props_map，然后在 new_props_map 里面找是否存在对应 key 的取值即可，如果不存在就是被删除了，记录进 delete_props。

## Update old props

update old props 官方示例：

```cpp
for (const auto& old_prop : old_props_map) {
  auto key = old_prop.first;
  auto new_prop_iter = new_props_map.find(key);

  if (new_prop_iter == new_props_map.end()) {
    continue;
  }

  // update props
  if (old_prop.second == nullptr || old_prop.second.get() != new_prop_iter->second.get()) {
    (*update_props)[key] = new_prop_iter->second;
  }
}
```

```
old_props_map = {
  a: 1,
  b: { b1: 21, b2: 22 },
  c: [ c1: 31, c2: 32 ],
  d: 4
}

new_props_map = {
  a: 11,
  b: { b1: 21 },
  c: [ c1: 31 ]
}

update_props = {
  a: 11,
  b: { b1: 21 },
  c: [ c1: 31 ]
}
```

遍历 old_props_map 中的每一项，比如遍历到 b，查找 new_props_map 中是否存在对应的 key 叫做 b，存在则继续进行。查看 old_props_map 中 b 对应的 value 是否等于 new_props_map 中 b 对应的 value，显然 { b1: 21, b2: 22 } 与 { b1: 21 } 不相等，那么直接给 update_props 的 b 赋值为 { b1: 21 } 即可。

## Insert new props

```cpp
for (const auto& new_prop : new_props_map) {
  auto key = new_prop.first;
  if (old_props_map.find(key) != old_props_map.end()) {
    continue;
  }
  (*update_props)[key] = new_prop.second;
}
```

update old props 官方示例：

```
old_props_map = {
  a: 1
}

new_props_map = {
  b: 2,
  c: { c1: 31 },
  d: [ d1: 41 ]
}

update_props = {
  b: 2,
  c: { c1: 31 },
  d: [ d1: 41 ]
}
```

这里逻辑很简单，就是看 old_props_map 中是否存在 new_props_map 中的 key，不存在就添加到 update_props。
