export function FeatureChips({ c1, c2, c3 }: { c1: string; c2: string; c3: string }) {
  return (
    <>
      <div className="chip c1">
        <i></i>
        <span>{c1}</span>
      </div>
      <div className="chip c2">
        <i></i>
        <span>{c2}</span>
      </div>
      <div className="chip c3">
        <i></i>
        <span>{c3}</span>
      </div>
    </>
  );
}
