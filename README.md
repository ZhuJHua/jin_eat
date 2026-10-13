# 锦少今天带我们吃什么

> 摇一摇签筒，让锦少大师替全组决定今天的午饭。

**在线体验：<https://jin-eat.vercel.app/>**（手机打开体验更佳）

一个纯前端的 3D 求签小站：摇签筒、出签、展开签文，告诉你今天吃什么。没有后端，数据只存在本机浏览器。

| 静候求签                              | 出签解曰                                |
| ------------------------------------- | --------------------------------------- |
| ![静候求签](docs/screenshot-idle.jpg) | ![出签解曰](docs/screenshot-reveal.jpg) |

## 玩法

- **手机**：捧着手机摇，香烧完后停手片刻出签（体感需要 HTTPS，iOS 首次进入需点按授权）。
- **电脑**：按住空格摇签，或用鼠标抓住签筒晃动。
- **按钮**：点「摇签 · 立即开炫」直接出签。

出签后可以「就它了」锁定、「再求一签」、掷筊问锦少、一票否决，或生成签文图分享。名单和权重可以自己编辑，画质和体感灵敏度在设置里调整；名单一致时填同一个口令即可全组共签。

## 本地开发

```bash
npm ci
npm run dev         # 本地开发
npm run dev:https   # 局域网 HTTPS，用手机调试体感
npm test            # 单元测试
npm run build       # 生产构建
```

更多见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 技术栈

React 19 · TypeScript · Vite · three.js / React Three Fiber · Rapier · zustand · Tailwind CSS

## 许可证

[MIT](LICENSE) © ZhuJHua
