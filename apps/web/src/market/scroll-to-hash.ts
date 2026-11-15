/**
 * Scrolls the element named by the address's hash into view once it exists. A tab opened by a link renders after the
 * hash is read, so this looks again on each frame for about a second. Smooth, unless the person asked for less motion.
 * Answers a function that stops looking.
 */
export function scrollToHashWhenShown(id: string, frames = 60): () => void {
  let stopped = false;
  let left = frames;
  const look = () => {
    if (stopped) return;
    const target = document.getElementById(id);
    if (target) {
      const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      target.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
      return;
    }
    if (--left > 0) requestAnimationFrame(look);
  };
  look();
  return () => { stopped = true; };
}
