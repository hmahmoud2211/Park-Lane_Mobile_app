import { create } from 'qrcode';

/**
 * A QR code as an inline SVG string, for documents rendered outside the app
 * (the on-screen code is react-native-qrcode-svg, built on the same encoder,
 * so both scan to the same payload). Dark modules take `color`; the quiet
 * zone is left to the page.
 */
export function qrSvg(text: string, size: number, color: string): string {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  const cells: string[] = [];
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (modules.data[row * modules.size + column]) {
        cells.push(`M${column} ${row}h1v1h-1z`);
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${modules.size} ${modules.size}" shape-rendering="crispEdges">` +
    `<path fill="${color}" d="${cells.join('')}"/></svg>`
  );
}
