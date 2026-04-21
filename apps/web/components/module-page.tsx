type ModulePageProps = {
  title: string;
  description: string;
  bullets: string[];
};

export function ModulePage({ title, description, bullets }: ModulePageProps) {
  return (
    <section className="card">
      <h1>{title}</h1>
      <p>{description}</p>
      <ul>
        {bullets.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
