import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Schedula — Doctor–Patient Scheduling',
  description:
    'Schedula is a doctor–patient appointment and scheduling management system. Stage 2 Foundation.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
