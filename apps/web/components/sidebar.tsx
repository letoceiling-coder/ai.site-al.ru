"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminMenu } from "@/lib/navigation";

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <h3>DEPLOY OK 777</h3>
      <p style={{ color: "#6b7280", fontSize: 12 }}>SaaS admin</p>
      <nav>
        {adminMenu.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`menu-item ${pathname === item.href ? "active" : ""}`}
          >
            {item.title}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
