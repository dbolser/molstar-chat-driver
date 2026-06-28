/**
 * PromptHistory — readline-style recall for the prompt box.
 *
 * ↑ walks back through previously submitted prompts, ↓ walks forward, and stepping past the
 * newest entry restores whatever was being typed before recall started. Kept DOM-free so the
 * navigation logic can be unit-tested on its own; the panel wires it to the textarea.
 */
export class PromptHistory {
  private items: string[] = [];
  /** Cursor into `items`; `items.length` means "the live draft" (nothing recalled). */
  private pos = 0;
  /** Text in progress when the user first stepped back into history. */
  private draft = '';

  /** Record a submitted prompt and park the cursor back at the draft slot. */
  add(prompt: string): void {
    this.items.push(prompt);
    this.pos = this.items.length;
    this.draft = '';
  }

  /**
   * Step to an older prompt. `current` is the box's text right now (saved as the draft the
   * first time we leave it). Returns the text to show, or `null` to leave the box untouched.
   */
  prev(current: string): string | null {
    if (this.pos === this.items.length) this.draft = current;
    if (this.pos === 0) return null; // already at the oldest entry
    this.pos -= 1;
    return this.items[this.pos];
  }

  /**
   * Step to a newer prompt, or back to the in-progress draft once past the newest entry.
   * Returns the text to show, or `null` if already sitting on the draft.
   */
  next(): string | null {
    if (this.pos >= this.items.length) return null; // already on the draft
    this.pos += 1;
    return this.pos === this.items.length ? this.draft : this.items[this.pos];
  }
}
