import { ModuleCrudPage } from "@/components/module-crud-page";

export default function AnalyticsPage() {
  return (
    <ModuleCrudPage
      moduleKey="analytics"
      title="Аналитика"
      description="Аналитика с данными только вашего аккаунта."
    />
  );
}
