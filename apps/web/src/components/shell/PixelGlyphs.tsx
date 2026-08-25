/** Chunky pixel-art glyphs for the sidebar footer — drawn as crisp SVG blocks so
 *  they speak the same language as the Pixie head tiles beside them. */
export function PixelMagnifier({ size = 22 }: { size?: number }) {
  const P = ({ x, y }: { x: number; y: number }) => <rect x={x * 3} y={y * 3} width="3" height="3" />;
  const ring: Array<[number, number]> = [[2,0],[3,0],[4,0],[1,1],[5,1],[0,2],[6,2],[0,3],[6,3],[0,4],[6,4],[1,5],[5,5],[2,6],[3,6],[4,6]];
  const handle: Array<[number, number]> = [[6,6],[7,7],[8,8],[7,8],[8,7]];
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="currentColor" shapeRendering="crispEdges" aria-hidden>
      {ring.map(([x, y]) => <P key={`r${x}-${y}`} x={x} y={y} />)}
      {handle.map(([x, y]) => <P key={`h${x}-${y}`} x={x} y={y} />)}
    </svg>
  );
}

export function PixelChevronUp({ size = 20, className }: { size?: number; className?: string }) {
  const P = ({ x, y }: { x: number; y: number }) => <rect x={x * 3} y={y * 3} width="3" height="3" />;
  const px: Array<[number, number]> = [[3,1],[4,1],[2,2],[3,2],[4,2],[5,2],[1,3],[2,3],[5,3],[6,3],[0,4],[1,4],[6,4],[7,4]];
  return (
    <svg width={size} height={size} viewBox="0 0 24 18" fill="currentColor" shapeRendering="crispEdges" aria-hidden className={className}>
      {px.map(([x, y]) => <P key={`${x}-${y}`} x={x} y={y} />)}
    </svg>
  );
}
