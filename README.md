# zhanshi

DeepSeek Harness 桌面插件。把本轮新保存的图片和视频直接显示在对话里，不写进模型上下文。

预览挂在回合末尾交付区（和原来的「打开」卡片同一层，不会折进「N 次工具调用」）。图用 `<img>`，视频用 `<video controls>`，点图打开文件。来源是本轮成功的 `present` / `write` / `edit` / `read_image`，以及 bash 里独立一行的 `saved …png` / `wrote …mp4`（或 `cp`/`ffmpeg`/`-o` 的写入目标）。翻会话日志、`ls` 旧文件不会触发预览。`present` 的相对路径（如 `street_dancing_girl.png`）也会显示，用会话 cwd 拼成绝对路径。不负责生图。有媒体时占用该回合的 `conversation.chat.turnTail`（必须 `priority: -20`，chain 不认 `order`），官方文件卡片被预览代替。

## 安装

包在 `$DSH_HOME/plugins/zhanshi`。在 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 的 `insert` 里加入：

```yaml
- id: zhanshi
  name: ../../plugins/zhanshi/lib/index.js
```

完全退出 DeepSeek Harness（macOS：⌘Q）再打开。已有会话重启后也会从事件重建预览。

## 说明

- 不把媒体 ingest 成会话 attachment，避免进入下一轮视觉请求
- 文件用相对路径 `/api/file` 读取（桌面是 `dsh-app://`，不能按 http origin 拼地址）
- 每回合最多 16 个文件；忽略 `node_modules` / `.git`
- 卸载：只从 desktop patch 去掉该 insert，然后 ⌘Q

## 开发

```bash
node --check lib/index.js lib/client.js lib/parse.js
node --test
```
