/**
 * PLAIN-13.5: the part of a screen a panel shows: its box with room for the view around it, at least
 * 360 × 225 px of the screen, 16:10, the box centred where the screen allows, and all of the box where 16:10
 * can't hold it. Fractions of the screen.
 */
export function cropRegion(box: { x: number; y: number; w: number; h: number }, screen: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const [W, H] = [screen.w, screen.h];
  const [bx, by, bw, bh] = [box.x * W, box.y * H, box.w * W, box.h * H];
  let cw = Math.max(bw + 160, 360);
  let ch = Math.max(bh + 100, 225);
  if (cw / ch > 1.6) ch = cw / 1.6;
  else cw = ch * 1.6;
  if (cw > W) [cw, ch] = [W, Math.min(H, W / 1.6)];
  if (ch > H) [cw, ch] = [Math.min(W, H * 1.6), H];
  const x = Math.min(Math.max(bx + bw / 2 - cw / 2, 0), W - cw);
  const y = Math.min(Math.max(by + bh / 2 - ch / 2, 0), H - ch);
  // A box the 16:10 crop can't hold (a whole 4:3 or portrait screen) is kept whole: the crop grows to it.
  const [x0, y0] = [Math.max(0, Math.min(x, bx)), Math.max(0, Math.min(y, by))];
  const [x1, y1] = [Math.min(W, Math.max(x + cw, bx + bw)), Math.min(H, Math.max(y + ch, by + bh))];
  return { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H };
}
