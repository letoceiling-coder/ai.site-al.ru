import { ModuleCrudPage } from "@/components/module-crud-page";

export default function DialogsPage() {
  return (
    <ModuleCrudPage
      moduleKey="dialogs"
      title="Диалоги"
      description="История диалогов отображается только по вашему аккаунту."
    />
  );
}
