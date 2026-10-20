/** The animated spinner mark. Pure CSS, sized by the `size` prop (px). */
export function Spark({ size = 18 }: { size?: number }) {
  return (
    <span className="bw-spark" style={{ width: size, height: size }} aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} style={{ ["--i" as string]: i }} />
      ))}
    </span>
  );
}

export default Spark;
