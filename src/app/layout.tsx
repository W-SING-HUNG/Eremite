import type { Metadata } from "next";
import "pdfjs-dist/web/pdf_viewer.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "Eremite",
  description: "Your local personal digital foundation.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
