/**
 * The email of the privacy page. It is not in privacy.html and not in plain text here, so crawlers and
 * address harvesters that read the page or this repository without running JavaScript don't find it;
 * src/privacyPage.ts writes it into the page. To change it:
 *
 *   node -e 'console.log(Buffer.from("name@example.org").toString("base64").split("").reverse().join(""))'
 */
const EMAIL = 'wBXYug2Y0lGdzRXYlhGQsVWauFGZ';

export function email(encoded = EMAIL): string {
  const bytes = Uint8Array.from(atob([...encoded].reverse().join('')), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
