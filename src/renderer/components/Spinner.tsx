/** A tiny CSS-only spinner; colour comes from the surrounding `color`. */
export function Spinner({ size = 12 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}
