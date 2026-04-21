"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        password: String(formData.get("password")),
      }),
    });
    setMessage(response.ok ? "Пароль обновлен" : "Ошибка сброса");
  }

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <h1>Сброс пароля</h1>
      <label>Новый пароль</label>
      <input type="password" name="password" required />
      <button type="submit">Сохранить</button>
      {message ? <p>{message}</p> : null}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="auth-page">
      <Suspense fallback={<p>Загрузка...</p>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
