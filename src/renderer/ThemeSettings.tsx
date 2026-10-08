import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import SelectMenu from "./SelectMenu";
import { setThemeMode, useTheme, type ThemeMode } from "./theme";

export default function ThemeSettings() {
  const theme = useTheme();
  const [error, setError] = useState("");
  return (
    <div className="theme-settings">
      <div className="cli-heading">
        <h3>外观</h3>
        <small className="muted">即时生效，自动保存</small>
      </div>
      <div className="select-field">
        <span>主题</span>
        <SelectMenu
          label="主题"
          value={theme.mode}
          onChange={(mode) => {
            try {
              setThemeMode(mode as ThemeMode);
              setError("");
            } catch {
              setError("无法保存主题，请检查本机存储空间。");
            }
          }}
          options={[
            {
              value: "system",
              label: "随系统",
              description: "跟随系统的亮、暗模式",
              icon: <Monitor size={16} />,
            },
            {
              value: "light",
              label: "亮",
              description: "浅色背景与深色文字",
              icon: <Sun size={16} />,
            },
            {
              value: "dark",
              label: "暗",
              description: "深色背景与浅色文字",
              icon: <Moon size={16} />,
            },
          ]}
        />
      </div>
      <p className="theme-note muted">
        当前为{theme.resolved === "light" ? "亮" : "暗"}
        色主题，包含终端与所有菜单。
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="settings-divider" />
    </div>
  );
}
