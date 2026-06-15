# Explain gestures — tell the AI what to narrate

While you record (browser tab, GlitchGrab extension active), you don't write a
script. You just **use the product** and **mark the moments you want explained**.
The AI scripter turns the recording into a social-media-ready voiceover: routine
clicks become one quick line, and the moments you MARK become the parts it slows
down and explains. Marking is how you control the narration.

There is ONE key — **Shift** — used three ways.

## 1. Explain a component — point at it and tap (or hold) Shift

Move the cursor over the thing you want explained and press **Shift**.

- Over a **button, link, or option** (anything clickable): a **quick Shift tap is
  enough** — it marks that control. No long hold needed.
- Over **plain text or a non-clickable area** (a price line, a card body): **hold
  Shift for about half a second** so a stray tap isn't mistaken for a mark.
- Hold **longer** to tell the AI to spend **more time** on it.
- A Shift tap **while typing** (capital letters) or a **Shift+click** (multi-select)
  is never mistaken for a mark.
- The AI names that element and explains what it does and why it matters — e.g.
  mark **Book Seat** → the script explains booking a seat, not just "we view the
  page".

## 2. Explain a SET of options — mark each, one after another

When the screen offers several choices and you want the narration to present them
as a group, **press Shift over each sibling option in quick succession** (within a
few seconds of each other). For a row of buttons, quick **taps** are enough — tap
Google, tap phone, tap email.

- Example: mark **Continue with Google**, then **phone OTP**, then **email**
  → the script says *"you can sign up three ways — with Google, your phone, or
  email"*, instead of narrating just one.
- Works for plan cards (MICRO / PRO), role choices (Student / Library Owner), any
  row of options. The AI reads the **intention**: "there are multiple options
  here," names each, and explains when to pick which.

## 3. Explain specific TEXT — SELECT it, then tap Shift

Highlight the exact words you want explained (drag-select with the mouse), then
**tap Shift** while the text is still selected.

- No long hold needed here — the selection itself is the intent.
- The AI explains/paraphrases **that exact text** — e.g. highlight a pricing line
  "₹600/month, WiFi, reserved seat" → the script speaks to those specifics.

## What happens to everything else

Anything you don't mark is treated as connective tissue — the AI keeps it to a
short line (or skips it) so the script fits the video length and sounds like a
person, not a checklist. **Mark generously**: the marks are where the value of the
narration lives.

## Notes
- These gestures are captured by the GlitchGrab Chrome extension on normal web
  pages only (not `chrome://` pages or other native apps).
- After recording, open the **GlitchGrab Log** panel in the editor → **Generate
  script from events** to see the narration the marks produced; refine it in the
  chat, then **Add narration to video**.
- Implementation: the Shift/selection capture lives in
  `packages/extension/src/capture.ts`; how the marks are turned into narration is
  in `apps/web/lib/narration/prompt.ts` (the "NOTES = THE BACKBONE" section).
