import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "miniPTX - playground",
  description: "Explore a real C++ compiler pipeline, from a small arithmetic language to NVIDIA PTX.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
