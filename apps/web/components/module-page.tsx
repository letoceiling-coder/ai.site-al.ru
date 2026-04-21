type ModulePageProps = {
  title: string;
  description: string;
  bullets: string[];
};

export function ModulePage({ title, description, bullets }: ModulePageProps) {
  return (
    <section className="card">
      <div className="module-title-row">
        <span className="module-chip-icon" aria-hidden="true">
          ◈
        </span>
        <h1>{title}</h1>
      </div>
      <p>{description}</p>
      <ul className="module-bullets">
        {bullets.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
