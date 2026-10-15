// Static corner glow shared by the home and running-job screens.
const CSS = `
.co-hero-glow{position:absolute;inset:0;z-index:0;pointer-events:none;background:
  radial-gradient(ellipse at top left, #f6c89a66, transparent 60%),
  radial-gradient(ellipse at bottom right, #D5742E33, transparent 60%)}
html.dark .co-hero-glow{background:
  radial-gradient(ellipse at top left, #D5742E45, transparent 60%),
  radial-gradient(ellipse at bottom right, #9c2f053d, transparent 60%)}
`;

export function HeroGlow() {
  return (
    <div aria-hidden="true" className="co-hero-glow">
      <style>{CSS}</style>
    </div>
  );
}
