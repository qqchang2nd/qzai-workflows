import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '任务看板',
  description: 'Q仔任务追踪系统',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
