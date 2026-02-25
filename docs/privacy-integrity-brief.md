# Privacy Integrity Brief

更新日期：2026-02-26

## 1) 官方公开声明（外部来源）

- Typeless 首页强调“Private by design”。
  - https://typeless.com/
- Typeless 定价页强调“Your words never leave your machine...”。
  - https://typeless.com/pricing
- Data Controls 页面说明：转录历史默认保存在本地设备，且可手动删除。
  - https://typeless.com/data-controls
- 隐私政策写明会处理与产品使用相关的设备、日志、文本/音频等数据（按政策列举的用途与合法基础）。
  - https://typeless.com/privacy-policy

## 2) 本机取证与逆向结果（本仓库）

- 数据库路径：`~/Library/Application Support/Typeless/typeless.db`
- 关键表：`history`
- 明文字段可直接读到：
  - `focused_app_name` / `focused_app_bundle_id`
  - `focused_app_window_title`
  - `focused_app_window_web_domain` / `focused_app_window_web_url`
- 加密上下文字段：`audio_context`（本仓库已验证可解密）
  - 解密脚本：`/Users/alexmac/Documents/Mini 项目开发/Typeless 研究v2/decrypt_context.py`
  - 研究报告：`/Users/alexmac/Documents/Mini 项目开发/Typeless 研究v2/研究报告.md`

## 3) 结论（工程视角）

- 就“用户可见事实”而言：每条输入不仅有转录文本，还可关联到应用、窗口、网页与上下文字段。
- 这类数据属于高敏感上下文，应当默认透明展示给用户，并提供清晰的导出与审计能力。
- 因此本项目已在 UI 中新增“隐私上下文视图”，把关键字段与每条输入做关联展示。

## 4) 注意事项

- “是否上传服务端”属于网络侧行为，需要结合抓包与服务端声明综合判断。
- 本项目展示的是：
  - 本机数据库可观察事实
  - 已解密可观察事实
  - 以及研究文档中记录的逆向结论
