import { ModuleCrudPage } from "@/components/module-crud-page";

export default function SettingsPage() {
  return (
    <ModuleCrudPage
      moduleKey="settings"
      title="Настройки"
      description="Настройки хранятся и применяются только для вашего аккаунта."
    />
  );
}
