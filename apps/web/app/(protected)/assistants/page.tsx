import { ModuleCrudPage } from "@/components/module-crud-page";

export default function AssistantsPage() {
  return (
    <ModuleCrudPage
      moduleKey="assistants"
      title="Ассистенты"
      description="Ассистенты и настройки доступны только владельцу tenant."
    />
  );
}
