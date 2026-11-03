export interface NativeWhitespaceSnapshot {
  readonly owner: object;
  readonly settings: object;
  readonly subject: string;
  readonly current: boolean;
  readonly panel: object | null;
  readonly loadingCurrent: boolean;
  readonly detached: boolean;
  readonly value: boolean;
  readonly unset: boolean;
  readonly open: boolean;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly diffLoading: boolean;
  readonly statsLoading: boolean;
  readonly diff: object;
  readonly stats: object;
}
export interface WhitespaceReceipt { readonly status: 'legacy' | 'pending' | 'ready'; readonly value: boolean | null; readonly epoch: number }
interface Owned { readonly owner: object; readonly subject: string; readonly panel: object | null; readonly baseline: boolean | undefined; readonly value: boolean; settings: object }
interface Waiting { readonly diff: object; readonly stats: object; readonly value: boolean; readonly unset: boolean; readonly after: 'ready' | 'legacy'; diffStarted: boolean; statsStarted: boolean }
interface Editing { readonly subject: string; opened: boolean; submitted: boolean; loading: boolean; intent: boolean | null }

/** Owns only a native in-memory field. No persistence action is accepted here. */
export class BitbucketWhitespaceLease {
  private enabled = false;
  private force = true;
  private blocked: string | null = null;
  private choice: { readonly subject: string; readonly value: boolean } | null = null;
  private owned: Owned | null = null;
  private waiting: Waiting | null = null;
  private editing: Editing | null = null;
  private dispatching = false;
  private stable: { readonly owner: object; readonly panel: object | null; readonly subject: string; readonly value: boolean; readonly unset: boolean; readonly diff: object; readonly stats: object; readonly at: number } | null = null;
  private epoch = 0;
  private subject: string | null = null;
  private receipt: WhitespaceReceipt = { status: 'legacy', value: null, epoch: 0 };
  constructor(private readonly read: () => NativeWhitespaceSnapshot | null, private readonly dispatch: (value: boolean | undefined) => void, private readonly changed: (receipt: WhitespaceReceipt) => void, private readonly now: () => number = Date.now) {}

