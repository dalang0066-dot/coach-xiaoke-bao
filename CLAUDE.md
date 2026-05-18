# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

微信小程序"教练消课宝"——独立健身教练的极简消课与学员管理工具。微信 DevTools 打开 `miniprogram/` 目录即可预览和调试。

## 开发命令

没有构建/测试/lint 命令。开发方式是：
- **预览**：微信开发者工具打开 `miniprogram/` 目录，点"编译"
- **预览二维码**：开发者工具菜单 → 预览 → 扫码在手机上预览（手机预览比模拟器更可靠，模拟器偶尔有虚假闪烁）

## 架构

### 数据流

```
wx.StorageSync (本地持久化)
  └── App.globalData (students[], isProMember, memberExpired, bannerDismissedToday)
        └── Page.data.list[] (视图模型，由 reload() 构建)
              └── WXML 渲染
```

- **存储 Key**：`app_data_` + 本地设备ID（`_local_id`），保证同一设备多次启动数据一致
- **App.save()** 序列化 `globalData` 到 StorageSync
- **Page.reload()** 从 `globalData.students` 重建 `data.list`（过滤删除、计算过期/低课时、排序）
- `data.list` 是视图模型数组，包含 `id, name, avatarSrc, note, remainingLessons, expiryDate, lastClassDate, lastModified, exp, low, open, highlight`

### 页面结构

| 页面 | 路径 | 说明 |
|------|------|------|
| 主页 | `pages/index/index` | 唯一真实页面，包含学员列表、所有弹窗（添加/编辑/删除/消课/历史/升级）、Toast、Debug 面板 |
| 历史（废弃）| `pages/history/history` | 独立历史页面，已在 app.json 注册但代码未使用——历史功能已改为 index 页内弹窗。保留分支以备将来 |

### 核心函数（index.js）

- `reload()` — 从 globalData 重建 list 视图模型，检测横幅触发条件，调用 setData
- `doClass()` — 消课：直接操作 globalData，重建 list，调用 flashCard 高亮
- `undoClass()` — 撤销：恢复课时，重建 list，调用 flashCard
- `submitForm()` — 添加/编辑学员提交
- `flashCard(list, item)` — 卡片高亮 500ms（绿=正常，红=低课时）
- 手势处理：`ts/tm/te` — 左滑方向锁定（|dx| > 8 且 |dx| > |dy|×1.5）

### 排序规则

`reload()` 和 `doClass()` 中的排序：过期学员排最底部，其余按 `lastModified` 时间戳倒序（最近操作的在最上面）。

## 关键约束

### 微信 WXSS 不支持的特性
- CSS `var()` — 直接写值
- `inset: 0` — 写 `top:0; left:0; right:0; bottom:0`
- `backdrop-filter` — 用半透明背景替代
- `calc()` 混合 rpx 和 vh — 用固定值或纯百分比
- scoped CSS / `::slotted` / 复杂伪类选择器

### 视觉尺寸基准
- 设计稿 750rpx = 屏幕宽度
- 自定义导航栏需要手动 padding `statusBarHeight`（从 `wx.getSystemInfoSync()` 获取）
- 所有弹窗使用 `max-width: XXXrpx` + `width: 100%` 响应屏幕

### 包体积限制
微信小程序主包限制 2MB。图片资源在 `images/` 下，头像已优化至 100×100px。添加新资源时注意总大小。

### 已知坑
- `wx.login()` 每次返回不同临时 code，**绝不能**用作存储 key
- `<scroll-view>` 上的 `enhanced="true"` 在 flex 容器中会导致渲染闪烁
- `flex: 1` 的子元素需要父容器有确定高度才能正确计算；`max-height` 不提供确定高度
- `adjust-position="{{false}}"` 用于键盘不顶起页面，配合 `wx.onKeyboardHeightChange` 手动调整底部栏位置
- `wx:key` 用 `id` 或唯一索引，不能用可能为 `undefined` 的值（如未初始化的 `ts`）
- `setData` 是异步的，不要在同一函数内 `setData` 后立即读 `this.data` 期望新值
- `bindtap` 和 `catchtap` 的冒泡行为不同——弹窗背景用 `catchtap` 阻止穿透
