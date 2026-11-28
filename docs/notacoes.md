# Notations

Measured values and drawing rules for each notation the renderer supports. They were taken from hand-made reference diagrams (Visual Paradigm style UML, SQL Server Management Studio database diagrams, draw.io relational schemas and Chen diagrams, and an ISO 5807 flowchart). Only numbers and rules are recorded here, never the diagrams themselves.

Pixel values are as measured in the reference image. Where the source was exported at a scale other than 1x, the scale is given, so the renderer works with the ratios rather than the raw numbers.

## UML class diagram (theme "Visual Paradigm")

Reference: a 2080 × 1130 px export (about 2x a normal screen diagram).

| Token                  | Measured                    | Rule                                                     |
| ---------------------- | --------------------------- | -------------------------------------------------------- |
| Class fill             | `#87ceeb`                   | every classifier, including interfaces and abstracts     |
| Border and edges       | `#1f3864`, 3 px             | same colour and width for boxes, separators and all edges |
| Text                   | `#000000`                   | sans-serif (DejaVu Sans / Verdana family)                |
| Background             | `#ffffff`                   |                                                          |
| Class name             | bold, glyph height 18 px    | centred; italic when abstract                            |
| Stereotype             | regular, glyph height 11 px | `«interface»`, `«abstract»` above the name, centred      |
| Members                | regular, glyph height 14 px | left-aligned, 16 px inner padding                        |
| Member row pitch       | 36 px                       | about 2.5× the glyph height                              |
| Header height          | 52 px name only, 78 px with stereotype |                                               |
| Empty compartment      | 20 px                       | drawn even when empty (both separators visible)          |
| Generalization head    | hollow triangle, ~24 px base, ~24 px tall | one head per parent; children join a shared trunk |
| Realization            | dashed, dash 16 px / gap 12 px, hollow triangle | same trunk rule as generalization  |
| Aggregation            | hollow diamond ~32 × 20 px at the whole                 |                              |
| Navigable end          | open arrow, ~18 px long, ~20 px wide                     |                              |
| Role and multiplicity  | regular, glyph height 14 px, written together (`role 1`) next to the arrow end, above the line |

Ratios to keep at any scale: stroke ≈ 0.2 × member font size; row pitch ≈ 2.5 × member glyph height; arrowheads ≈ 8 × stroke.

Layout rules seen in the reference:

- Interfaces at the top, abstract classes in the middle, concrete classes at the bottom; siblings on one row with the same width.
- Several children of one parent share a single horizontal trunk, about halfway between the rows, and one arrowhead at the parent.
- The parent is centred over its children.
- Associations leave through the side of a box and run orthogonally around the hierarchy, with 2 bends at most.
- Constructors are listed (`+ Name(p: Type)`); getters may appear; `main` does not.

## SQL Server database diagram (theme "SQL Server")

Reference: SSMS export at about 125% scale (1152 × 764 px).

| Token              | Measured                                          |
| ------------------ | ------------------------------------------------- |
| Outer border       | `#646464`, 1 px                                   |
| Header fill        | `#f0f0f0`, 27 px tall                             |
| Inner grid border  | `#a0a0a0`, 1 px, inset by 2 px of `#f0f0f0`       |
| Row                | 26 px white + 1 px `#f0f0f0` separator (27 px pitch) |
| Trailing empty row | 22 px                                             |
| Table name         | Segoe UI bold, cap height 14 px (≈ 20 px font), left-aligned, uppercase as written |
| Column name        | Segoe UI regular, cap height 11 px (≈ 15 px font), indented 37 px from the box edge |
| Key icon           | yellow `#ffff00` with black outline, about 5 × 9 px, in the 16 px gutter left of the column |
| Connector          | two parallel lines, `#a0a0a0` and `#646464`, 1 px each, 3 px apart |
| PK end             | yellow key, 9 × 18 px, drawn along the line at the referenced table |
| FK end ("many")    | two small hollow circles (∞ seen side-on), 9 × 19 px, at the referencing table |

