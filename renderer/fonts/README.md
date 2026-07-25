# 内置字体

## 中文：思源黑体 Source Han Sans SC

- 目录：`source-han-sans-sc/`
- 上游：Google Fonts 发行的 **Noto Sans SC**（v40，可变字重 100–900）。
  Noto Sans CJK 与 Adobe 的 Source Han Sans（思源黑体）是同一套字形，
  仅发行名不同，因此这就是思源黑体本体。
- 取得方式：`@fontsource-variable/noto-sans-sc@5.3.0` 的 `wght.css` 与 `files/`，
  改写内容仅两处 —— `font-family` 由 `Noto Sans SC Variable` 改为 `Source Han Sans SC`、
  `url()` 由 `./files/x` 改为 `./x`，另把 `font-display` 由 `swap` 改为 `block`
  （字体在本机磁盘上，几毫秒即可就位，`block` 可以免掉一次回退字体的闪烁重排）。
- 许可：SIL Open Font License 1.1，全文见 `source-han-sans-sc/LICENSE`。
- 为什么随包内置：思源黑体不是 Windows 预装字体。若只在 CSS 里写字体名，
  没装过的同事会静默回退到微软雅黑，「全中文思源黑体」这条就名存实亡。
  内置之后渲染结果在所有机器上一致。
- 为什么切成 101 个分片：`unicode-range` 让浏览器只载入页面真正用到的那几片，
  一屏中文通常只触发 3–8 个分片（几百 KB），而不是一次性读 4.5 MB。

## 英文与数字：Times New Roman

Windows 预装字体，不需要内置。字体栈里把它放在**第一位**，
中文字符在 Times New Roman 里查不到字形，会自动落到后面的思源黑体上——
一条字体栈同时满足「英文 Times New Roman、中文思源黑体」。
