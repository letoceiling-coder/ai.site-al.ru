import { ModuleCrudPage } from "@/components/module-crud-page";

export default function UsagePage() {
  return (
    <ModuleCrudPage
      moduleKey="usage"
      title="Usage"
      description="Usage-метрики и затраты только в рамках вашего tenant."
    />
  );
}
