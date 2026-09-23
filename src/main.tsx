// src/main.tsx —— 应用入口
//
// 整体架构位置：
//   React 挂载点。主题变量（theme.css）在这里全局引入；
//   布局与组件样式在 App.css（被 App.tsx 引入）。
//   StrictMode 在开发模式下会双挂载一次 effect，编辑器视图的
//   创建/销毁逻辑（App.tsx）已按可重复执行设计。

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
