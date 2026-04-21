"use client";

import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(formData.get("email")),
      }),
    });
    setDone(true);
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={onSubmit}>
        <h1>Восстановление пароля</h1>
        <label>Email</label>
        <input type="email" name="email" required />
        <button type="submit">Отправить ссылку</button>
        {done ? <p>Если email существует, инструкция отправлена.</p> : null}
      </form>
    </div>
  );
}
