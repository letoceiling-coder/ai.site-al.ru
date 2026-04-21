"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      displayName: String(formData.get("displayName")),
      email: String(formData.get("email")),
      password: String(formData.get("password")),
    };

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = (await response.json()) as { error?: { message?: string } };
      setError(body.error?.message ?? "Ошибка регистрации");
      return;
    }

    router.push("/login");
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={onSubmit}>
        <h1>Регистрация</h1>
        <label>Ваше имя</label>
        <input name="displayName" required />
        <label>Email</label>
        <input type="email" name="email" required />
        <label>Password</label>
        <input type="password" name="password" required />
        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
        <button type="submit">Создать аккаунт</button>
      </form>
    </div>
  );
}
