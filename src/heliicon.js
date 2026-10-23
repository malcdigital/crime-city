// The police helicopter on the radar and the full map: a little top-down helicopter (nose
// pointing where it's flying, rotor spinning, red/blue lights flashing) and its searchlight
// on the ground.
export function drawHeli(ctx, x, y, ang, size = 1) {
  const t = performance.now() / 1000;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang); // ang: screen angle of the nose, 0 = up
  ctx.scale(size, size);
  ctx.lineJoin = 'round';
  // A dark disc behind it so it stands out from the map.
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath();
  ctx.arc(0, 1, 9.5, 0, Math.PI * 2);
  ctx.fill();
  // Tail boom and tail rotor.
  ctx.fillStyle = '#1c2a44';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.rect(-0.9, 2, 1.8, 7);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(-2.6, 8.3, 5.2, 1.4);
  ctx.fill();
  ctx.stroke();
  // Cabin.
  ctx.beginPath();
  ctx.ellipse(0, -0.5, 3.6, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Windshield.
  ctx.fillStyle = '#9fd3ff';
  ctx.beginPath();
  ctx.ellipse(0, -3.2, 2.2, 1.6, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // Flashing lights.
  const on = Math.floor(t * 4) % 2 === 0;
  ctx.fillStyle = on ? '#ff3b3b' : '#3b7bff';
  ctx.beginPath();
  ctx.arc(-2.2, 1.5, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = on ? '#3b7bff' : '#ff3b3b';
  ctx.beginPath();
  ctx.arc(2.2, 1.5, 1.1, 0, Math.PI * 2);
  ctx.fill();
  // Main rotor, spinning.
  ctx.rotate(t * 14);
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(8, 0);
  ctx.moveTo(0, -8);
  ctx.lineTo(0, 8);
  ctx.stroke();
  ctx.restore();
}

// The searchlight's spot on the ground (r in pixels); brighter when it has you.
export function drawSearchlight(ctx, hx, hy, sx, sy, r, onYou) {
  ctx.save();
  ctx.fillStyle = onYou ? 'rgba(255,240,150,.55)' : 'rgba(255,240,150,.28)';
  ctx.strokeStyle = onYou ? 'rgba(255,240,150,.95)' : 'rgba(255,240,150,.5)';
  ctx.lineWidth = 1.2;
  // A faint beam from the helicopter to the spot.
  const a = Math.atan2(sy - hy, sx - hx);
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(sx + Math.cos(a + Math.PI / 2) * r, sy + Math.sin(a + Math.PI / 2) * r);
  ctx.lineTo(sx + Math.cos(a - Math.PI / 2) * r, sy + Math.sin(a - Math.PI / 2) * r);
  ctx.closePath();
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
