# Typeless Lite

一个极简本地桌面工具：自动读取 Typeless 转录记录，按日期查看、复制、导出。

## 痛点

很多人用 Typeless 做语音输入来管理工作，但在“整理每天内容”这一步会卡住：

- 官方暂时没有便捷的按日复制/导出流程。
- 转录内容虽然在本地，但路径和格式不直观，不方便直接拿来做日报/复盘。
- 手动逐条复制成本高，容易漏内容。

## 解决方法

Typeless Lite 把这件事简化为三步：

1. 自动识别本机 Typeless 数据库（失败时支持手动选择）。
2. 自动按日期和时间点整理全部转录内容。
3. 一键复制当天对话，或导出为 Markdown / PDF / Raw。

## 核心功能

- 自动识别 `typeless.db` 路径
- 日期 + 时间线浏览转录内容
- 一键复制“选定日期全部对话”
- 导出 Markdown（适合继续编辑）
- 导出 PDF（适合分享/存档）
- 导出 Raw（`JSON + typeless.db.backup`）

## 隐私与数据

- 全程本地处理，不上传云端。
- 默认只读取本机 Typeless 数据。
- 导出文件保存到你指定的位置。

## 快速开始

```bash
npm install
npm run dev
```

## 打包

```bash
npm run dist:mac
```

产物输出目录：`release/`

## 使用流程

1. 启动应用后自动扫描 Typeless 数据。
2. 左侧选择日期，右侧查看该日完整时间线。
3. 点击“复制当天”或“导出”完成整理。

快捷键：

- `⌘/Ctrl + Shift + C`：复制当前日期全部对话

## 技术栈

- Electron
- React + TypeScript
- Vite
- 本机 `sqlite3` CLI
