# WordLink 伴读素材来源

本目录以下素材来自 [orionsheep/wordlink](https://github.com/orionsheep/wordlink)，提交 `f218ecb89aaed60a52864480e04869b6952bb510`：

- `spring.mp4`、`summer.mp4`、`autumn.mp4`、`winter.mp4`：原路径 `public/videos/`。
- 四张同名 JPG 海报：原路径 `public/videos/posters/`。
- `scene-overlay.webp`：原路径 `public/ambient/scene-overlay.webp`。

参考仓库根目录采用 MIT License。完整版权与许可声明保留在 [WordLink-MIT-LICENSE.txt](../../docs/WordLink-MIT-LICENSE.txt)。这些素材用于本地复刻参考站的伴读界面，没有导入参考站的词典数据。

`ambient-audio.js` 的合成环境音实现参考了该仓库 `src/components/ambient/SoundScapeEngine.ts` 的设计，并为本项目重新实现为无需依赖的浏览器脚本。声音使用 Web Audio 生成，不包含录制音轨。系统英文朗读由浏览器 SpeechSynthesis 提供。
