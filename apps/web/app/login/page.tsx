"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next") ?? "/dashboard";
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      email: String(formData.get("email")),
      password: String(formData.get("password")),
    };

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = (await response.json()) as { error?: { message?: string } };
      setError(body.error?.message ?? "Неверные данные");
      return;
    }

    router.push(nextPath);
    router.refresh();
  }

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <h1>Вход</h1>
      <label>Email</label>
      <input type="email" name="email" required />
      <label>Password</label>
      <input type="password" name="password" required />
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
      <button type="submit">Войти</button>
      <p style={{ marginTop: 12, display: "flex", justifyContent: "space-between" }}>
        <Link href="/register">Регистрация</Link>
        <Link href="/forgot-password">Забыли пароль?</Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="auth-page">
      <Suspense fallback={<p>Загрузка...</p>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
