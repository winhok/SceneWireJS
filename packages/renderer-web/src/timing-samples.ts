/** Bounded timing values only; never owns decoded frames. */
export class TimingSamples {
  private readonly samples: number[] = [];
  private cursor = 0;
  constructor(private readonly capacity = 10000) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw Error('Invalid timing capacity');
  }
  push(value: number): void {
    if (this.samples.length < this.capacity) this.samples.push(value);
    else this.samples[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
  }
  values(): number[] {
    return [...this.samples];
  }
  get length(): number {
    return this.samples.length;
  }
}
