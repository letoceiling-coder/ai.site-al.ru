import { test, expect } from "@playwright/test";

function authCookie(baseURL: string) {
  const url = new URL(baseURL);
  return {
    name: "access_token",
    value: "eyJleHAiIjo0MTAyNDQ0ODAwfQ.sig",
    domain: url.hostname,
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax" as const,
  };
}

test.beforeEach(async ({ context, page, baseURL }) => {
  await context.addCookies([authCookie(baseURL ?? "http://127.0.0.1:3006")]);

  await page.addInitScript(() => {
    class MockSpeechRecognition {
      lang = "ru-RU";
      interimResults = false;
      continuous = false;
      onstart: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      onresult: ((event: any) => void) | null = null;

      start() {
        this.onstart?.();
        this.onresult?.({
          resultIndex: 0,
          results: [[{ transcript: "привет из теста" }]],
        });
        this.onend?.();
      }

      stop() {
        this.onend?.();
      }
    }

    (window as any).SpeechRecognition = MockSpeechRecognition;
    (window as any).webkitSpeechRecognition = MockSpeechRecognition;
  });

  await page.route("**/api/agents", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            agents: [
              {
                id: "agent-1",
                name: "Sales AI",
                description: "test",
                model: "gpt-4.1-mini",
                temperature: 0.7,
                maxTokens: null,
                status: "ACTIVE",
                providerIntegrationId: "int-1",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                providerIntegration: {
                  provider: "OPENAI",
                  displayName: "OpenAI",
                  status: "CONNECTED",
                },
              },
            ],
            integrations: [{ id: "int-1", provider: "OPENAI", displayName: "OpenAI", status: "CONNECTED" }],
            modelOptions: { OPENAI: ["gpt-4.1-mini"] },
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/agents/agent-1/chat/sessions", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            sessions: [{ id: "dlg-1", status: "OPEN", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
          },
        }),
      });
      return;
    }
    if (request.method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { dialog: { id: "dlg-1" } } }),
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/agents/agent-1/chat/messages?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { dialog: { id: "dlg-1" }, messages: [] } }),
    });
  });

  await page.route("**/api/agents/agent-1/chat/messages/stream", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        `data: ${JSON.stringify({ type: "meta", dialogId: "dlg-1" })}`,
        "",
        `data: ${JSON.stringify({ type: "token", text: "Тестовый " })}`,
        "",
        `data: ${JSON.stringify({ type: "token", text: "ответ" })}`,
        "",
        `data: ${JSON.stringify({ type: "done", text: "Тестовый ответ" })}`,
        "",
      ].join("\n"),
    });
  });

  await page.route("**/api/uploads", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          files: [
            {
              name: "brief.txt",
              url: "/uploads/t-1/brief.txt",
              mimeType: "text/plain",
              size: 12,
            },
          ],
        },
      }),
    });
  });
});

test("agent chat: sessions, upload and streaming reply", async ({ page }) => {
  await page.goto("/agents");
  await page.getByRole("button", { name: "Тестовые чаты" }).click();

  await expect(page.getByTestId("agents-page")).toBeVisible();
  await expect(page.getByText("Sales AI")).toBeVisible();

  await page.getByTestId("chat-input").fill("Привет");
  await page.getByTestId("chat-send-btn").click();
  await expect(page.getByText("Тестовый ответ")).toBeVisible();

  await page.getByTestId("chat-file-input").setInputFiles({
    name: "brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("brief"),
  });
  await expect(page.getByTestId("chat-pending-files")).toContainText("brief.txt");
});

test("agent chat: voice input toggles and fills text", async ({ page }) => {
  await page.goto("/agents");
  await page.getByRole("button", { name: "Тестовые чаты" }).click();
  await page.getByTestId("chat-voice-btn").click();
  await expect(page.getByTestId("chat-input")).toHaveValue(/привет из теста/i);
});
