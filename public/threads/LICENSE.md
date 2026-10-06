# Thread catalogs

`catalogs.json` holds the thread colors of 71 thread lines (maker, line, color number, name and an
approximate RGB value). It is converted with `tools/threads/convert.mjs` from the thread palettes
of Ink/Stitch (https://github.com/inkstitch/inkstitch, folder `palettes`, commit d59c9ab).

Ink/Stitch is licensed under the GNU General Public License version 3, and so is this data file.
heatstitch reads it as data at runtime; the app code itself stays under the MIT License.
A copy of the GPL 3.0 is at https://www.gnu.org/licenses/gpl-3.0.html.

Thread names and numbers belong to their makers. The RGB values are approximations made by the
Ink/Stitch contributors, not values published by the makers.