  update(enabled: boolean, force = true): void { this.enabled = enabled;this.force = force;if (!enabled) { this.blocked = null;this.choice = null; }this.tick(); }
  private publish(status: WhitespaceReceipt['status'], value: boolean | null): void {
    if (this.receipt.status === status && this.receipt.value === value) return;
    this.receipt = { status, value, epoch: ++this.epoch };this.changed(this.receipt);
  }
  private set(snapshot: NativeWhitespaceSnapshot, raw: boolean | undefined, after: Waiting['after']): void {
    const value = raw === true, unset = raw === undefined;
    this.waiting = { diff: snapshot.diff, stats: snapshot.stats, value, unset, after, diffStarted: false, statsStarted: false };this.publish('pending', null);
    this.dispatching = true;
    try { this.dispatch(raw); } finally { this.dispatching = false; }
    const now = this.read();if (this.owned !== null && now?.owner === this.owned.owner && now.value === value && now.unset === unset) this.owned.settings = now.settings;
  }
  private owns(snapshot: NativeWhitespaceSnapshot, owned: Owned): boolean {
    if (snapshot.owner !== owned.owner || snapshot.unset || snapshot.value !== owned.value) return false;
    if (snapshot.settings === owned.settings) return true;
    const keys = Object.keys(snapshot.settings), previous = Object.keys(owned.settings);
    return keys.length !== previous.length || keys.some(key => Reflect.get(snapshot.settings, key) !== Reflect.get(owned.settings, key));
  }
  private release(snapshot: NativeWhitespaceSnapshot | null): void {
    const owned = this.owned;if (owned === null) return;this.owned = null;
    if (snapshot !== null && this.owns(snapshot, owned)) this.set(snapshot, owned.baseline, 'legacy');
    else this.waiting = null;
  }
  tick(): void {
    if (this.dispatching) { const snapshot = this.read();if (snapshot !== null) this.observeLoading(snapshot);return; }
    const snapshot = this.read();
    if (snapshot === null) { this.publish(this.owned === null && this.waiting === null ? 'legacy' : 'pending', null);return; }
    if (snapshot.subject !== this.subject) {
      this.subject = snapshot.subject;
      this.receipt = { status: 'pending', value: null, epoch: ++this.epoch };this.changed(this.receipt);
    }
    const retainedLoading = this.retainsLoading(snapshot);
    if ((!snapshot.current && !retainedLoading) || !this.enabled) {
      this.release(snapshot);
      if (snapshot.detached && this.waiting?.after === 'legacy' && snapshot.value === this.waiting.value && snapshot.unset === this.waiting.unset) this.waiting = null;
      if (this.waiting !== null) this.settle(snapshot);else this.publish('legacy', null);
      return;
    }
    if (snapshot.failed) { this.blocked = snapshot.subject;this.release(snapshot);this.publish(this.waiting === null ? 'legacy' : 'pending', null);return; }
    if (!this.force) this.release(snapshot);
    if (this.editing !== null) {
      const edit = this.editing;
      edit.opened ||= snapshot.open;edit.loading ||= edit.submitted && snapshot.loading;
      if (edit.opened && !snapshot.open && !snapshot.loading) {
        if (edit.submitted && edit.loading && edit.intent !== null && !snapshot.unset && snapshot.value === edit.intent) this.choice = { subject: edit.subject, value: edit.intent };
        this.editing = null;this.waiting = null;
      } else { this.publish('pending', null);return; }
    }
    if (snapshot.open || snapshot.loading) { this.blocked = snapshot.subject;this.release(snapshot);this.publish(this.waiting === null ? 'legacy' : 'pending', null);return; }
    if (this.owned !== null && (snapshot.subject !== this.owned.subject || snapshot.panel !== this.owned.panel || !this.owns(snapshot, this.owned))) {
      if (this.owns(snapshot, this.owned)) { this.release(snapshot);return; }
      this.blocked = snapshot.subject;this.owned = null;this.waiting = null;this.publish('pending', null);
    }
    if (this.owned !== null) this.owned.settings = snapshot.settings;
    if (retainedLoading) { this.observeLoading(snapshot);this.publish('pending', null);return; }
    if (this.waiting !== null) { if (!this.settle(snapshot)) return;if (this.receipt.status === 'legacy') this.tick();return; }
    if (snapshot.busy) { this.stable = null;this.publish('pending', null);return; }
    const desired = !this.force || this.blocked === snapshot.subject ? snapshot.value : this.choice?.subject === snapshot.subject ? this.choice.value : true;
    if (snapshot.value === desired) {
      const stable = this.stable;
      // Native EXPAND_CONTEXT.SUCCESS replaces diff arrays without changing the comparison mode.
      // Keep an already acknowledged idle mode so its source leases survive that row refresh.
      if (this.receipt.status === 'ready' && stable !== null && stable.owner === snapshot.owner && stable.panel === snapshot.panel && stable.subject === snapshot.subject && stable.value === snapshot.value && stable.unset === snapshot.unset) {
        this.stable = { ...stable, diff: snapshot.diff, stats: snapshot.stats };return;
      }
      if (stable === null || stable.owner !== snapshot.owner || stable.panel !== snapshot.panel || stable.subject !== snapshot.subject || stable.value !== snapshot.value || stable.unset !== snapshot.unset || stable.diff !== snapshot.diff || stable.stats !== snapshot.stats) { this.stable = { owner: snapshot.owner, panel: snapshot.panel, subject: snapshot.subject, value: snapshot.value, unset: snapshot.unset, diff: snapshot.diff, stats: snapshot.stats, at: this.now() };this.publish('pending', null);return; }
      if (this.now() - stable.at >= 150) this.publish('ready', snapshot.value);return;
    }
    this.stable = null;
    this.owned = { owner: snapshot.owner, subject: snapshot.subject, panel: snapshot.panel, baseline: snapshot.unset ? undefined : snapshot.value, value: desired, settings: snapshot.settings };
    this.set(snapshot, desired, 'ready');
  }
  private retainsLoading(snapshot: NativeWhitespaceSnapshot): boolean {
    return snapshot.loadingCurrent && !snapshot.failed && this.owned !== null && this.waiting?.after === 'ready'
      && snapshot.owner === this.owned.owner && snapshot.subject === this.owned.subject && snapshot.panel === this.owned.panel;
  }
  private observeLoading(snapshot: NativeWhitespaceSnapshot): void {
    if (this.waiting !== null) { this.waiting.diffStarted ||= snapshot.diffLoading;this.waiting.statsStarted ||= snapshot.statsLoading; }
  }
  private settle(snapshot: NativeWhitespaceSnapshot): boolean {
    this.observeLoading(snapshot);
    const waiting = this.waiting;if (waiting === null) return true;
    if (snapshot.value !== waiting.value || snapshot.unset !== waiting.unset || !waiting.diffStarted || !waiting.statsStarted || snapshot.busy || snapshot.diff === waiting.diff || snapshot.stats === waiting.stats) { this.publish('pending', null);return false; }
    this.waiting = null;this.stable = { owner: snapshot.owner, panel: snapshot.panel, subject: snapshot.subject, value: snapshot.value, unset: snapshot.unset, diff: snapshot.diff, stats: snapshot.stats, at: this.now() - 150 };this.publish(waiting.after, waiting.after === 'ready' ? snapshot.value : null);return true;
  }
  suspend(): void {
    const snapshot = this.read();if (snapshot === null) return;
    this.blocked = snapshot.subject;this.release(snapshot);this.publish(this.waiting === null ? 'legacy' : 'pending', null);
  }
  beforePreferences(): boolean {
    const snapshot = this.read();if (snapshot === null || (!snapshot.current && !this.retainsLoading(snapshot)) || snapshot.open || snapshot.loading) return false;
    this.editing = { subject: snapshot.subject, opened: false, submitted: false, loading: false, intent: null };
    this.release(snapshot);this.publish('pending', null);return true;
  }
  preferenceIntent(value: boolean): void { if (this.editing !== null) this.editing.intent = value; }
  preferenceSubmit(): void { if (this.editing !== null) this.editing.submitted = true; }
  revoke(): void { this.stop();this.waiting = null;this.publish('legacy', null); }
  stop(): void { this.enabled = false;this.editing = null;this.release(this.read());if (this.waiting === null) this.publish('legacy', null); }
  state(): WhitespaceReceipt { return this.receipt; }
}
