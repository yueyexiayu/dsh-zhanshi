# zhanshi

DeepSeek Harness 桌面插件。把本轮新保存的图片和视频直接显示在对话里，不写进模型上下文。

预览挂在回合末尾交付区（和原来的「打开」卡片同一层，不会折进「N 次工具调用」）。图用 `<img>`，视频用 `<video controls>`，点图打开文件。来源是本轮成功的 `present` / `write` / `edit` / `read_image`，bash 里独立一行的 `saved …png` / `wrote …mp4`（或 `cp`/`ffmpeg`/`-o` 的写入目标），以及 `shengcheng` 结果里的 `saved …` 行。翻会话日志、`ls` 旧文件不会触发预览。`present` 的相对路径（如 `street_dancing_girl.png`）也会显示，用会话 cwd 拼成绝对路径。不负责生图。预览以 `id: zhanshi` 注册到 `conversation.chat.turnTail` 列表；没有媒体时组件返回空内容。

## 安装

包在 `$DSH_HOME/plugins/zhanshi`。在 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 的 `insert` 里加入：

```yaml
- id: zhanshi
  name: ../../plugins/zhanshi/lib/index.js
```

完全退出 DeepSeek Harness（macOS：⌘Q）再打开。已有会话重启后也会从事件重建预览。

## 说明

- 按当前 DSH 消息格式读取 `message.isError`，只收集明确成功且无结构化错误的结果；失败重试不刷新先前成功文件的预览身份。
- bash 非零退出、超时、终止、取消或仍在后台运行时，即使输出包含 `saved …` 也不收集为已完成媒体。官方成功交付记录继续保留。
- 不把媒体 ingest 成会话 attachment，避免进入下一轮视觉请求
- 文件用相对路径 `/api/file` 读取（桌面是 `dsh-app://`，不能按 http origin 拼地址）
- 每回合最多 16 个文件；忽略 `node_modules` / `.git`
- 同一轮图片和视频并列展示，包括同 stem 的图片、视频；`present` 不会排除其他成功生成的媒体
- 按完整路径去重；不同目录中同名的文件分别展示。同一路径保留事件序号最大的记录，序号相同保留后出现记录，并用序号刷新预览地址，避免桌面端仍显示上一张
- 卸载：只从 desktop patch 去掉该 insert，然后 ⌘Q

0.1.2 验收（2026-10-06）：80 项测试通过。DSH 桌面端重新加载后，同一条真实 Grok 生成回合的图片与视频并列显示，图片可点击打开预览，视频可播放到结束；历史回合无需重新生成。

## 开发

```bash
node --check lib/index.js lib/client.js lib/parse.js
node --test
```
