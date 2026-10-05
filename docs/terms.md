# Terms

One word per thing, in German and English alike. These are the words of the app, the guide and the
README; code names (Pattern, SewObject, Region, Block) stay as they are, users never see them.

| Thing | German | English | In the code |
|---|---|---|---|
| Everything that is saved together | Projekt | project | Workspace |
| What the machine sews, as a whole | Stickmuster | design | Pattern |
| The PES, DST, … file on disk | Stickdatei | embroidery file | File |
| One thread color with everything sewn in it | Farbe | color | Block |
| Something sewn as one unit (fill with underlay, satin, running stitch) | Objekt | object | SewObject |
| Pieces of an object between two trims | Teil | piece | section |
| The area or line an object is sewn from | Form | shape | Form (curves), Region (pixels) |
| The curves of a shape with nodes and handles | Umriss | outline | Path, Node |
| How an object is sewn | Stichart, Einstellungen | stitch type, settings | Settings, kind |
| A stitch from one needle point to the next | Stich | stitch | STITCH record |
| Where the needle goes through the fabric | Einstich | needle point | record (x, y) |
| A move without sewing | Sprung | jump | JUMP |
| Cutting the thread | Fadenschnitt | trim | TRIM |
| Object kind sewn as a line | Steppstich | running stitch | object.hint 'run' |
| Fill pattern along the outline | Konturfüllung | contour fill | pattern.contour |
| Satin underlay just inside both rails | Randlauf | edge run | under.contour |
| Line around a fill, sewn after it | Umrandung | border | border |
| Lines across a satin column that set the direction | Querlinie | rung | Rung |
| Line across a satin column where it starts afresh | Trennlinie | section line | section |
| Drawn line that fill rows follow | Leitlinie | guide line | guide |
| Lower fill left out under a later shape | Aussparen | knock out | knockout |
| Shape kept only for aligning, never sewn | Hilfslinie | guide | aside 'guide' |
| Frame around the selection (move, rotate, scale) | Rahmen | frame | frame |
| The sewing field of the machine | Stickrahmen | hoop | hoop |
| Thread as material and color | Garn | thread | ThreadColor |
| Smooth or sharp node | Rund / Ecke | smooth / corner | smooth |

Rules that follow from the table:

- *Stickmuster* for the thing, *Stickdatei* only for the file. No Motiv, Stickbild or Design in
  German texts; *Muster* alone means a fill pattern.
- *Kontur* is not used on its own: the object kind is *Steppstich*, the fill pattern
  *Konturfüllung*, the satin underlay *Randlauf*.
- *Form* is the thing, *Umriss* its visible edge; *Fläche* only as the kind of a shape (area or
  line) and in measurements.
- *Garn* for the material and the thread color, *Faden* only in Fadenschnitt and lose Sprungfäden.
- *Teil*, never *Stück*.
- English says *needle point*, not penetration, in user-facing text.
- No long dashes in any text.
