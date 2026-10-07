# zhanshi

DeepSeek Harness 桌面插件。把本轮成功保存、读取或明确交付的图片和视频显示在回合末尾，不写进模型上下文，不负责生成媒体。

预览以 `id: zhanshi` 注册到 `conversation.chat.turnTail` 列表，与官方交付卡同层，不会折进工具调用列表。图片可点击打开，视频使用原生播放控件；没有媒体时不渲染。

## 安装与生效

包位于 `$DSH_HOME/plugins/zhanshi`。在 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 的 `insert` 中加入：

```yaml
- id: zhanshi
  name: ../../plugins/zhanshi/lib/index.js
```

修改后必须完全退出 DeepSeek Harness（macOS：⌘Q）再打开；仅刷新页面不会重新加载 Host。重启后的历史回合可从事件重新构建预览。卸载时去掉该 insert，再完全退出并重开。

Host 依赖 `connection`、`fs`；Client 依赖 `slots`、`uiConversation`。不修改官方 DSH 源码，不替换官方对话渲染器。

## 收集和展示规则

- 只收集本轮明确成功且无结构化错误的 `present`、`write`、`edit`、`read_image`、支持的媒体生成/截图工具结果。`read_image` 是已读取文件，不保证本轮新生成。
- `shengcheng_result` 的结构化路径优先，完整保留空格、引号及 Unicode；结构化记录损坏时不以模糊文本兜底伪装成功。兼容旧的独立 `saved …` 行。
- bash 非零退出、超时、终止、取消或仍在后台运行时不当作完成。只识别明确保存行和可可靠识别的写入目标；不把复合命令最后出现的旧文件当作目标，不解析会话日志里的示例。
- 相对路径按会话 cwd 解析后规范化、去重；不同目录同名文件仍分别展示。同路径保留最新序号，刷新对应预览地址。
- 每回合显示最多 16 项，优先明确交付的成品，再显示较新的其他媒体；超过上限时显示剩余数量，不把中间图无提示地排在最终成品之前。此限制只影响本插件预览，不删除官方交付记录。
- 媒体调用只保留解析所需字段，处理结果后释放调用状态；无关工具不进入该状态。媒体记录保留轻量路径信息用于去重及溢出统计。
- 图片、视频加载失败时保留可见文件卡，提供重试和打开操作；视频使用 `preload="metadata"`，不主动预加载全部内容。
- 忽略 `node_modules`、`.git`、父目录跳转、glob 和不支持的扩展名；这些是产品过滤规则，不替代官方文件权限控制。

## 文件读取和边界

图片使用官方 `/api/file`，视频使用 `/api/zhanshi/file`。两者都是相对 URL，以兼容桌面 `dsh-app://`。认证由 DSH connection 处理；本插件不绕开认证。

视频路由通过 composed `ctx.fs` 的 `resolve`、`processPath`、`readBytes`/`stat` 执行路径解析与读取，禁止直接用本机 Node fs 兜底绕过 provider。规范目标路径也必须满足媒体和目录过滤规则；不解析不透明 target key。

- 视频 GET 使用官方有界 `readBytes` 读取完整快照，成功后才生成响应长度和内容 SHA-256 强 ETag。单文件限制为 **64 MiB**，超限返回 413。
- Range 基于同一快照返回 206；不可满足的单区间返回 416；格式错误或不支持的多区间忽略并返回整文件。
- `If-Range` 仅在强 ETag 匹配时返回区间；旧/弱 ETag 或日期退回当前整文件。不发布 `Last-Modified`。
- HEAD 只读取元数据，忽略 Range，不计算或返回内容 ETag。
- 请求取消传入 provider；快照响应按需分块且响应取消。文件不存在、权限拒绝、超限、取消和 I/O 错误不会伪装成成功响应。

**开销与保证范围：** 每个视频 Range 请求也需要读取并计算整个文件的哈希，不是零拷贝视频流。每请求快照最多 64 MiB，provider 内部临时缓冲及并发请求会额外占用内存。完整快照避免本插件先发错误长度、再遇到文件增长/删除才报错；不宣称修复官方 provider 内部所有并发文件变化问题。大视频可通过文件卡打开，不会自动突破限制。

## 开发与验证

```bash
node --check lib/index.js
node --check lib/client.js
node --check lib/parse.js
node --test
```

回归测试覆盖真实 Client reducer/Gallery 与纯解析模块、结构化路径、复合命令、展示优先级、调用清理、失败卡、FS provider 拒绝、取消和 Range/If-Range。

0.1.3 修复验证（2026-10-07）：136/136 回归通过；安装包官方 reader 函数配合真实临时文件的 5 项增长、缩小、删除、符号链接和取消检查通过；独立 Chrome + React 18 夹具加载实际 Client/Host，验证去重、交付优先、溢出、失败/重试/打开、视频播放和拖动、桌面/手机宽度及空状态。夹具文件服务采用受控 provider，图片接口模拟官方接口，不代表连接了已重启的桌面运行实例。

**待运行态验收：** 本轮没有关闭正在使用的 DSH。单元测试或独立浏览器夹具不是桌面重启后的真实验收；完全退出并重开后，仍需在实际会话确认新插件加载及图片、视频展示。
