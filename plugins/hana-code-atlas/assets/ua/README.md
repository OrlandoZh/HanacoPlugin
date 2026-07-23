# assets/ua/

此目录用于存放 patched UA Viewer 2.9.0 的静态 dist 产物。

构建流程参见 `third_party/understand-anything/BUILD.md`。

最终产物应包含：
- `dist/index.html` — Viewer SPA 入口
- `dist/assets/` — JS/CSS chunks
- `viewer.css` — 插件控制台样式
- `viewer.js` — 插件控制台逻辑

**此目录不提交到 git**（通过 .gitignore 排除），构建产物通过 `npm run pack:assets` 打包或在插件安装时从 release 下载。
