import { ModuleCrudPage } from "@/components/module-crud-page";

export default function LeadsPage() {
  return (
    <ModuleCrudPage
      moduleKey="leads"
      title="Лиды"
      description="Лиды вашего аккаунта, без доступа к чужим данным."
    />
  );
}
