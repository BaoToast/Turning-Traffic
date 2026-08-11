import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Turning Traffic｜路口尖峰轉向交通量分析系統",
  description: "季度批次匯入、尖峰小時轉向分析、SVG 路口圖、多路口與歷季比較、資料品質檢查及報表輸出。",
  icons: { icon: "/favicon.svg" },
  metadataBase: new URL("https://baotoast.github.io/Turning-Traffic/"),
  openGraph: {
    title: "Turning Traffic｜路口尖峰轉向交通量分析系統",
    description: "季度批次匯入、尖峰分析、SVG 轉向圖、歷季比較與報表輸出。",
    images: [{ url: "og.png", width: 1200, height: 630, alt: "Turning Traffic 路口尖峰轉向交通量分析系統" }],
  },
  twitter: { card: "summary_large_image", images: ["og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