Rules: connectors are straight or have one elbow; they attach to the box side nearest the other table, not to a specific column. A 1:1 link has a key at both ends.

## Relational schema (theme "draw.io dark", FBD notation)

| Token            | Measured                                  |
| ---------------- | ----------------------------------------- |
| Background       | `#121212`                                 |
| Lines and text   | `#ffffff`, 1 px                           |
| Cell             | 100 × 40 px, cells of one table touch (shared border) |
| Table name       | Helvetica/Arial regular, cap height 17 px (≈ 24 px font), above the row, left-aligned 5 px past the first cell |
| Cell text        | Helvetica/Arial bold, cap height 9 px (≈ 11 px font), centred |
| Primary key      | underlined cell text (1 px, 2 px below the baseline) |
| FK arrow head    | filled triangle, about 8 × 10 px, at the referenced PK cell |
| Table pitch      | about 190 px from one table name to the next |

Routing rules:

- Tables are stacked in one column; referenced tables sit above the tables that reference them.
- An FK line leaves from the bottom centre of the FK cell, drops 20 px, runs right to its own vertical corridor, climbs, then runs left and enters the PK cell from below, ending in the arrow head.
- Corridors are 20 px apart, just to the right of the widest table the line passes alongside (not of the whole diagram), ordered so that lines never cross: the longest span takes the outermost corridor.
- The horizontal run under the PK cell sits 20–40 px below it; the run under the FK cell sits 20 px below it.
- Several FKs into the same PK cell arrive side by side, about 10–20 px apart along the bottom of that cell.

## Chen ER diagram (theme "draw.io dark", FBD notation)

| Token                    | Measured                               |
| ------------------------ | -------------------------------------- |
| Background               | `#121212`                              |
| Lines and text           | `#ffffff`, 1 px                        |
| Entity                   | rectangle 130 × 60 px, name centred, bold, cap height 10 px (≈ 12 px font) |
| Weak entity              | double rectangle, inner border 5 px inside the outer |
| Relationship             | diamond about 85 × 40 px, name centred, regular |
| Identifying relationship | double diamond, same inset             |
| Attribute                | ellipse about 80 × 40 px, text centred, regular ≈ 11 px; two-word names wrap to two lines |
| Key attribute            | underlined text                        |
| Multivalued attribute    | double ellipse, inner border inset like the weak entity (standard Chen; not in the measured references) |
| Total participation      | double line, 4 px between the strokes  |
| Cardinality              | `1`, `N`, `M` in bold ≈ 11 px, next to the entity end of the line, 5–8 px off the line |

Rules: diamonds sit on the straight line between the two entities they join; attribute ellipses fan out on the side away from the relationships, evenly spaced, joined by straight lines to the owner's border.

## Flowchart (ISO 5807)

The reference is an SVG, so these values are exact.

| Token        | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| Fill         | `#9fcdf5` for every shape                                      |
| Shape stroke | `#000000`, 1.2 px                                              |
| Flow line    | `#000000`, 1.6 px, orthogonal polylines                        |
| Arrow head   | filled triangle, marker 6.5 × 6.5 (path `M0,0 L10,5 L0,10 z`)  |
| Font         | Calibri, Arial, sans-serif, 16 px, centred, up to 2 lines      |
| Terminator   | rounded rectangle, height 42–58 px, corner radius = height / 2 |
| Process      | rectangle 250–310 × 52–56 px                                   |
| Decision     | diamond 240–300 × 92–108 px (width ≈ 2.6 × height)             |
| Vertical gap | 22–28 px between shapes                                        |
| Branch label | "Sim" / "Não", 16 px, beside the line just after the decision  |

Rules: the main path runs top to bottom down the centre; "Sim" continues downwards and "Não" leaves to the right; a two-way split with equal branches spreads them left and right, each branch keeping its own column; branches rejoin below.

## Shared rules

- One stroke width per diagram for boxes and edges, except the flowchart, where flow lines are a bit heavier than shape outlines.
- Text never touches a border: at least 8 px (1x scale) of padding.
- Labels sit next to the end they describe and never on top of a line.
