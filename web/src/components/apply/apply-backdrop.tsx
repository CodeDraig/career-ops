// Static wallpaper shared by the search and apply screens. Soft color comes
// from gradients, without animated layers or blend effects.
const CSS = `
.co-bd{position:fixed;top:0;right:0;bottom:0;left:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--bg)}
@media(min-width:768px){.co-bd{left:15rem}}
.co-bd__img{position:absolute;inset:-15%;width:130%;height:130%;object-fit:cover;object-position:center top;filter:blur(48px) saturate(1.25)}
.co-bd__tint{position:absolute;inset:0;background:
  radial-gradient(120% 90% at 50% -10%, transparent, color-mix(in srgb, var(--bg) 82%, transparent) 80%),
  linear-gradient(180deg, color-mix(in srgb, var(--bg) 28%, transparent), color-mix(in srgb, var(--bg) 68%, transparent))}
.co-bd__dots{position:absolute;inset:0;
  background-image:radial-gradient(circle, color-mix(in srgb, var(--fg) 36%, transparent) 1px, transparent 1.7px);
  background-size:24px 24px;
  -webkit-mask-image:radial-gradient(140% 110% at 50% 38%, #000 50%, transparent 100%);
  mask-image:radial-gradient(140% 110% at 50% 38%, #000 50%, transparent 100%)}
.co-bd__glow{position:absolute;inset:0;background:
  radial-gradient(ellipse at 15% 20%, hsl(26 82% 55% / .28), transparent 60%),
  radial-gradient(ellipse at 85% 80%, hsl(220 90% 72% / .22), transparent 60%)}
.co-bd__vignette{position:absolute;inset:0;box-shadow:inset 0 0 150px 44px color-mix(in srgb, var(--bg) 74%, transparent)}
.co-bd.is-intense .co-bd__img{opacity:.34}
.co-bd.is-intense .co-bd__dots{opacity:.75}
.co-bd.is-soft .co-bd__img{opacity:.16}
.co-bd.is-soft .co-bd__dots{opacity:.42}
.co-bd.is-soft .co-bd__glow{opacity:.6}
html:not(.dark) .co-bd__glow{background:
  radial-gradient(ellipse at 15% 20%, hsl(26 88% 62% / .22), transparent 60%),
  radial-gradient(ellipse at 85% 80%, hsl(222 84% 70% / .18), transparent 60%)}
html:not(.dark) .co-bd__dots{background-image:radial-gradient(circle, color-mix(in srgb, var(--fg) 22%, transparent) 1px, transparent 1.7px)}
html:not(.dark) .co-bd.is-intense .co-bd__img{opacity:.20}
html:not(.dark) .co-bd.is-soft .co-bd__img{opacity:.10}
@keyframes co-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.co-rise{animation:co-rise .5s ease both}
@media (prefers-reduced-motion: reduce){.co-rise{animation:none}}
`;

export function ApplyBackdrop({ image, intense }: { image?: string; intense: boolean }) {
  return (
    <div aria-hidden className={`co-bd ${intense ? "is-intense" : "is-soft"}`}>
      <style>{CSS}</style>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="co-bd__img" />
      )}
      <div className="co-bd__tint" />
      <div className="co-bd__dots" />
      <div className="co-bd__glow" />
      <div className="co-bd__vignette" />
    </div>
  );
}
