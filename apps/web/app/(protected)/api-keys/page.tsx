import { ModuleCrudPage } from "@/components/module-crud-page";

export default function ApiKeysPage() {
  return (
    <ModuleCrudPage
      moduleKey="api_keys"
      title="API ключи"
      description="Ключи изолированы по tenant и не видны другим аккаунтам."
    />
  );
}
