import { ConfigProvider } from "antd";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./App.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#00c7b1",
          colorLink: "#00c7b1",
          colorLinkHover: "#00d5bd",
        },
      }}
    >
      <App />
    </ConfigProvider>
  </StrictMode>
);
