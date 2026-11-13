"use client";

import { useSyncExternalStore } from "react";

/**
 * The simulator's clock. Mutable on purpose: the 3D scene reads `time` every frame without
 * re-rendering React, while the DOM controls subscribe and re-render at most ~10 times a second.
 */
export class SimClock {
  time = 0;
  playing = false;
  speed = 1;
  duration: number;
  private version = 0;
  private lastEmit = 0;
  private listeners = new Set<() => void>();

  constructor(duration: number) {
    this.duration = duration;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.lastEmit = performance.now();
    this.listeners.forEach((l) => l());
  }

  /** Advances by `dt` real seconds; returns true if time moved. */
  tick(dt: number): boolean {
    if (!this.playing) return false;
    this.time = Math.min(this.duration, this.time + Math.min(dt, 0.1) * this.speed);
    if (this.time >= this.duration) {
      this.playing = false;
      this.emit();
    } else if (performance.now() - this.lastEmit > 100) {
      this.emit();
    }
    return true;
  }

  seek(t: number) {
    this.time = Math.max(0, Math.min(this.duration, t));
    this.emit();
  }

  setPlaying(playing: boolean) {
    if (playing && this.time >= this.duration) this.time = 0;
    this.playing = playing;
    this.emit();
  }

  setSpeed(speed: number) {
    this.speed = speed;
    this.emit();
  }

  reset(duration: number) {
    this.duration = duration;
    this.time = 0;
    this.emit();
  }
}

/** Re-renders the caller when the clock emits (throttled while playing). */
export function useClock(clock: SimClock): SimClock {
  useSyncExternalStore(clock.subscribe, clock.getVersion, clock.getVersion);
  return clock;
}
