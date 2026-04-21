import { ModuleCrudPage } from "@/components/module-crud-page";

export default function KnowledgePage() {
  return (
    <ModuleCrudPage
      moduleKey="knowledge"
      title="База знаний"
      description="Базы знаний изолированы по аккаунтам и не пересекаются."
    />
  );
}
