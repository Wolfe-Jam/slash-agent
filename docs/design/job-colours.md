# Job colours

Every job in [Hire the agent](https://agent-web-524037477356.us-central1.run.app) has a colour, so you can tell a fix from a test at a glance. **See it rendered in both modes: [/design](https://agent-web-524037477356.us-central1.run.app/design).**

## The rules

1. **The colour follows the job's type**, the first word of the job (*Fix: …*, *Add: …*, *Test: …*). Any new job is coloured automatically.
2. **Status colours are never job colours.** Green means the tests passed. Red means they failed. Orange is FAF's own mark.
3. **Retrying isn't a colour.** When the agent iterates, the card keeps the job's colour and adds **↻ round 2**: it's still the same job.
4. **Borrow what people already know.** Where developers have a colour habit, use it.
5. **Spread the hues.** Colours that sit close together blur at a glance and in video.
6. **Readable in light and dark mode.** Where a colour is too pale for text (yellow on white), the text uses a darker tone of it.

## The palette

| Type | Colour | Light / dark | Why |
|---|---|---|---|
| **Fix** | rose | `#D63384` / `#F778BA` | GitHub's "bug" label is red, but red already means "failed", so the nearest colour that still reads as a bug. |
| **Add** | cyan | `#0E8F8F` / `#00D4D4` | GitHub's "enhancement" label is cyan. |
| **Test** | yellow + black | `#F2C200` / `#F5D33A` (text `#8A6A00` on light) | A crash-test dummy: testing is what it's for. |
| **Upgrade** | purple | `#8250DF` / `#A371F7` | Levelling up: purple is the "epic" tier in games. |
| **Refactor** | slate | `#57606A` / `#8B949E` | Neutral grey: the behaviour doesn't change, only the code. |
| **Docs** | blue | `#1F6FEB` / `#58A6FF` | GitHub's "documentation" label is blue. |

Reserved, never a job colour: pass green `#1A7F37` / `#3FB950`, fail red `#CF222E` / `#F85149`, FAF orange.

## Options we tried

| | Palette | Verdict |
|---|---|---|
| **A** | cyan, blue, violet, indigo, magenta, slate | Rejected: four of the six are blues and purples, which blur together. |
| **B** | cyan, blue, violet, magenta, brown, slate | Better spread, but brown for Upgrade had no meaning. |
| **C** | rose, cyan, yellow + black, purple, slate, blue | **Chosen.** Every colour has a reason. Yellow became possible once "iterate" stopped being amber. |
| **C-magenta** | Upgrade magenta, Fix moves to purple | Considered: magenta and rose are neighbours, and purple loses the "bug" feel for Fix. |
