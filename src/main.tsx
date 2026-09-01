import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles/global.css';

// Booth 供给系统视觉 Token
// 定位：稳重/精确/可靠，与 Shop「卖」暖色轻快风彻底区隔
const boothTheme = {
  token: {
    // 主色 - 深藏青
    colorPrimary: '#1F3A5F',
    // 行动色 - 主按钮
    colorLink: '#2F6BFF',
    // 全局背景
    colorBgContainer: '#F5F7FA',
    colorBgLayout: '#F5F7FA',
    // 成功色
    colorSuccess: '#16A37B',
    // 预警色
    colorWarning: '#D97B1F',
    // 异常色
    colorError: '#C63A3A',
    // 强调琥珀
    colorInfo: '#C9A227',
    // 字体
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    // 圆角
    borderRadius: 6,
    // 表格
    colorBgBase: '#FFFFFF',
  },
  components: {
    Button: {
      primaryShadow: '0 2px 4px rgba(47, 107, 255, 0.2)',
    },
    Table: {
      headerBg: '#F0F3F7',
      headerColor: '#1F3A5F',
      rowHoverBg: '#EDF1F7',
    },
    Menu: {
      itemColor: '#C9D4E3',
      itemHoverColor: '#FFFFFF',
      itemSelectedColor: '#FFFFFF',
      itemSelectedBg: '#2F6BFF',
      itemHoverBg: 'rgba(47, 107, 255, 0.15)',
      subMenuItemColor: '#A0B0C5',
    },
    Layout: {
      siderBg: '#1F3A5F',
      headerBg: '#FFFFFF',
      bodyBg: '#F5F7FA',
    },
    Card: {
      headerBg: '#F8FAFC',
      headerBorderColor: '#E5E9F0',
    },
    Input: {
      activeBorderColor: '#2F6BFF',
      hoverBorderColor: '#1F3A5F',
    },
    Select: {
      optionSelectedBg: '#EDF1F7',
    },
    Tabs: {
      inkBarColor: '#2F6BFF',
      itemSelectedColor: '#1F3A5F',
      itemHoverColor: '#2F6BFF',
    },
    Tag: {
      defaultBg: '#F0F3F7',
      defaultColor: '#1F3A5F',
    },
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={boothTheme}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
