export function NewAccountBlock({ title, createText, onCreate }: { title: string; createText: string; onCreate: () => void }) {
  return (
    <section className="new">
      <h2>{title}</h2>
      <div className="row">
        <button type="button" className="ghost" onClick={onCreate}>
          {createText}
        </button>
      </div>
    </section>
  );
}
