import { ModuleCrudPage } from "@/components/module-crud-page";

export default function TelegramBotPage() {
  return (
    <ModuleCrudPage
      moduleKey="telegram"
      title="Telegram Bot"
      description="Управление Telegram-ботами в изолированном tenant."
    />
  );
}
